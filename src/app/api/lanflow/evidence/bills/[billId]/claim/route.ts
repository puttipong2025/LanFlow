import { requireAuth } from "@/lib/server/auth";
import { canAccessEvidenceLocation, evidenceError, noStoreJson, parseCompletionPayload, UUID_PATTERN } from "@/lib/server/weight-evidence";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ billId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const { billId } = await context.params;
  const payload = parseCompletionPayload(await request.json().catch(() => null));
  if (!UUID_PATTERN.test(billId) || !payload) return evidenceError(400, "INVALID_REQUEST", "ข้อมูล completion ไม่ถูกต้อง");
  if (!canAccessEvidenceLocation(result.auth, payload.locationId)) return evidenceError(403, "LOCATION_ACCESS_DENIED", "ไม่มีสิทธิ์เข้าถึงสาขานี้");

  const { data, error } = await result.supabase.rpc("claim_weight_evidence_completion", {
    p_bill_id: billId,
    p_location_id: payload.locationId,
    p_revision_no: payload.revisionNo,
    p_completion_id: payload.completionId,
  });
  if (error) return evidenceError(503, "COMPLETION_CLAIM_FAILED", "ยืนยัน completion ไม่สำเร็จ", true);
  return noStoreJson(data);
}
