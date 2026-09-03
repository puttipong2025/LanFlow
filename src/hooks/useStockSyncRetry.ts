import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getPendingEvents, removeSyncEvent, updateSyncEvent, type SyncEvent } from "@/lib/idb-queue";
import { authFetch } from "@/lib/auth-fetch";
import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";

type StockSyncEntity = "income_expense" | "rubber_bills";

type StockSyncRetryResult = {
  attempted: number;
  synced: number;
  stopped: boolean;
  errorMessage?: string;
  entity?: StockSyncEntity;
  refreshError?: string;
};

function isIncomeStockEvent(event: SyncEvent) {
  const payload = event.payload as any;
  return (
    event.entity === "income_expense" &&
    payload?.billOption === "บิลขาย" &&
    !!payload?.stockProductId &&
    Number(payload?.stockQuantity ?? 0) > 0
  );
}

function isRubberStockEvent(event: SyncEvent) {
  const payload = event.payload as any;
  if (event.entity !== "rubber_bills" || !Array.isArray(payload?.items)) return false;
  return payload.items.some((item: any) =>
    (item?.itemType === "stock_deduction" || item?.itemType === "acid") &&
    !!item?.stockProductId &&
    Number(item?.quantity ?? 0) > 0
  );
}

function stockEventEndpoint(entity: StockSyncEntity) {
  return entity === "income_expense" ? "/api/lanflow/income-expense" : "/api/lanflow/rubber-bills";
}

async function invalidateStockSyncQueries(locationId: string, ownerUserId: string, queryClient: QueryClient) {
  const results = await Promise.allSettled([
    moneyFlowQueryKeys.stock(locationId),
    moneyFlowQueryKeys.incomeExpenseFeed(ownerUserId, locationId),
    [...moneyFlowQueryKeys.rubberBillOperationalFeedRoot(), ownerUserId, locationId],
    moneyFlowQueryKeys.rubberBillWorkCounts(ownerUserId, locationId),
  ].map((queryKey) => queryClient.invalidateQueries({ queryKey }, { throwOnError: true })));
  if (results.some((result) => result.status === "rejected") || (typeof navigator !== "undefined" && !navigator.onLine)) {
    throw new Error("โหลดข้อมูลหลังซิงก์ไม่สำเร็จ กรุณาโหลดข้อมูลใหม่");
  }
}

async function retryStockSyncEvents(locationId: string, ownerUserId: string, queryClient: QueryClient): Promise<StockSyncRetryResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("ซิงก์รายการได้เมื่อออนไลน์เท่านั้น");
  }
  if (!ownerUserId || !locationId) {
    throw new Error("ไม่พบผู้ใช้หรือสาขาสำหรับซิงก์รายการ");
  }

  const [incomeEvents, rubberEvents] = await Promise.all([
    getPendingEvents({ entity: "income_expense", ownerUserId, locationId }),
    getPendingEvents({ entity: "rubber_bills", ownerUserId, locationId }),
  ]);

  const events = [...incomeEvents, ...rubberEvents]
    .filter((event) => event.status === "pending" || event.status === "failed" || event.status === "conflict")
    .filter((event) => isIncomeStockEvent(event) || isRubberStockEvent(event))
    .sort((a, b) => (a.timestamp - b.timestamp) || ((a.queueId ?? 0) - (b.queueId ?? 0)));

  const result: StockSyncRetryResult = { attempted: 0, synced: 0, stopped: false };

  try {
    for (const event of events) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        result.stopped = true;
        result.entity = event.entity as StockSyncEntity;
        result.errorMessage = "ออฟไลน์ระหว่างซิงก์รายการ";
        return result;
      }

      result.attempted += 1;

      try {
        const response = await authFetch(stockEventEndpoint(event.entity as StockSyncEntity), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event.payload),
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          await removeSyncEvent(event.queueId!);
          result.synced += 1;
          continue;
        }

        event.status = data.status === "conflict" ? "conflict" : "failed";
        event.errorMessage = data.errorMessage || data.error || "ซิงก์รายการไม่สำเร็จ";
        await updateSyncEvent(event);
      } catch (error) {
        event.status = "failed";
        event.errorMessage = error instanceof Error ? error.message : "ซิงก์รายการไม่สำเร็จ";
        await updateSyncEvent(event);
      }

      result.stopped = true;
      result.entity = event.entity as StockSyncEntity;
      result.errorMessage = event.errorMessage;
      return result;
    }
    return result;
  } finally {
    if (result.attempted > 0) {
      try {
        await invalidateStockSyncQueries(locationId, ownerUserId, queryClient);
      } catch (error) {
        result.refreshError = error instanceof Error ? error.message : "โหลดข้อมูลหลังซิงก์ไม่สำเร็จ";
      }
    }
  }
}

export function useStockSyncRetry(locationId: string, ownerUserId: string) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => retryStockSyncEvents(locationId, ownerUserId, queryClient),
  });
  const refreshMutation = useMutation({
    mutationFn: () => invalidateStockSyncQueries(locationId, ownerUserId, queryClient),
  });

  return {
    retryStockSync: mutation.mutateAsync,
    isRetrying: mutation.isPending,
    refreshStockSync: refreshMutation.mutateAsync,
    isRefreshing: refreshMutation.isPending,
  };
}
