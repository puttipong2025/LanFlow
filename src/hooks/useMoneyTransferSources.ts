"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type MoneyTransferSourceType = "rubber_bill" | "ocr_ticket";

export type MoneyTransferSourceRow = {
  sourceType: MoneyTransferSourceType;
  sourceId: string;
  sourceNumber: string;
  sourceDate: string | null;
  customerName: string | null;
  amount: number;
  netWeight: number | null;
  averagePrice: number | null;
  rubberValue: number | null;
  deductedAmount: number | null;
  licensePlate: string | null;
  transferId: string | null;
  reportLockNo: string | null;
  available: boolean;
  blockReason: string | null;
  createdAt: string;
};

function mapRow(row: any): MoneyTransferSourceRow {
  return {
    sourceType: row.sourceType,
    sourceId: String(row.sourceId),
    sourceNumber: String(row.sourceNumber ?? "—"),
    sourceDate: row.sourceDate == null ? null : String(row.sourceDate),
    customerName: row.customerName == null ? null : String(row.customerName),
    amount: Number(row.amount ?? 0),
    netWeight: row.netWeight == null ? null : Number(row.netWeight),
    averagePrice: row.averagePrice == null ? null : Number(row.averagePrice),
    rubberValue: row.rubberValue == null ? null : Number(row.rubberValue),
    deductedAmount: row.deductedAmount == null ? null : Number(row.deductedAmount),
    licensePlate: row.licensePlate == null ? null : String(row.licensePlate),
    transferId: row.transferId == null ? null : String(row.transferId),
    reportLockNo: row.reportLockNo == null ? null : String(row.reportLockNo),
    available: row.available === true,
    blockReason: row.blockReason == null ? null : String(row.blockReason),
    createdAt: String(row.createdAt),
  };
}

export function useMoneyTransferSources({
  locationId,
  sourceType,
  search = "",
  selectedIds = [],
  enabled = true,
}: {
  locationId: string;
  sourceType: MoneyTransferSourceType;
  search?: string;
  selectedIds?: string[];
  enabled?: boolean;
}) {
  const supabase = createSupabaseBrowserClient();
  const normalizedSearch = search.trim().toLocaleLowerCase("th-TH");
  const selectionKey = [...selectedIds].sort().join(",");
  const query = useInfiniteQuery({
    queryKey: [...moneyFlowQueryKeys.moneyTransferSources(locationId, sourceType, normalizedSearch), selectionKey],
    initialPageParam: null as { createdAt: string; id: string } | null,
    enabled: enabled && Boolean(locationId),
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("get_money_transfer_sources", {
        p_location_id: locationId,
        p_source_type: sourceType,
        p_search: normalizedSearch,
        p_cursor_created_at: pageParam?.createdAt ?? null,
        p_cursor_id: pageParam?.id ?? null,
        p_page_size: 50,
        p_selected_ids: selectedIds,
      });
      if (error) throw new Error(error.message);
      const payload = (data ?? {}) as any;
      return {
        rows: (payload.rows ?? []).map(mapRow) as MoneyTransferSourceRow[],
        nextCursor: payload.hasMore && payload.nextCreatedAt && payload.nextId
          ? { createdAt: String(payload.nextCreatedAt), id: String(payload.nextId) }
          : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });
  const rowsById = new Map<string, MoneyTransferSourceRow>();
  for (const row of query.data?.pages.flatMap((page) => page.rows) ?? []) rowsById.set(row.sourceId, row);
  return {
    rows: [...rowsById.values()],
    hasMore: Boolean(query.hasNextPage),
    loadMore: query.fetchNextPage,
    isLoading: query.isLoading,
    isLoadingMore: query.isFetchingNextPage,
    error: query.error,
    refetch: query.refetch,
  };
}
