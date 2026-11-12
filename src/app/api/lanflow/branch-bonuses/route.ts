import { requireSystemManager } from "@/lib/server/auth";
import { isUuid, isIsoTimestamp, isNonNegativeNumeric12Scale2, isNonNegativePostgresInteger } from "@/lib/validation/primitives";
import { parseBonusSettings } from "@/lib/branch-bonus/input";
import { parseBonusBatch, parseBonusReference } from "@/lib/branch-bonus/batch";
import { bonusError, bonusResponse } from "@/lib/server/branch-bonus-response";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireSystemManager(request);
    if (!auth.ok) return auth.response;
    const params = new URL(request.url).searchParams;
    const location = params.get("locationId"), id = params.get("id"), view = params.get("view") ?? "list";
    const before = params.get("before"), beforeId = params.get("beforeId");
    if (!isUuid(location) || (id !== null && !isUuid(id))
      || !["list", "candidates", "changes", "review", "batch"].includes(view) || (view === "batch" && !id)
      || (before !== null && (!isIsoTimestamp(before) || !isUuid(beforeId)))
      || (beforeId !== null && before === null)) return bonusResponse({ error: "เงื่อนไขรายการไม่ถูกต้อง" }, 400);
    const offset = Number(params.get("offset") ?? 0);
    if (!isNonNegativePostgresInteger(offset)) return bonusResponse({ error: "หน้ารายการไม่ถูกต้อง" }, 400);
    const { data, error } = view === "review"
      ? await auth.supabase.rpc("review_branch_bonus", { p_location: location })
      : view === "batch" ? await auth.supabase.rpc("get_branch_bonus_batch", { p_location: location, p_id: id }) : id
      ? await auth.supabase.rpc("get_branch_bonus", { p_location: location, p_id: id })
      : view === "changes"
        ? await auth.supabase.rpc("get_branch_bonus_changes", { p_location: location, p_offset: offset })
        : await auth.supabase.rpc(view === "candidates" ? "get_branch_bonus_candidates" : "list_branch_bonuses", {
          p_location: location, p_before: before, p_before_id: beforeId,
        });
    return error ? bonusError(error) : bonusResponse(data);
  } catch { return bonusError(null); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireSystemManager(request);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    if (!body || Array.isArray(body) || !isUuid(body.locationId)) return bonusResponse({ error: "ข้อมูลคำขอไม่ถูกต้อง" }, 400);
    const location = body.locationId;
    if (body.action === "delete") {
      if (!isUuid(body.id)) return bonusResponse({ error: "ไม่พบรายการที่จะลบ" }, 400);
      const { data, error } = await auth.supabase.rpc("delete_branch_bonus", { p_location: location, p_id: body.id });
      return error ? bonusError(error) : bonusResponse(data);
    }
    if (body.action === "previewBatch" || body.action === "confirmBatch") {
      const confirming = body.action === "confirmBatch";
      const periods = parseBonusBatch(body.periods, confirming);
      const excluded = body.referenceExcludedLocationIds === undefined ? undefined : parseBonusReference(body.referenceExcludedLocationIds, location);
      if (!periods || excluded === null || typeof body.review !== "string" || !/^[a-f0-9]{32}$/.test(body.review)
        || (confirming && !isUuid(body.id))) return bonusResponse({ error: "ข้อมูลชุดประเมินไม่ถูกต้อง" }, 400);
      const { data, error } = await auth.supabase.rpc(confirming ? "confirm_branch_bonus_batch" : "preview_branch_bonus_batch", {
        p_location: location, p_review: body.review, p_periods: excluded === undefined ? periods : { periods, excludedLocationIds: excluded }, ...(confirming ? { p_id: body.id } : {}),
      });
      return error ? bonusError(error) : bonusResponse(data);
    }
    if (!["preview", "sources", "confirm"].includes(body.action)) return bonusResponse({ error: "คำสั่งไม่ถูกต้อง" }, 400);
    const input = parseBonusSettings(body.input);
    if (!input && !(body.action === "sources" && isUuid(body.id))) return bonusResponse({ error: "ข้อมูลประเมินไม่ถูกต้อง" }, 400);
    if (body.action === "sources") {
      if (!["expenses", "purchases", "counts", "changes"].includes(body.section) || !isNonNegativePostgresInteger(body.offset)
        || (body.id !== undefined && !isUuid(body.id))) return bonusResponse({ error: "หน้ารายการไม่ถูกต้อง" }, 400);
      const { data, error } = await auth.supabase.rpc("get_branch_bonus_source_page", {
        p_location: location, p_input: input, p_section: body.section, p_offset: body.offset, p_bonus_id: body.id ?? null,
      });
      return error ? bonusError(error) : bonusResponse(data);
    }
    if (body.action === "confirm") {
      if (!isUuid(body.id) || typeof body.expected !== "string" || !/^[a-f0-9]{32}$/.test(body.expected)
        || (body.finalAmount !== null && !isNonNegativeNumeric12Scale2(body.finalAmount))) return bonusResponse({ error: "ข้อมูลยืนยันไม่ถูกต้อง" }, 400);
      const { data, error } = await auth.supabase.rpc("confirm_branch_bonus", {
        p_location: location, p_id: body.id, p_input: input, p_expected: body.expected, p_final_amount: body.finalAmount,
      });
      return error ? bonusError(error) : bonusResponse(data);
    }
    const { data, error } = await auth.supabase.rpc("preview_branch_bonus", { p_location: location, p_input: input });
    return error ? bonusError(error) : bonusResponse(data);
  } catch { return bonusError(null); }
}
