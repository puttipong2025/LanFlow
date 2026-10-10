import { authFetch } from "@/lib/auth-fetch";
import { readAllSupabaseRows } from "@/lib/supabase-pages";
import type { BranchTransferDeleteRequest } from "@/types";

export async function loadBranchTransferDeleteRequests(supabase: any, locationId?: string) {
  const buildQuery = () => supabase
    .from("branch_transfer_delete_requests")
    .select("id, location_id, location_name, transfer_display_no, amount, request_status, requested_by_name, requested_by_phone, decided_by_name, decided_by_phone, created_at");
  const pendingRowsPromise = readAllSupabaseRows<any>((from, to) => {
    let query = buildQuery().eq("request_status", "pending");
    if (locationId) query = query.eq("location_id", locationId);
    return query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
  });
  let historyQuery = buildQuery().neq("request_status", "pending");
  if (locationId) historyQuery = historyQuery.eq("location_id", locationId);
  const historyPromise = historyQuery
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(80);
  const [pendingRows, historyResult] = await Promise.all([pendingRowsPromise, historyPromise]);
  if (historyResult.error) {
    throw new Error(historyResult.error.message || JSON.stringify(historyResult.error));
  }
  const historyRows = historyResult.data ?? [];
  const rowsById = new Map([...pendingRows, ...historyRows].map((row: any) => [row.id, row]));
  return [...rowsById.values()].map((row: any): BranchTransferDeleteRequest => ({
    id: row.id,
    locationId: row.location_id,
    locationName: row.location_name,
    transferDisplayNo: row.transfer_display_no,
    amount: Number(row.amount),
    requestStatus: row.request_status,
    requestedByName: row.requested_by_name,
    requestedByPhone: row.requested_by_phone,
    decidedByName: row.decided_by_name,
    decidedByPhone: row.decided_by_phone,
    createdAt: row.created_at,
  }));
}

export async function loadPendingApprovalCount(supabase: any, locationId?: string) {
  let incomeExpense = supabase.from("income_expense_approval_requests").select("id", { count: "exact", head: true }).eq("request_status", "pending");
  let cashTransfer = supabase.from("cash_transfer_delete_requests").select("id", { count: "exact", head: true }).eq("request_status", "pending");
  let branchTransfer = supabase.from("branch_transfer_delete_requests").select("id", { count: "exact", head: true }).eq("request_status", "pending");
  if (locationId) {
    incomeExpense = incomeExpense.eq("location_id", locationId);
    cashTransfer = cashTransfer.eq("source_location_id", locationId);
    branchTransfer = branchTransfer.eq("location_id", locationId);
  }
  const results = await Promise.all([incomeExpense, cashTransfer, branchTransfer]);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message || JSON.stringify(failed.error));
  return results.reduce((total, result) => total + (result.count ?? 0), 0);
}

export async function decideBranchTransferDeleteRequest(input: {
  id: string;
  decision: "approved" | "rejected";
  comment?: string;
}) {
  const response = await authFetch(`/api/lanflow/money-transfers/delete-requests/${input.id}/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision: input.decision, comment: input.comment }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.errorMessage || data.error || "ดำเนินการคำขอลบไม่สำเร็จ");
  return data;
}
