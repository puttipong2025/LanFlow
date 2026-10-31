import type { SupabaseClient } from "@supabase/supabase-js";
import { getConnectivitySnapshot } from "@/lib/connectivity";
import { isJsonObject, isNonNegativeNumeric12Scale2, isUuid } from "@/lib/validation/primitives";
import type { IncomeExpenseApprovalAppliesTo, IncomeExpenseApprovalKeyword, IncomeExpenseApprovalMatchMode, IncomeExpenseApprovalSettings } from "@/types";

export const APPROVAL_SETTINGS_COLUMNS = "applies_to, approval_min_amount, cash_transfer_delete_requires_approval, non_current_date_requires_approval, updated_by_name, updated_by_phone";
export const APPROVAL_KEYWORD_COLUMNS = "id, keyword, match_mode, applies_to, is_active, approval_min_amount";
export type AmountRule = { appliesTo: IncomeExpenseApprovalAppliesTo; approvalMinAmount: number | null };
export type ApprovalSettingsInput =
  | { kind: "amount"; value: AmountRule; expected: AmountRule }
  | { kind: "date" | "cashDelete"; value: boolean; expected: boolean };
export type ApprovalKeywordInput = { id: string; keyword: string; appliesTo: IncomeExpenseApprovalAppliesTo; matchMode: IncomeExpenseApprovalMatchMode; approvalMinAmount: number | null };

export class ApprovalSettingsError extends Error {
  constructor(message: string, public readonly uncertain = false) { super(message); }
}

export function assertApprovalSettingsOnline() {
  if (!getConnectivitySnapshot()) throw new ApprovalSettingsError("การตั้งค่ารับ–จ่ายใช้ได้เมื่อออนไลน์เท่านั้น ค่าที่กรอกไว้ยังคงอยู่");
}

function validAppliesTo(value: unknown): value is IncomeExpenseApprovalAppliesTo {
  return value === "income" || value === "expense" || value === "both";
}
function validAmount(value: unknown) { return value === null || isNonNegativeNumeric12Scale2(value); }
function numeric(value: unknown) { return typeof value === "string" && value.trim() !== "" ? Number(value) : value; }

export function readApprovalSettings(value: unknown): IncomeExpenseApprovalSettings {
  if (!isJsonObject(value) || !validAppliesTo(value.applies_to)
      || !validAmount(numeric(value.approval_min_amount))
      || typeof value.cash_transfer_delete_requires_approval !== "boolean"
      || typeof value.non_current_date_requires_approval !== "boolean") {
    throw new ApprovalSettingsError("โหลดการตั้งค่าไม่สำเร็จ กรุณาลองใหม่");
  }
  return {
    appliesTo: value.applies_to, approvalMinAmount: numeric(value.approval_min_amount) as number | null,
    cashTransferDeleteRequiresApproval: value.cash_transfer_delete_requires_approval,
    nonCurrentDateRequiresApproval: value.non_current_date_requires_approval,
    updatedByName: typeof value.updated_by_name === "string" ? value.updated_by_name : null,
    updatedByPhone: typeof value.updated_by_phone === "string" ? value.updated_by_phone : null,
  };
}

export function readApprovalKeyword(value: unknown): IncomeExpenseApprovalKeyword {
  if (!isJsonObject(value) || !isUuid(value.id) || typeof value.keyword !== "string"
      || !validAppliesTo(value.applies_to) || !validAmount(numeric(value.approval_min_amount))
      || (value.match_mode !== "contains" && value.match_mode !== "exact") || typeof value.is_active !== "boolean") {
    throw new ApprovalSettingsError("ข้อมูลข้อความตรวจสอบไม่ครบ กรุณาโหลดใหม่");
  }
  return { id: value.id, keyword: value.keyword, appliesTo: value.applies_to,
    approvalMinAmount: numeric(value.approval_min_amount) as number | null,
    matchMode: value.match_mode, isActive: value.is_active };
}

async function actor(client: SupabaseClient) {
  assertApprovalSettingsOnline();
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new ApprovalSettingsError("กรุณาเข้าสู่ระบบอีกครั้ง");
  const result = await client.from("profiles").select("id, name, phone, role, is_active").eq("id", data.session.user.id).single();
  if (result.error) throw new ApprovalSettingsError("โหลดสิทธิ์ไม่สำเร็จ ยังไม่ได้ส่งคำสั่งบันทึก กรุณาลองใหม่");
  if (result.data?.role !== "super_admin" || result.data?.is_active !== true) {
    throw new ApprovalSettingsError("เฉพาะ Super Admin ที่ใช้งานอยู่เท่านั้นที่แก้กติกาได้");
  }
  assertApprovalSettingsOnline();
  return { id: data.session.user.id, name: result.data.name, phone: result.data.phone };
}

function writeError(error: { code?: string; message?: string } | null, status: number) {
  if (!error) return;
  if (!status || status >= 500) throw new ApprovalSettingsError("ยังยืนยันผลบันทึกไม่ได้ กรุณาเชื่อมต่อแล้วโหลดค่าล่าสุดก่อนทำรายการต่อ", true);
  if (error.code === "23505") throw new ApprovalSettingsError("มีข้อความนี้ในรายการตรวจสอบแล้ว กรุณาโหลดล่าสุด");
  if (error.code === "42501") throw new ApprovalSettingsError("ไม่มีสิทธิ์แก้กติกา กรุณาตรวจสอบสิทธิ์และโหลดล่าสุด");
  throw new ApprovalSettingsError("บันทึกไม่สำเร็จ กรุณาตรวจสอบข้อมูลและโหลดล่าสุด");
}

function keywordAcknowledgement(data: unknown) {
  try { return readApprovalKeyword(data); }
  catch { throw new ApprovalSettingsError("ยังยืนยันผลบันทึกข้อความไม่ได้ กรุณาโหลดล่าสุดก่อนทำรายการต่อ", true); }
}

// Return only the acknowledged section: unrelated columns may be older than another save.
export function approvalSettingsPatch(input: ApprovalSettingsInput, settings: IncomeExpenseApprovalSettings): Partial<IncomeExpenseApprovalSettings> {
  const audit = { updatedByName: settings.updatedByName, updatedByPhone: settings.updatedByPhone };
  if (input.kind === "amount") return { ...audit, appliesTo: settings.appliesTo, approvalMinAmount: settings.approvalMinAmount };
  return input.kind === "date" ? { ...audit, nonCurrentDateRequiresApproval: settings.nonCurrentDateRequiresApproval }
    : { ...audit, cashTransferDeleteRequiresApproval: settings.cashTransferDeleteRequiresApproval };
}

export async function saveApprovalSettings(client: SupabaseClient, input: ApprovalSettingsInput) {
  if (input.kind !== "amount" && input.kind !== "date" && input.kind !== "cashDelete") throw new ApprovalSettingsError("ส่วนการตั้งค่าไม่ถูกต้อง");
  if (input.kind === "amount" && (!validAppliesTo(input.value.appliesTo) || !validAmount(input.value.approvalMinAmount)
      || !validAppliesTo(input.expected.appliesTo) || !validAmount(input.expected.approvalMinAmount))) {
    throw new ApprovalSettingsError("ยอดเงินต้องเป็นจำนวนตั้งแต่ 0 ถึง 9,999,999,999.99 บาท และมีทศนิยมไม่เกิน 2 ตำแหน่ง");
  }
  if (input.kind !== "amount" && (typeof input.value !== "boolean" || typeof input.expected !== "boolean")) throw new ApprovalSettingsError("ค่ากติกาไม่ถูกต้อง");
  const user = await actor(client);
  const values = input.kind === "amount" ? { applies_to: input.value.appliesTo, approval_min_amount: input.value.approvalMinAmount }
    : input.kind === "date" ? { non_current_date_requires_approval: input.value } : { cash_transfer_delete_requires_approval: input.value };
  let query = client.from("income_expense_approval_settings").update({ ...values,
    updated_by_user_id: user.id, updated_by_name: user.name, updated_by_phone: user.phone }).eq("id", true);
  if (input.kind === "amount") {
    query = query.eq("applies_to", input.expected.appliesTo);
    query = input.expected.approvalMinAmount === null ? query.is("approval_min_amount", null) : query.eq("approval_min_amount", input.expected.approvalMinAmount);
  } else query = query.eq(input.kind === "date" ? "non_current_date_requires_approval" : "cash_transfer_delete_requires_approval", input.expected);
  const result = await query.select(APPROVAL_SETTINGS_COLUMNS).maybeSingle();
  writeError(result.error, result.status);
  if (!result.data) throw new ApprovalSettingsError("ค่าถูกเปลี่ยนหรือสิทธิ์เปลี่ยนไป กรุณาโหลดค่าล่าสุดและตรวจสอบก่อนบันทึกอีกครั้ง");
  let settings: IncomeExpenseApprovalSettings;
  try { settings = readApprovalSettings(result.data); }
  catch { throw new ApprovalSettingsError("ยังยืนยันผลบันทึกไม่ได้ กรุณาโหลดค่าล่าสุด", true); }
  const matches = input.kind === "amount" ? settings.appliesTo === input.value.appliesTo && settings.approvalMinAmount === input.value.approvalMinAmount
    : input.kind === "date" ? settings.nonCurrentDateRequiresApproval === input.value : settings.cashTransferDeleteRequiresApproval === input.value;
  if (!matches) throw new ApprovalSettingsError("ยังยืนยันผลบันทึกไม่ได้ กรุณาโหลดค่าล่าสุด", true);
  return approvalSettingsPatch(input, settings);
}

export async function addApprovalKeyword(client: SupabaseClient, input: ApprovalKeywordInput) {
  if (!isUuid(input.id) || !input.keyword.trim() || !validAppliesTo(input.appliesTo) || !validAmount(input.approvalMinAmount)
      || (input.matchMode !== "contains" && input.matchMode !== "exact")) throw new ApprovalSettingsError("ข้อความหรือยอดขั้นต่ำไม่ถูกต้อง");
  const user = await actor(client);
  const result = await client.from("income_expense_approval_keywords").insert({ id: input.id, keyword: input.keyword.trim(),
    applies_to: input.appliesTo, match_mode: input.matchMode, approval_min_amount: input.approvalMinAmount,
    created_by_user_id: user.id, created_by_name: user.name, created_by_phone: user.phone }).select(APPROVAL_KEYWORD_COLUMNS).single();
  writeError(result.error, result.status);
  const row = keywordAcknowledgement(result.data);
  if (row.id !== input.id || row.keyword !== input.keyword.trim() || row.appliesTo !== input.appliesTo || row.matchMode !== input.matchMode
      || row.approvalMinAmount !== input.approvalMinAmount || !row.isActive) throw new ApprovalSettingsError("ยังยืนยันผลเพิ่มข้อความไม่ได้ กรุณาโหลดล่าสุดก่อนเพิ่มอีกครั้ง", true);
  return row;
}

export async function disableApprovalKeyword(client: SupabaseClient, id: string) {
  if (!isUuid(id)) throw new ApprovalSettingsError("ข้อความไม่ถูกต้อง");
  const user = await actor(client);
  const result = await client.from("income_expense_approval_keywords").update({ is_active: false, deleted_by_user_id: user.id })
    .eq("id", id).eq("is_active", true).select(APPROVAL_KEYWORD_COLUMNS).maybeSingle();
  writeError(result.error, result.status);
  if (!result.data) throw new ApprovalSettingsError("ข้อความถูกปิดแล้วหรือสิทธิ์เปลี่ยนไป กรุณาโหลดล่าสุด");
  const row = keywordAcknowledgement(result.data);
  if (row.id !== id || row.isActive) throw new ApprovalSettingsError("ยังยืนยันผลปิดข้อความไม่ได้ กรุณาโหลดล่าสุด", true);
  return row;
}
