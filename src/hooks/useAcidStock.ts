import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AcidStockBalance, AcidStockMovement } from "@/types";
import { STOCK_ENTRY_APPROVAL_REQUESTS_KEY } from "@/hooks/useStockEntryApprovals";
import { authFetch } from "@/lib/auth-fetch";

const QUERY_KEY = "stock";
const PAGE_SIZE = 50;

export type StockMovementFilter = "all" | "receive" | "transfer" | "sale" | "rubber_bill";

type MovementPage = {
  movements: AcidStockMovement[];
  hasMore: boolean;
  nextCursor: string | null;
};

async function readJson<T>(url: string): Promise<T> {
  const response = await authFetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.errorMessage || "โหลดข้อมูลสต็อกไม่สำเร็จ");
  return data as T;
}

async function postStock(payload: Record<string, unknown>) {
  const response = await authFetch("/api/lanflow/acid-stock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.errorMessage || data.error || "บันทึกสต็อกไม่สำเร็จ");
  return data;
}

function makeRequestKey(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

async function postStockEntryDeleteRequest(input: { stockEntryId: string }) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("ลบรายการสต็อกต้องออนไลน์ก่อน");
  }
  const response = await authFetch("/api/lanflow/stock-entry-approval-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestIdempotencyKey: makeRequestKey("delete-stock-entry"),
      stockEntryId: input.stockEntryId,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.errorMessage || data.error || "ส่งคำขอลบรายการสต็อกไม่สำเร็จ");
  if (data.status !== "pending") throw new Error(data.errorMessage || "ส่งคำขอลบรายการสต็อกไม่สำเร็จ");
  return data;
}

export function useAcidStock(
  locationId: string,
  options: {
    online: boolean;
    search: string;
    type: StockMovementFilter;
    fromDate: string;
    toDate: string;
    includeMovements?: boolean;
  },
) {
  const queryClient = useQueryClient();

  const balancesQuery = useQuery({
    queryKey: [QUERY_KEY, locationId, "balances"],
    queryFn: async () => {
      const params = new URLSearchParams({ view: "balances", locationId });
      const body = await readJson<{ balances: AcidStockBalance[] }>(`/api/lanflow/acid-stock?${params}`);
      return body.balances;
    },
    enabled: Boolean(locationId) && options.online,
  });

  const movementsQuery = useInfiniteQuery({
    queryKey: [
      QUERY_KEY,
      locationId,
      "movements",
      options.search,
      options.type,
      options.fromDate,
      options.toDate,
    ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        view: "movements",
        locationId,
        search: options.search,
        type: options.type,
        limit: String(PAGE_SIZE),
      });
      if (options.fromDate) params.set("fromDate", options.fromDate);
      if (options.toDate) params.set("toDate", options.toDate);
      if (pageParam) params.set("cursor", pageParam);
      return readJson<MovementPage>(`/api/lanflow/acid-stock?${params}`);
    },
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor : undefined,
    enabled: Boolean(locationId) && options.online && options.includeMovements !== false,
  });

  const receiveMutation = useMutation({
    mutationFn: async (input: { locationId: string; productId: string; txDate: string; quantity: number; amount: number }) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("รับเข้าสต็อกต้องออนไลน์ก่อน");
      return postStock({ action: "receive", ...input });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });

  const transferMutation = useMutation({
    mutationFn: async (input: { fromLocationId: string; toLocationId: string; productId: string; txDate: string; quantity: number }) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("ย้ายสต็อกต้องออนไลน์ก่อน");
      return postStock({ action: "transfer", ...input });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });

  const deleteEntryMutation = useMutation({
    mutationFn: postStockEntryDeleteRequest,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [STOCK_ENTRY_APPROVAL_REQUESTS_KEY] }),
  });

  const seen = new Set<string>();
  const movements = (movementsQuery.data?.pages ?? []).flatMap((page) =>
    page.movements.filter((movement) => {
      if (seen.has(movement.movementId)) return false;
      seen.add(movement.movementId);
      return true;
    }),
  );

  async function loadMore() {
    const result = await movementsQuery.fetchNextPage();
    if (result.isError) return false;
    const loadedIds = new Set(
      (result.data?.pages ?? []).flatMap((page) => page.movements.map((movement) => movement.movementId)),
    );
    return loadedIds.size > movements.length;
  }

  return {
    balances: balancesQuery.data ?? [],
    movements,
    balancesLoading: balancesQuery.isLoading,
    movementsLoading: movementsQuery.isLoading,
    balancesError: balancesQuery.error instanceof Error ? balancesQuery.error.message : null,
    movementsError: movementsQuery.error instanceof Error ? movementsQuery.error.message : null,
    hasMore: movementsQuery.hasNextPage,
    isLoadingMore: movementsQuery.isFetchingNextPage,
    loadMore,
    receiveStock: receiveMutation.mutateAsync,
    transferStock: transferMutation.mutateAsync,
    deleteStockEntry: deleteEntryMutation.mutateAsync,
  };
}
