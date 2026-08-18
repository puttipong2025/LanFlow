"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { invalidateMoneyFlowLocation } from "@/lib/money-flow/invalidation";
import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MoneyTransfer, MoneyTransferItem, MoneyTransferSlip } from "@/types";

export type MergePendingMoneyTransfersResult = {
  mergedGroupCount: number;
  mergedTransferCount: number;
  deletedTransferCount: number;
  skippedTransferCount: number;
  survivorIds: string[];
};

export type MoneyTransferStatusFilter = MoneyTransfer["transferStatus"] | "all";

function mapSlip(row: any): MoneyTransferSlip {
  return {
    id: row.id,
    amount: Number(row.amount ?? 0),
    referenceNumber: row.reference_number,
    fee: Number(row.fee ?? 0),
    senderName: row.sender_name,
    receiverName: row.receiver_name,
    transactionDate: row.transaction_date,
    slipImageUrl: row.slip_image_url,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

function mapItem(row: any): MoneyTransferItem {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    customerName: row.customer_name,
    amount: Number(row.amount ?? 0),
    sourceNumber: row.sourceNumber ?? row.source_number,
    sourceDate: row.sourceDate ?? row.source_date,
    netWeightAfterDeduction: row.netWeightAfterDeduction == null ? null : Number(row.netWeightAfterDeduction),
    averagePrice: row.averagePrice == null ? null : Number(row.averagePrice),
    rubberValue: row.rubberValue == null ? null : Number(row.rubberValue),
    deductedAmount: row.deductedAmount == null ? null : Number(row.deductedAmount),
    netPayableAmount: row.netPayableAmount == null ? null : Number(row.netPayableAmount),
  };
}

export function mapMoneyTransferRow(row: any): MoneyTransfer {
  return {
    id: row.id,
    clientTempId: row.client_temp_id ?? row.id,
    idempotencyKey: row.idempotency_key ?? `server:${row.id}`,
    locationId: row.location_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    accountNumber: row.account_number,
    accountName: row.account_name,
    bankName: row.bank_name,
    netAmountToPay: Number(row.net_amount_to_pay ?? 0),
    paidAmount: row.paid_amount == null ? undefined : Number(row.paid_amount),
    sourceCount: row.source_count == null ? undefined : Number(row.source_count),
    branchPaidAmount: row.branch_paid_amount == null ? undefined : Number(row.branch_paid_amount),
    transferType: row.transfer_type ?? "customer",
    transportCost: row.transport_cost == null ? undefined : Number(row.transport_cost),
    transportStaffId: row.transport_staff_id,
    transportStaffName: row.transport_staff_name,
    targetLocationId: row.target_location_id,
    targetLocationName: row.target_location_name,
    transferStatus: row.transfer_status,
    syncStatus: row.sync_status ?? "synced",
    recordStatus: row.record_status ?? "active",
    revisionNo: Number(row.revision_no ?? 0),
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdByPhone: row.created_by_phone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reportLockNo: row.report_lock_no ?? null,
    slips: Array.isArray(row.money_transfer_slips) ? row.money_transfer_slips.map(mapSlip) : undefined,
    items: Array.isArray(row.money_transfer_items) ? row.money_transfer_items.map(mapItem) : undefined,
  };
}

export function useMoneyTransferList({
  locationId,
  status = "all",
  search = "",
}: {
  locationId: string;
  status?: MoneyTransferStatusFilter;
  search?: string;
}) {
  const supabase = createSupabaseBrowserClient();
  const normalizedSearch = search.trim().toLocaleLowerCase("th-TH");
  const query = useInfiniteQuery({
    queryKey: moneyFlowQueryKeys.moneyTransferList(locationId, status, normalizedSearch),
    initialPageParam: null as { createdAt: string; id: string } | null,
    enabled: Boolean(locationId),
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("get_money_transfer_list", {
        p_location_id: locationId,
        p_status: status,
        p_search: normalizedSearch,
        p_cursor_created_at: pageParam?.createdAt ?? null,
        p_cursor_id: pageParam?.id ?? null,
        p_page_size: 50,
      });
      if (error) throw new Error(error.message);
      const payload = (data ?? {}) as any;
      return {
        rows: (payload.rows ?? []).map(mapMoneyTransferRow) as MoneyTransfer[],
        statusCounts: (payload.statusCounts ?? {}) as Record<string, number>,
        nextCursor: payload.hasMore && payload.nextCreatedAt && payload.nextId
          ? { createdAt: String(payload.nextCreatedAt), id: String(payload.nextId) }
          : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });
  return {
    transfers: query.data?.pages.flatMap((page) => page.rows) ?? [],
    statusCounts: query.data?.pages[0]?.statusCounts ?? {},
    hasMore: Boolean(query.hasNextPage),
    loadMore: query.fetchNextPage,
    isLoading: query.isLoading,
    isLoadingMore: query.isFetchingNextPage,
    error: query.error,
  };
}

export async function loadMoneyTransferDetail(transferId: string) {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_money_transfer_detail", { p_transfer_id: transferId });
  if (error) throw new Error(error.message);
  return mapMoneyTransferRow(data);
}

export function useMoneyTransferDetail(transferId: string | null) {
  return useQuery({
    queryKey: moneyFlowQueryKeys.moneyTransferDetail(transferId ?? ""),
    enabled: Boolean(transferId),
    queryFn: () => loadMoneyTransferDetail(transferId!),
  });
}

export async function getMoneyTransferReceiptSourceDetails(transferId: string) {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_money_transfer_receipt_source_details", {
    p_transfer_id: transferId,
  });
  if (error) throw new Error(error.message || "โหลดรายละเอียดต้นทางไม่สำเร็จ");
  const items = (data as any)?.items;
  if (!Array.isArray(items)) throw new Error("รูปแบบรายละเอียดต้นทางไม่ถูกต้อง");
  return items.map((item) => mapItem({
    ...item,
    id: item.itemId,
    source_type: item.sourceType,
    source_id: item.sourceId,
    customer_name: item.customerName,
    amount: item.netPayableAmount,
  }));
}

function moneyTransferError(error: { message?: string }) {
  const message = error.message ?? "บันทึกรายการโอนเงินไม่สำเร็จ";
  if (message.includes("MT_SOURCE_ALREADY_USED")) return new Error("แหล่งจ่ายถูกใช้ในรายการโอนอื่นแล้ว กรุณาโหลดรายการใหม่");
  if (message.includes("MT_REVISION_CONFLICT")) return new Error("ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่ก่อนบันทึก");
  return new Error(message.replace(/^.*MT_[A-Z_]+:\s*/, ""));
}

export function useMoneyTransferMutations(locationId: string, ownerUserId = "") {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();
  const refresh = () => invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId });
  async function saveTransfer(transfer: MoneyTransfer, operation: "create" | "update") {
      const { data, error } = await supabase.rpc("save_money_transfer", {
        p_payload: { ...transfer, operation },
      });
      if (error) throw moneyTransferError(error);
      return mapMoneyTransferRow(data);
  }
  const addTransfer = useMutation({
    mutationFn: (transfer: MoneyTransfer) => saveTransfer(transfer, "create"),
    onSuccess: refresh,
  });
  const updateTransfer = useMutation({
    mutationFn: (transfer: MoneyTransfer) => saveTransfer(transfer, "update"),
    onSuccess: refresh,
  });
  const deleteTransfer = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("delete_money_transfer", { p_transfer_id: id });
      if (error) throw new Error(error.message || "ลบรายการโอนเงินไม่สำเร็จ");
      if ((data as { status?: string } | null)?.status !== "deleted") throw new Error("ลบรายการโอนเงินไม่สำเร็จ");
      return data;
    },
    onSuccess: refresh,
  });
  const mergePendingTransfers = useMutation({
    mutationFn: async (): Promise<MergePendingMoneyTransfersResult> => {
      const { data, error } = await supabase.rpc("merge_pending_money_transfers", { p_location_id: locationId });
      if (error) throw new Error(error.message || "รวมรายการรอโอนไม่สำเร็จ");
      return data as MergePendingMoneyTransfersResult;
    },
    onSuccess: refresh,
  });
  return { addTransfer, updateTransfer, deleteTransfer, mergePendingTransfers };
}

export function useMoneyTransfers(locationId: string) {
  const list = useMoneyTransferList({ locationId });
  const mutations = useMoneyTransferMutations(locationId);
  return {
    ...list,
    ...mutations,
    getReceiptSourceDetails: getMoneyTransferReceiptSourceDetails,
    isError: Boolean(list.error),
  };
}
