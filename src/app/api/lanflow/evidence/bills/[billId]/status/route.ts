import { requireAuth } from "@/lib/server/auth";
import { canAccessEvidenceLocation, evidenceError, noStoreJson, UUID_PATTERN } from "@/lib/server/weight-evidence";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ billId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const { billId } = await context.params;
  const params = new URL(request.url).searchParams;
  const locationId = params.get("locationId") ?? "";
  const completionId = params.get("completionId") ?? "";
  const revisionNo = Number(params.get("revisionNo"));
  if (!UUID_PATTERN.test(billId) || !UUID_PATTERN.test(completionId) || !Number.isInteger(revisionNo) || revisionNo < 0) {
    return evidenceError(400, "INVALID_REQUEST", "ข้อมูลตรวจสถานะไม่ถูกต้อง");
  }
  if (!canAccessEvidenceLocation(result.auth, locationId)) {
    return evidenceError(403, "LOCATION_ACCESS_DENIED", "ไม่มีสิทธิ์เข้าถึงสาขานี้");
  }

  const { data: bill, error } = await result.supabase
    .from("rubber_bills")
    .select("revision_no, record_status, evidence_completion_id")
    .eq("id", billId)
    .eq("location_id", locationId)
    .maybeSingle();
  if (error) return evidenceError(503, "STATUS_READ_FAILED", "ตรวจสถานะบิลไม่สำเร็จ", true);
  if (!bill || bill.record_status !== "active") return noStoreJson({ state: "inactive", active: false, currentRevisionNo: bill?.revision_no ?? null });
  if (bill.revision_no !== revisionNo) return noStoreJson({ state: "stale", active: true, currentRevisionNo: bill.revision_no });
  const state = bill.evidence_completion_id == null
    ? "available"
    : bill.evidence_completion_id === completionId ? "owned" : "owned_by_other";
  return noStoreJson({ state, active: true, currentRevisionNo: bill.revision_no });
}
