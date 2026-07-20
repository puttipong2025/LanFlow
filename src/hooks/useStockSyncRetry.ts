import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getPendingEvents, removeSyncEvent, updateSyncEvent, type SyncEvent } from "@/lib/idb-queue";

type StockSyncEntity = "income_expense" | "rubber_bills";

type StockSyncRetryResult = {
  attempted: number;
  synced: number;
  stopped: boolean;
  errorMessage?: string;
  entity?: StockSyncEntity;
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

async function retryStockSyncEvents(locationId: string, ownerUserId: string, queryClient: any): Promise<StockSyncRetryResult> {
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

  let attempted = 0;
  let synced = 0;

  for (const event of events) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return {
        attempted,
        synced,
        stopped: true,
        entity: event.entity as StockSyncEntity,
        errorMessage: "ออฟไลน์ระหว่างซิงก์รายการ",
      };
    }

    attempted += 1;

    try {
      const response = await fetch(stockEventEndpoint(event.entity as StockSyncEntity), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event.payload),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        await removeSyncEvent(event.queueId!);
        synced += 1;
        continue;
      }

      event.status = data.status === "conflict" ? "conflict" : "failed";
      event.errorMessage = data.errorMessage || data.error || "ซิงก์รายการไม่สำเร็จ";
      await updateSyncEvent(event);

      return {
        attempted,
        synced,
        stopped: true,
        entity: event.entity as StockSyncEntity,
        errorMessage: event.errorMessage,
      };
    } catch (error) {
      event.status = "failed";
      event.errorMessage = error instanceof Error ? error.message : "ซิงก์รายการไม่สำเร็จ";
      await updateSyncEvent(event);

      return {
        attempted,
        synced,
        stopped: true,
        entity: event.entity as StockSyncEntity,
        errorMessage: event.errorMessage,
      };
    } finally {
      queryClient.invalidateQueries({ queryKey: ["stock", locationId] });
      queryClient.invalidateQueries({ queryKey: ["acidStock", locationId] });
      queryClient.invalidateQueries({ queryKey: ["incomeExpense", locationId] });
      queryClient.invalidateQueries({ queryKey: ["rubberBills", locationId] });
    }
  }

  queryClient.invalidateQueries({ queryKey: ["stock", locationId] });
  queryClient.invalidateQueries({ queryKey: ["acidStock", locationId] });
  queryClient.invalidateQueries({ queryKey: ["incomeExpense", locationId] });
  queryClient.invalidateQueries({ queryKey: ["rubberBills", locationId] });

  return { attempted, synced, stopped: false };
}

export function useStockSyncRetry(locationId: string, ownerUserId: string) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => retryStockSyncEvents(locationId, ownerUserId, queryClient),
  });

  return {
    retryStockSync: mutation.mutateAsync,
    isRetrying: mutation.isPending,
  };
}
