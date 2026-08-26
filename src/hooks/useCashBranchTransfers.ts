import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ACTIONABLE_BADGES_QUERY_KEY } from "@/hooks/useActionableBadges";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { authFetch, authFetchJson, assertApiResponse } from "@/lib/auth-fetch";
import {
  cashBranchTransferQueryKeys,
  INCOME_EXPENSE_FEED_QUERY_KEY,
} from "@/lib/income-expense/query-keys";
import { invalidateMoneyFlowLocation } from "@/lib/money-flow/invalidation";
import type { CashBranchTransfer, CashBranchTransferSummary, CashDenominationCounts } from "@/types";

const mapCounts = (row: Record<string, unknown>, prefix: "sent" | "received"): CashDenominationCounts | null => {
  if (row[`${prefix}_coin_1_count`] == null) return null;
  return {
    coin1: Number(row[`${prefix}_coin_1_count`]), coin2: Number(row[`${prefix}_coin_2_count`]),
    coin5: Number(row[`${prefix}_coin_5_count`]), coin10: Number(row[`${prefix}_coin_10_count`]),
    banknote20: Number(row[`${prefix}_banknote_20_count`]), banknote50: Number(row[`${prefix}_banknote_50_count`]),
    banknote100: Number(row[`${prefix}_banknote_100_count`]), banknote500: Number(row[`${prefix}_banknote_500_count`]),
    banknote1000: Number(row[`${prefix}_banknote_1000_count`]),
  };
};

function mapTransfer(raw: unknown): CashBranchTransfer {
  const row = raw as Record<string, unknown>;
  const nested = row.money_transfer_cash_details;
  const detail = (Array.isArray(nested) ? nested[0] : nested) as Record<string, unknown>;
  return {
    id: String(row.id), locationId: String(row.location_id), targetLocationId: String(row.target_location_id),
    targetLocationName: row.target_location_name == null ? null : String(row.target_location_name),
    createdByName: String(row.created_by_name), createdByPhone: String(row.created_by_phone),
    createdByUserId: row.created_by_user_id == null ? null : String(row.created_by_user_id),
    sent: mapCounts(detail, "sent")!, received: mapCounts(detail, "received"), sentTotal: Number(detail.sent_total),
    receivedTotal: detail.received_total == null ? null : Number(detail.received_total),
    differenceTotal: detail.difference_total == null ? null : Number(detail.difference_total),
    status: detail.cash_status as CashBranchTransfer["status"], note: detail.note == null ? null : String(detail.note),
    sentAt: String(detail.sent_at), receivedAt: detail.received_at == null ? null : String(detail.received_at),
    receivedByName: detail.received_by_name == null ? null : String(detail.received_by_name),
    receivedByPhone: detail.received_by_phone == null ? null : String(detail.received_by_phone),
    reportLockNo: row.report_lock_no == null ? null : String(row.report_lock_no),
  };
}

function mapSummary(raw: unknown): CashBranchTransferSummary {
  const row = raw as Record<string, unknown>;
  return {
    id: String(row.id), locationId: String(row.locationId),
    sourceLocationName: row.sourceLocationName == null ? null : String(row.sourceLocationName),
    targetLocationId: String(row.targetLocationId), targetLocationName: row.targetLocationName == null ? null : String(row.targetLocationName),
    createdByUserId: row.createdByUserId == null ? null : String(row.createdByUserId),
    createdByName: String(row.createdByName), createdByPhone: String(row.createdByPhone), sentTotal: Number(row.sentTotal),
    status: "pending_receipt", note: row.note == null ? null : String(row.note), sentAt: String(row.sentAt),
    reportLockNo: row.reportLockNo == null ? null : String(row.reportLockNo),
  };
}

async function request(url: string, method: string, body?: unknown, signal?: AbortSignal) {
  const response = body === undefined ? await authFetch(url, { method, signal }) : await authFetchJson(url, method, body, { signal });
  await assertApiResponse(response);
  return response.json();
}

export function useCashBranchTransfers(ownerUserId: string, locationId: string, detailId?: string | null) {
  const client = useQueryClient();
  const online = useOnlineStatus();
  const refresh = () => Promise.all([
    invalidateMoneyFlowLocation(client, { ownerUserId, locationId }),
    client.invalidateQueries({ queryKey: cashBranchTransferQueryKeys.root() }),
    client.invalidateQueries({ queryKey: [INCOME_EXPENSE_FEED_QUERY_KEY] }),
    client.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] }),
    client.invalidateQueries({ queryKey: ["incomeExpenseApprovalRequests"] }),
  ]);
  const pendingQuery = useQuery({
    queryKey: cashBranchTransferQueryKeys.pending(ownerUserId, locationId), enabled: Boolean(ownerUserId && locationId && online), refetchInterval: online ? 15_000 : false, retry: false,
    queryFn: async ({ signal }) => {
      const data = await request(`/api/lanflow/cash-branch-transfers?locationId=${encodeURIComponent(locationId)}&view=pending`, "GET", undefined, signal) as { transfers?: unknown[]; total?: number };
      return { transfers: (data.transfers ?? []).slice(0, 20).map(mapSummary), total: Number(data.total ?? 0) };
    },
  });
  const detailQuery = useQuery({
    queryKey: cashBranchTransferQueryKeys.detail(ownerUserId, locationId, detailId ?? "none"), enabled: Boolean(ownerUserId && detailId && online), retry: false,
    queryFn: async ({ signal }) => {
      const data = await request(`/api/lanflow/cash-branch-transfers/${detailId!}`, "GET", undefined, signal) as { transfer: unknown };
      return mapTransfer(data.transfer);
    },
  });
  const loadDetail = (id: string) => client.fetchQuery({
    queryKey: cashBranchTransferQueryKeys.detail(ownerUserId, locationId, id),
    queryFn: async ({ signal }) => {
      const data = await request(`/api/lanflow/cash-branch-transfers/${id}`, "GET", undefined, signal) as { transfer: unknown };
      return mapTransfer(data.transfer);
    },
  });
  const create = useMutation({ mutationFn: (payload: unknown) => request("/api/lanflow/cash-branch-transfers", "POST", payload), onSuccess: refresh });
  const update = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: unknown }) => request(`/api/lanflow/cash-branch-transfers/${id}`, "PATCH", payload), onSuccess: refresh });
  const receive = useMutation({ mutationFn: ({ id, received }: { id: string; received: CashDenominationCounts }) => request(`/api/lanflow/cash-branch-transfers/${id}/receive`, "POST", { received }), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: (id: string) => request(`/api/lanflow/cash-branch-transfers/${id}`, "DELETE") as Promise<{ id: string; status: "deleted" | "pending_approval"; requestId?: string }>,
    onSuccess: refresh,
  });
  return {
    pendingTransfers: pendingQuery.data?.transfers ?? [], pendingTotal: pendingQuery.data?.total ?? 0,
    isPendingLoading: pendingQuery.isLoading,
    isPendingError: pendingQuery.isError,
    pendingError: pendingQuery.isError ? "โหลดคิวรอรับเงินสดไม่สำเร็จ" : null,
    retryPending: pendingQuery.refetch,
    detail: detailQuery.data,
    isDetailLoading: detailQuery.isLoading,
    isDetailError: detailQuery.isError,
    detailError: detailQuery.isError ? "โหลดรายละเอียดเงินสดไม่สำเร็จ" : null,
    retryDetail: detailQuery.refetch,
    loadDetail,
    create, update, receive, remove,
  };
}
