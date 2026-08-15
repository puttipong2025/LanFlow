import { bangkokDateString } from "@/lib/bangkok-date";
import { requireAuth } from "@/lib/server/auth";
import { canAccessEvidenceLocation, evidenceError, noStoreJson } from "@/lib/server/weight-evidence";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const locationId = new URL(request.url).searchParams.get("locationId") ?? "";
  if (!canAccessEvidenceLocation(result.auth, locationId)) {
    return evidenceError(403, "LOCATION_ACCESS_DENIED", "ไม่มีสิทธิ์เข้าถึงสาขานี้");
  }

  const businessDate = bangkokDateString();
  const { data: bills, error: billsError } = await result.supabase
    .from("rubber_bills")
    .select("id, bill_no, server_bill_no, bill_date, customer_name, revision_no, evidence_completion_id, client_recorded_at, server_received_at, created_at")
    .eq("location_id", locationId)
    .eq("bill_date", businessDate)
    .eq("record_status", "active")
    .order("created_at", { ascending: false });
  if (billsError) return evidenceError(503, "BILL_READ_FAILED", "โหลดบิลวันนี้ไม่สำเร็จ", true);

  const billIds = (bills ?? []).map((bill) => bill.id);
  const { data: rows, error: rowsError } = billIds.length === 0
    ? { data: [], error: null }
    : await result.supabase
      .from("rubber_bill_items")
      .select("id, bill_id, sequence_no, description, weight_in")
      .in("bill_id", billIds)
      .eq("item_type", "weigh")
      .order("sequence_no");
  if (rowsError) return evidenceError(503, "WEIGH_ROW_READ_FAILED", "โหลดรายการชั่งไม่สำเร็จ", true);

  const responseBills = (bills ?? []).map((bill) => ({
    id: bill.id,
    billNo: bill.server_bill_no ?? bill.bill_no,
    customerName: bill.customer_name ?? "",
    billDate: bill.bill_date,
    matchingRecordedAt: bill.client_recorded_at ?? bill.server_received_at ?? bill.created_at,
    revisionNo: bill.revision_no,
    completionState: bill.evidence_completion_id == null ? "available" : "completed",
    weighRows: (rows ?? [])
      .filter((row) => row.bill_id === bill.id)
      .map((row) => ({
        id: row.id,
        sequenceNo: row.sequence_no,
        label: row.description ?? `ชั่ง ${row.sequence_no}`,
        weightIn: Number(row.weight_in),
      })),
  })).filter((bill) => bill.weighRows.length > 0);

  return noStoreJson({ businessDate, locationId, bills: responseBills });
}
