import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { authFetch } from "@/lib/auth-fetch";
import { isDeviceOnline } from "@/lib/connectivity";
import { getPendingEvents } from "@/lib/idb-queue";
import {
  incomeExpenseSyncProblems,
  mergeIncomeExpenseLocalEvents,
  mergeIncomeExpenseOperationalLatestPages,
  normalizeIncomeExpenseSearch,
  type IncomeExpenseOperationalFeedPage,
  type IncomeExpenseOperationalMode,
} from "@/lib/income-expense/operational-list";
import { incomeExpenseOperationalQueryKeys } from "@/lib/income-expense/query-keys";

function queuePartition(ownerUserId: string, locationId: string) {
  return { entity: "income_expense" as const, ownerUserId, locationId };
}

export function useIncomeExpenseOperationalList({
  locationId,
  ownerUserId,
  mode,
  search,
}: {
  locationId: string;
  ownerUserId: string;
  mode: IncomeExpenseOperationalMode;
  search: string;
}) {
  const queryClient = useQueryClient();
  const normalizedSearch = useMemo(() => normalizeIncomeExpenseSearch(search), [search]);
  const online = isDeviceOnline();
  const serverMode = mode === "sync_problems" ? "latest" : mode;
  const serverFeedEnabled = Boolean(ownerUserId && locationId && online && mode !== "sync_problems");
  const feedKey = incomeExpenseOperationalQueryKeys.feed(ownerUserId, locationId, serverMode, normalizedSearch);
  const pendingKey = incomeExpenseOperationalQueryKeys.pending(ownerUserId, locationId);
  const pendingQuery = useQuery({
    queryKey: pendingKey,
    enabled: Boolean(ownerUserId && locationId),
    networkMode: "always",
    queryFn: () => getPendingEvents(queuePartition(ownerUserId, locationId)),
  });
  const feedQuery = useInfiniteQuery({
    queryKey: feedKey,
    initialPageParam: null as string | null,
    enabled: serverFeedEnabled,
    queryFn: async ({ pageParam, signal }): Promise<IncomeExpenseOperationalFeedPage> => {
      const params = new URLSearchParams({ locationId, mode: serverMode, search: normalizedSearch });
      if (pageParam) params.set("cursor", pageParam);
      const response = await authFetch(`/api/lanflow/income-expense/feed?${params}`, { signal });
      if (!response.ok) throw new Error("โหลดรายการรับ-จ่ายไม่สำเร็จ");
      const data = await response.json() as Partial<IncomeExpenseOperationalFeedPage>;
      return {
        rows: Array.isArray(data.rows) ? data.rows : [],
        nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
        hasMore: data.hasMore === true,
        pendingApprovalCount: Number(data.pendingApprovalCount ?? 0),
      };
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const pages = feedQuery.data?.pages;
  const localEvents = pendingQuery.data;
  const rows = useMemo(() => {
    const loadedPages = pages ?? [];
    const queuedEvents = localEvents ?? [];
    if (mode === "sync_problems") return incomeExpenseSyncProblems(queuedEvents, normalizedSearch);
    if (!online) {
      return mode === "latest"
        ? mergeIncomeExpenseLocalEvents([], queuedEvents, normalizedSearch)
        : [];
    }
    if (mode !== "latest") return loadedPages.flatMap((page) => page.rows);
    return mergeIncomeExpenseOperationalLatestPages(loadedPages, queuedEvents, normalizedSearch);
  }, [localEvents, mode, normalizedSearch, online, pages]);
  const pendingApprovalCount = pages?.[0]?.pendingApprovalCount ?? 0;

  return {
    rows,
    pendingApprovalCount,
    hasMore: feedQuery.hasNextPage,
    isLoadingMore: feedQuery.isFetchingNextPage,
    isLoading: pendingQuery.isLoading || (mode !== "sync_problems" && online && feedQuery.isLoading),
    isError: pendingQuery.isError || (serverFeedEnabled && feedQuery.isError),
    fetchNextPage: feedQuery.fetchNextPage,
    refresh: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: incomeExpenseOperationalQueryKeys.root() }),
      queryClient.invalidateQueries({ queryKey: pendingKey }),
    ]),
  };
}
