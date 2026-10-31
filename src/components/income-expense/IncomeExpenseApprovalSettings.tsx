import { useId, useRef, useState, type FormEvent } from "react";
import { ChevronDown, ChevronUp, Plus, Power, Settings2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatApprovalAmount as formatCurrency } from "./approval-display";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { isNonNegativeNumeric12Scale2 } from "@/lib/validation/primitives";
import type { AmountRule, ApprovalKeywordInput, ApprovalSettingsInput } from "@/lib/income-expense/approval-settings-mutations";
import type { IncomeExpenseApprovalSettings as Settings, IncomeExpenseApprovalKeyword as Keyword } from "@/types";
import { AlertDialog } from "@/components/shared/AlertDialog";
import { appliesToLabels, matchModeLabels, parseOptionalAmount } from "./approval-display";
import { useApprovalSettingAction } from "./approval-setting-action";

const field = "focus-ring h-11 min-w-0 w-full rounded-lg border border-black/15 bg-white px-3 font-normal text-ink disabled:bg-field/40";
const saveButton = "focus-ring inline-flex min-h-11 items-center justify-center rounded-lg bg-commit px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
type RuleProps = {
  settings?: Settings; canEdit: boolean; ready: boolean;
  save: (input: ApprovalSettingsInput) => Promise<unknown>;
  reload: () => Promise<Settings | undefined>;
  onPending: (key: string, pending: boolean) => void;
};

function AmountRuleForm({ settings, canEdit, ready, save, reload, onPending }: RuleProps) {
  const [draft, setDraft] = useState<{ text: string; appliesTo: AmountRule["appliesTo"]; expected: AmountRule } | null>(null);
  const action = useApprovalSettingAction("amount", onPending);
  const issueId = useId();
  const current = { appliesTo: settings?.appliesTo ?? "both", approvalMinAmount: settings?.approvalMinAmount ?? null };
  const text = draft?.text ?? (current.approvalMinAmount == null ? "" : String(current.approvalMinAmount));
  const appliesTo = draft?.appliesTo ?? current.appliesTo;
  function edit(change: Partial<{ text: string; appliesTo: AmountRule["appliesTo"] }>) {
    setDraft({ text, appliesTo, expected: draft?.expected ?? current, ...change });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const amount = parseOptionalAmount(text);
    if (amount !== null && !isNonNegativeNumeric12Scale2(amount)) { action.setError("กรอกยอดตั้งแต่ 0 ถึง 9,999,999,999.99 บาท ทศนิยมไม่เกิน 2 ตำแหน่ง"); return; }
    if (!ready || !canEdit || !draft || action.needsReload) return;
    if (await action.run(() => save({ kind: "amount", value: { appliesTo, approvalMinAmount: amount }, expected: draft.expected }), "บันทึกเกณฑ์ยอดเงินแล้ว")) setDraft(null);
  }
  async function loadLatest() {
    const latest = await reload();
    if (!latest) return;
    setDraft(value => value ? { ...value, expected: { appliesTo: latest.appliesTo, approvalMinAmount: latest.approvalMinAmount ?? null } } : null);
    action.clear();
  }
  return <section className="min-w-0 rounded-xl border border-black/10 bg-white p-4 sm:p-5">
    <h4 className="text-balance font-bold text-ink">เกณฑ์ยอดเงินที่ต้องอนุมัติ</h4>
    <p className="mt-1 text-pretty text-sm text-ink/60">ยอดถึงเกณฑ์หรือสูงกว่าต้องขออนุมัติ เว้นว่างเพื่อปิดกฎนี้</p>
    <p className="mt-3 text-sm font-semibold text-ink">ค่าปัจจุบัน: {settings ? `${appliesToLabels[current.appliesTo]} · ${current.approvalMinAmount == null ? "ปิดกฎยอดเงิน" : `ตั้งแต่ ${formatCurrency(current.approvalMinAmount)}`}` : "ยังโหลดค่าไม่ได้"}</p>
    {canEdit && <form onSubmit={event => void submit(event)} className="mt-4 grid gap-3" aria-busy={action.busy}>
      <fieldset disabled={!ready || action.busy} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1.5 text-sm font-semibold">ใช้กับ<select className={field} value={appliesTo} onChange={e => edit({ appliesTo: e.target.value as AmountRule["appliesTo"] })}>
          <option value="both">รับ-จ่าย</option><option value="income">รายรับ</option><option value="expense">รายจ่าย</option>
        </select></label>
        <label className="grid min-w-0 gap-1.5 text-sm font-semibold">ยอดขั้นต่ำ (บาท)<input className={cn(field, "tabular-nums")} inputMode="decimal" value={text} placeholder="เช่น 5000" onChange={e => edit({ text: e.target.value })} aria-invalid={!!action.error} aria-describedby={issueId} /></label>
      </fieldset>
      <p id={issueId} role={action.error ? "alert" : undefined} className={cn("text-pretty text-sm", action.error ? "text-clay" : "text-ink/55")}>{action.error ?? "การบันทึกส่วนนี้ไม่เปลี่ยนกฎวันที่หรือกฎลบโยกเงิน"}</p>
      {action.needsReload && <button type="button" onClick={() => void loadLatest()} disabled={!ready || action.busy} className="focus-ring min-h-11 rounded-lg border border-river/30 px-3 text-sm font-semibold text-river">โหลดค่าล่าสุดก่อนบันทึกอีกครั้ง</button>}
      <button type="submit" disabled={!ready || action.busy || !draft || action.needsReload} className={saveButton}>{action.busy ? "กำลังบันทึก…" : "บันทึกเกณฑ์ยอดเงิน"}</button>
    </form>}
  </section>;
}

function BooleanRuleForm({ kind, ...props }: RuleProps & { kind: "date" | "cashDelete" }) {
  const { settings, canEdit, ready, save, reload, onPending } = props;
  const current = kind === "date" ? settings?.nonCurrentDateRequiresApproval : settings?.cashTransferDeleteRequiresApproval;
  const [draft, setDraft] = useState<{ value: boolean; expected: boolean } | null>(null);
  const action = useApprovalSettingAction(kind, onPending);
  const issueId = useId();
  const label = kind === "date" ? "ขออนุมัติเมื่อวันที่รับ–จ่ายไม่ใช่วันปัจจุบัน" : "ขออนุมัติก่อนลบรายการโยกเงินที่ปลายทางรับแล้ว";
  const button = kind === "date" ? "บันทึกกฎวันที่" : "บันทึกกฎลบโยกเงิน";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !canEdit || !draft || action.needsReload) return;
    if (await action.run(() => save({ kind, ...draft }), "บันทึกกติกาแล้ว")) setDraft(null);
  }
  async function loadLatest() {
    const latest = await reload();
    if (!latest) return;
    const expected = kind === "date" ? latest.nonCurrentDateRequiresApproval : latest.cashTransferDeleteRequiresApproval;
    setDraft(value => value ? { ...value, expected } : null); action.clear();
  }
  return <section className="min-w-0 rounded-xl border border-black/10 bg-white p-4 sm:p-5">
    <h4 className="text-balance font-bold text-ink">{kind === "date" ? "กฎวันที่รับ–จ่าย" : "กฎลบรายการโยกเงิน"}</h4>
    <p className="mt-1 text-pretty text-sm text-ink/60">{kind === "date" ? "ตรวจทั้งวันย้อนหลังและวันล่วงหน้าตามเวลาไทย" : "ปิดเพื่อให้ผู้ดูแลสาขาต้นทางลบได้ทันที แม้ปลายทางยืนยันยอดแล้ว"}</p>
    <p className="mt-3 text-sm font-semibold text-ink">ค่าปัจจุบัน: {settings ? current ? "เปิดใช้งาน" : "ปิดใช้งาน" : "ยังโหลดค่าไม่ได้"}</p>
    {canEdit && <form onSubmit={event => void submit(event)} className="mt-4 grid gap-3" aria-busy={action.busy}>
      <label className="flex min-h-11 items-start gap-3 rounded-lg bg-field/50 p-3 text-sm text-ink">
        <input type="checkbox" disabled={!ready || action.busy} checked={draft?.value ?? current ?? false} onChange={e => setDraft({ value: e.target.checked, expected: draft?.expected ?? current ?? false })} className="mt-0.5 size-5 shrink-0 accent-river" aria-describedby={issueId} /><span>{label}</span>
      </label>
      <p id={issueId} role={action.error ? "alert" : undefined} className="text-pretty text-sm text-clay">{action.error}</p>
      {action.needsReload && <button type="button" disabled={!ready || action.busy} onClick={() => void loadLatest()} className="focus-ring min-h-11 rounded-lg border border-river/30 px-3 text-sm font-semibold text-river">โหลดค่าล่าสุดก่อนบันทึกอีกครั้ง</button>}
      <button type="submit" disabled={!ready || action.busy || !draft || action.needsReload} className={saveButton}>{action.busy ? "กำลังบันทึก…" : button}</button>
    </form>}
  </section>;
}

function KeywordRules({ keywords, canEdit, ready, add, disable, reload, onPending }: {
  keywords: Keyword[]; canEdit: boolean; ready: boolean; add: (input: ApprovalKeywordInput) => Promise<unknown>;
  disable: (id: string) => Promise<unknown>; reload: () => Promise<Keyword[] | undefined>; onPending: RuleProps["onPending"];
}) {
  const [keyword, setKeyword] = useState("");
  const [appliesTo, setAppliesTo] = useState<Keyword["appliesTo"]>("expense");
  const [matchMode, setMatchMode] = useState<Keyword["matchMode"]>("contains");
  const [amount, setAmount] = useState("");
  const candidateId = useRef<string | null>(null);
  const [confirm, setConfirm] = useState<Keyword | null>(null);
  const action = useApprovalSettingAction("keywords", onPending);
  const errorId = useId();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !canEdit || action.needsReload) return;
    const approvalMinAmount = parseOptionalAmount(amount);
    if (!keyword.trim() || (approvalMinAmount !== null && !isNonNegativeNumeric12Scale2(approvalMinAmount))) { action.setError("กรอกข้อความและยอดขั้นต่ำตั้งแต่ 0 บาท ทศนิยมไม่เกิน 2 ตำแหน่ง"); return; }
    if (keywords.some(item => item.isActive && item.appliesTo === appliesTo && item.keyword.trim().toLowerCase() === keyword.trim().toLowerCase())) { action.setError("มีข้อความนี้ในรายการตรวจสอบแล้ว"); return; }
    candidateId.current ??= crypto.randomUUID();
    if (await action.run(() => add({ id: candidateId.current!, keyword, appliesTo, matchMode, approvalMinAmount }), "เพิ่มข้อความตรวจสอบแล้ว")) {
      setKeyword(""); setAmount(""); candidateId.current = null;
    }
  }
  async function loadLatest() {
    const latest = await reload();
    if (!latest) return;
    if (latest.some(item => item.id === candidateId.current)) { setKeyword(""); setAmount(""); candidateId.current = null; }
    action.clear();
  }
  return <section className="min-w-0 rounded-xl border border-black/10 bg-white p-4 sm:p-5">
    <h4 className="text-balance font-bold text-ink">ข้อความที่ต้องขออนุมัติ</h4>
    <p className="mt-1 text-pretty text-sm text-ink/60">ตัวอย่าง: เบิก, ค่าแรง, กับข้าว · เว้นยอดขั้นต่ำว่างเพื่อใช้กับทุกยอด</p>
    {canEdit && <form onSubmit={event => void submit(event)} className="mt-4 grid gap-3" aria-busy={action.busy}>
      <fieldset disabled={!ready || action.busy || action.needsReload} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1.5 text-sm font-semibold">ข้อความ<input value={keyword} onChange={e => { setKeyword(e.target.value); if (!action.needsReload) candidateId.current = null; }} className={field} placeholder="ข้อความที่ต้องตรวจ" aria-describedby={errorId} aria-invalid={!!action.error} required /></label>
        <label className="grid min-w-0 gap-1.5 text-sm font-semibold">ใช้กับ<select value={appliesTo} onChange={e => setAppliesTo(e.target.value as Keyword["appliesTo"])} className={field}><option value="expense">รายจ่าย</option><option value="income">รายรับ</option><option value="both">รับ-จ่าย</option></select></label>
        <label className="grid min-w-0 gap-1.5 text-sm font-semibold">วิธีตรวจ<select value={matchMode} onChange={e => setMatchMode(e.target.value as Keyword["matchMode"])} className={field}><option value="contains">พบข้อความ</option><option value="exact">ตรงทั้งรายการ</option></select></label>
        <label className="grid min-w-0 gap-1.5 text-sm font-semibold">ยอดขั้นต่ำเฉพาะข้อความ (บาท)<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className={cn(field, "tabular-nums")} placeholder="เว้นว่าง = ทุกยอด" aria-describedby={errorId} aria-invalid={!!action.error} /></label>
      </fieldset>
      <button type="submit" disabled={!ready || action.busy || action.needsReload} className={saveButton}><Plus size={17} className="mr-2" aria-hidden="true" />{action.busy ? "กำลังดำเนินการ…" : "เพิ่มข้อความ"}</button>
    </form>}
    <p id={errorId} role={action.error ? "alert" : undefined} className="mt-3 text-pretty text-sm text-clay">{action.error}</p>
    {action.needsReload && <button type="button" disabled={!ready || action.busy} onClick={() => void loadLatest()} className="focus-ring min-h-11 rounded-lg border border-river/30 px-3 text-sm font-semibold text-river">โหลดข้อความล่าสุดก่อนทำรายการต่อ</button>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {keywords.length === 0 ? <p className="text-sm text-ink/55">ยังไม่มีข้อความตรวจสอบ</p> : keywords.map(item => <article key={item.id} className="min-w-0 rounded-lg border border-black/10 p-3" aria-label={`ข้อความ ${item.keyword}`}>
        <div className="flex flex-wrap items-start justify-between gap-2"><h5 className="break-words text-balance font-semibold text-ink">{item.keyword}</h5><span className={cn("rounded-full px-2 py-1 text-xs font-semibold", item.isActive ? "bg-leaf/10 text-leaf" : "bg-ink/5 text-ink/60")}>{item.isActive ? "ใช้งาน" : "ปิดใช้งาน"}</span></div>
        <p className="mt-2 text-pretty text-sm text-ink/65">{appliesToLabels[item.appliesTo]} · {matchModeLabels[item.matchMode]} · <span className="tabular-nums">{item.approvalMinAmount == null ? "ทุกยอด" : `ตั้งแต่ ${formatCurrency(item.approvalMinAmount)}`}</span></p>
        {canEdit && item.isActive && <button type="button" disabled={!ready || action.busy || action.needsReload} onClick={() => setConfirm(item)} className="focus-ring mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-clay/25 px-3 text-sm font-semibold text-clay disabled:opacity-50"><Power size={16} aria-hidden="true" />ปิดใช้งาน</button>}
      </article>)}
    </div>
    <AlertDialog open={confirm !== null} title="ปิดใช้งานข้อความ" description={`ปิดใช้งาน “${confirm?.keyword ?? ""}” ใช่ไหม?`} confirmLabel="ปิดใช้งาน" busy={action.busy} onCancel={() => setConfirm(null)} onConfirm={() => { if (confirm) void action.run(() => disable(confirm.id), "ปิดใช้งานข้อความแล้ว").then(() => setConfirm(null)); }} />
  </section>;
}

export function IncomeExpenseApprovalSettings({ settings, keywords, canEdit, settingsLoading, keywordsLoading, settingsError, keywordsError, save, add, disable, retrySettings, retryKeywords, onBusyChange }: {
  settings?: Settings; keywords: Keyword[]; canEdit: boolean; settingsLoading: boolean; keywordsLoading: boolean; settingsError: boolean; keywordsError: boolean;
  save: RuleProps["save"]; add: (input: ApprovalKeywordInput) => Promise<unknown>; disable: (id: string) => Promise<unknown>;
  retrySettings: () => Promise<Settings | undefined>; retryKeywords: () => Promise<Keyword[] | undefined>; onBusyChange: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const pending = useRef(new Set<string>());
  const contentId = useId();
  const online = useOnlineStatus();
  function onPending(key: string, value: boolean) { if (value) pending.current.add(key); else pending.current.delete(key); onBusyChange(pending.current.size > 0); }
  const props: RuleProps = { settings, canEdit, ready: online && !settingsLoading && !settingsError && !!settings, save, reload: retrySettings, onPending };
  return <section className="min-w-0 rounded-xl border border-black/10 bg-field/30">
    <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
      <div><h3 className="text-balance font-bold text-ink">การตั้งค่าทั้งระบบ</h3><p className="mt-1 text-pretty text-sm text-ink/60">มีผลทุกสาขา · ตัวกรองสาขาด้านบนใช้กับคำขอเท่านั้น</p></div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={contentId} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-lg border border-river/25 bg-white px-4 text-sm font-semibold text-river"><Settings2 size={17} aria-hidden="true" />{open ? "ซ่อนการตั้งค่าระบบ" : "ตั้งค่าระบบ"}{open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}</button>
    </div>
    <div id={contentId} hidden={!open} className="border-t border-black/10 p-4 sm:p-5">
      <p className="mb-4 flex items-start gap-2 text-pretty text-sm text-ink/65"><ShieldCheck size={18} className="shrink-0" aria-hidden="true" />{canEdit ? "เฉพาะ Super Admin แก้ไขกติกาได้ แต่ละส่วนบันทึกแยกกัน" : "ดูการตั้งค่าได้ เฉพาะ Super Admin เท่านั้นที่แก้ไขกติกาได้"}</p>
      {!online && <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">การตั้งค่ารับ–จ่ายใช้ได้เมื่อออนไลน์เท่านั้น ค่าที่กรอกไว้ยังคงอยู่</p>}
      {(settingsLoading || keywordsLoading) && <p role="status" className="mb-3 text-sm text-ink/60">กำลังโหลดการตั้งค่า…</p>}
      {(settingsError || keywordsError) && <div role="alert" className="mb-4 space-y-2 rounded-lg border border-clay/25 bg-clay/5 p-3 text-sm text-clay">
        <p>โหลดการตั้งค่าบางส่วนไม่สำเร็จ ค่าที่แสดงอาจไม่ใช่ค่าล่าสุด ส่วนที่ยังไม่พร้อมจะบันทึกไม่ได้</p>
        {settingsError && <button type="button" disabled={!online} onClick={() => void retrySettings()} className="focus-ring min-h-11 rounded-lg border border-clay/25 bg-white px-3 font-semibold">ลองโหลดกติกาใหม่</button>}
        {keywordsError && <button type="button" disabled={!online} onClick={() => void retryKeywords()} className="focus-ring ml-2 min-h-11 rounded-lg border border-clay/25 bg-white px-3 font-semibold">ลองโหลดข้อความใหม่</button>}
      </div>}
      <div className="grid min-w-0 gap-4">
        <AmountRuleForm {...props} />
        <KeywordRules keywords={keywords} canEdit={canEdit} ready={online && !keywordsLoading && !keywordsError} add={add} disable={disable} reload={retryKeywords} onPending={onPending} />
        <BooleanRuleForm {...props} kind="date" />
        <BooleanRuleForm {...props} kind="cashDelete" />
      </div>
      {settings?.updatedByName && <p className="mt-3 text-pretty text-xs text-ink/55">แก้ไขการตั้งค่าล่าสุดโดย {settings.updatedByName}{settings.updatedByPhone ? ` · ${settings.updatedByPhone}` : ""}</p>}
    </div>
  </section>;
}
