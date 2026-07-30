import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch, authFetchJson, assertApiResponse } from "@/lib/auth-fetch";
import { INCOME_EXPENSE_FEED_QUERY_KEY } from "@/lib/income-expense/query-keys";
import { ACTIONABLE_BADGES_QUERY_KEY } from "@/hooks/useActionableBadges";
import type { CashBranchTransfer, CashDenominationCounts } from "@/types";

const KEYS = ["cashBranchTransfers"] as const;
const mapCounts = (row: any, prefix: "sent" | "received"): CashDenominationCounts | null => {
  if (row[`${prefix}_coin_1_count`] == null) return null;
  return {
    coin1: Number(row[`${prefix}_coin_1_count`]), coin2: Number(row[`${prefix}_coin_2_count`]), coin5: Number(row[`${prefix}_coin_5_count`]), coin10: Number(row[`${prefix}_coin_10_count`]),
    banknote20: Number(row[`${prefix}_banknote_20_count`]), banknote50: Number(row[`${prefix}_banknote_50_count`]), banknote100: Number(row[`${prefix}_banknote_100_count`]), banknote500: Number(row[`${prefix}_banknote_500_count`]), banknote1000: Number(row[`${prefix}_banknote_1000_count`]),
  };
};
const mapTransfer = (row: any): CashBranchTransfer => {
  const detail = row.money_transfer_cash_details?.[0] ?? row.money_transfer_cash_details;
  return {
    id: row.id, locationId: row.location_id, targetLocationId: row.target_location_id, targetLocationName: row.target_location_name,
    createdByName: row.created_by_name, createdByPhone: row.created_by_phone, createdByUserId: row.created_by_user_id,
    sent: mapCounts(detail, "sent")!, received: mapCounts(detail, "received"), sentTotal: Number(detail.sent_total), receivedTotal: detail.received_total == null ? null : Number(detail.received_total), differenceTotal: detail.difference_total == null ? null : Number(detail.difference_total),
    status: detail.cash_status, note: detail.note, sentAt: detail.sent_at, receivedAt: detail.received_at, receivedByName: detail.received_by_name, receivedByPhone: detail.received_by_phone,
    reportLockNo: row.report_lock_no ?? null,
  };
};

async function request(url: string, method: string, body?: unknown, signal?: AbortSignal) {
  const response = body === undefined
    ? await authFetch(url, { method, signal })
    : await authFetchJson(url, method, body, { signal });
  await assertApiResponse(response);
  return response.json();
}

export function useCashBranchTransfers(locationId: string) {
  const client = useQueryClient();
  const refresh = () => {
    client.invalidateQueries({ queryKey: [...KEYS, locationId] });
    client.invalidateQueries({ queryKey: [INCOME_EXPENSE_FEED_QUERY_KEY] });
    client.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] });
  };
  const query = useQuery({ queryKey: [...KEYS, locationId], enabled: !!locationId, refetchInterval: 15000, queryFn: async ({ signal }) => {
    const data = await request(`/api/lanflow/cash-branch-transfers?locationId=${encodeURIComponent(locationId)}`, "GET", undefined, signal);
    return (data.transfers ?? []).map(mapTransfer) as CashBranchTransfer[];
  }});
  const create = useMutation({ mutationFn: (payload: unknown) => request("/api/lanflow/cash-branch-transfers", "POST", payload), onSuccess: refresh });
  const update = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: unknown }) => request(`/api/lanflow/cash-branch-transfers/${id}`, "PATCH", payload), onSuccess: refresh });
  const receive = useMutation({ mutationFn: ({ id, received }: { id: string; received: CashDenominationCounts }) => request(`/api/lanflow/cash-branch-transfers/${id}/receive`, "POST", { received }), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: (id: string) => request(`/api/lanflow/cash-branch-transfers/${id}`, "DELETE") as Promise<{
      id: string;
      status: "deleted" | "pending_approval";
      requestId?: string;
    }>,
    onSuccess: () => {
      refresh();
      client.invalidateQueries({ queryKey: ["incomeExpenseApprovalRequests"] });
    },
  });
  return { transfers: query.data ?? [], isLoading: query.isLoading, create, update, receive, remove };
}
