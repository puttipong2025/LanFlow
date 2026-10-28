import { notifyRubberBackgroundFailure } from "@/lib/rubber-bills/background-notifications";
import { sendRubberBillCommand, isConfirmedRubberSyncResult, recordRubberSyncFailure, acknowledgeRubberCommand } from "@/lib/rubber-bills/command";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getPendingEvents, removeSyncEvent, updateSyncEvent, reconcileSyncEventsIfCurrent, type SyncEvent } from "@/lib/idb-queue";
import { authFetch } from "@/lib/auth-fetch";
import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";

type StockSyncEntity = "income_expense" | "rubber_bills";

type StockSyncRetryResult = {
  attempted: number;
  synced: number;
  silent?: number;
  silentFailure?: boolean;
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
        if (event.entity === "rubber_bills") {
          const marked = { ...event, serverSubmissionAttempted: true };
          if (!await reconcileSyncEventsIfCurrent([event], marked)) throw new Error("คิวเปลี่ยนจากอีกหน้าต่าง กรุณาลองใหม่");
          Object.assign(event, marked);
        }
        const response = await (event.entity === "rubber_bills" ? sendRubberBillCommand(event, {
          ...event.payload, submissionMode: "replay",
          ...(event.operation !== "create" && event.serverId ? { expectedServerId: event.serverId } : {}),
        }) : authFetch("/api/lanflow/income-expense", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event.payload),
        }));

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          if (event.entity === "rubber_bills") {
            if (!isConfirmedRubberSyncResult(data, event)) {
              await recordRubberSyncFailure(event, 503, {});
              throw new Error("กำลังรอยืนยันผลบิลยางจากเซิร์ฟเวอร์");
            }
            if (!await acknowledgeRubberCommand(event, data)) throw new Error("คิวเปลี่ยนระหว่างยืนยันผล กรุณาลองใหม่");
          } else {
            await removeSyncEvent(event.queueId!);
          }
          if (data.silent) result.silent = (result.silent ?? 0) + 1;
          result.synced += 1;
          continue;
        }

        if (event.entity === "rubber_bills") {
          if (await recordRubberSyncFailure(event, response.status, data) === "discarded") { result.synced += 1; continue; }
        } else {
          event.status = data.status === "conflict" ? "conflict" : "failed";
          event.errorMessage = data.errorMessage || data.error || "ซิงก์รายการไม่สำเร็จ";
          await updateSyncEvent(event);
        }
      } catch (error) {
        if (event.entity === "rubber_bills") {
          if (event.status === "pending") await recordRubberSyncFailure(event, 0, {});
        } else {
          event.status = "failed";
          event.errorMessage = error instanceof Error ? error.message : "ซิงก์รายการไม่สำเร็จ";
          await updateSyncEvent(event);
        }
      }

      if (event.entity === "rubber_bills" && event.payload.background) {
        await notifyRubberBackgroundFailure(event); result.silentFailure = true;
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
