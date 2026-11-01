import { incomeExpenseFromSyncEvent as payloadToOptimisticRow } from "@/lib/income-expense/operational-list";
import { enqueueNumberedIncomeCreate, readIncomeSubmission } from "@/lib/income-expense/numbering-idb";
import { confirmIncomeNumberedEvent } from "@/lib/income-expense/numbering-receipts";
import { cancelUnsubmittedIncomeCreate } from "@/lib/income-expense/cancel-local-create";
import { isIncomeExpenseSyncResult } from "@/lib/income-expense/contracts";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { IncomeExpense } from "@/types";
import { enqueueSyncEvent, getPendingEvents, removeSyncEventIfCurrent, reconcileSyncEventsIfCurrent, updateSyncEventIfCurrent, type SyncEvent } from "@/lib/idb-queue";
import { coalesceQueueGroup } from "@/lib/coalesceQueueGroup";
import { isIncomeExpenseBackgroundCommand } from "@/lib/income-expense/background-command";
import { acceptIncomeExpenseBackground, runIncomeExpenseBackground } from "@/lib/income-expense/background-sync";
import { buildIncomeExpensePayload } from "@/lib/income-expense/build-income-expense-payload";
import { OFFLINE_SYNCED_ACTION_MESSAGE, PENDING_SERVER_ACTION_MESSAGE } from "@/lib/record-action-locks";
import { authFetch, canSyncCurrentSession } from "@/lib/auth-fetch";
import { isRetryableSyncResponse } from "@/lib/sync-response";
import { invalidateMoneyFlowLocation } from "@/lib/money-flow/invalidation";
import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";
import { createScopedSingleFlight } from "@/lib/scoped-single-flight";
import { useIncomeExpenseOperationalList } from "@/hooks/useIncomeExpenseOperationalList";
import type { IncomeExpenseOperationalMode } from "@/lib/income-expense/operational-list";
import { incomeExpenseOperationalQueryKeys } from "@/lib/income-expense/query-keys";

import { cacheConfirmedIncomeExpense, removeFromFeedCache, type IncomeExpenseSyncReceipt } from "@/lib/income-expense/feed-cache";

const ENTITY = "income_expense" as const;

export type IncomeExpenseStockShortage = {
  productId: string;
  productName: string;
  requestedQuantity: number;
  availableQuantity: number;
};

export class IncomeExpenseStockShortageError extends Error {
  constructor(public readonly shortages: IncomeExpenseStockShortage[]) {
    super("สินค้าในสต็อกไม่พอสำหรับบิลขาย");
    this.name = "IncomeExpenseStockShortageError";
  }
}

type IncomeExpenseSyncRejection = {
  errorCode: "STOCK_SHORTAGE";
  shortages: IncomeExpenseStockShortage[];
};
type IncomeExpenseSyncResult = {
  receipts: Map<string, IncomeExpenseSyncReceipt>;
  rejections: Map<string, IncomeExpenseSyncRejection>;
  pendingApprovalIds: Set<string>;
  attemptedIds: Set<string>;
};

function queuePartition(ownerUserId: string, locationId: string) {
  return { entity: ENTITY, ownerUserId, locationId };
}

async function normalizeQueue(ownerUserId: string, locationId: string) {
  const grouped = new Map<string, SyncEvent[]>();
  for (const event of await getPendingEvents(queuePartition(ownerUserId, locationId))) {
    const events = grouped.get(event.id) ?? [];
    events.push(event);
    grouped.set(event.id, events);
  }

  for (const events of grouped.values()) {
    if (events.length < 2 || events.some(isIncomeExpenseBackgroundCommand) || events.some((event) => (
      event.status !== "pending" || event.serverSubmissionAttempted === true
    ))) continue;
    const result = coalesceQueueGroup(events);
    await reconcileSyncEventsIfCurrent(events, result.action === "noop" ? undefined : result.keeper, true);
  }
}

const runIncomeExpenseSyncSingleFlight = createScopedSingleFlight();

async function runPendingIncomeExpenseSync(
  queryClient: ReturnType<typeof useQueryClient>,
  ownerUserId: string,
  locationId: string
) {
  const receipts = new Map<string, IncomeExpenseSyncReceipt>();
  const rejections = new Map<string, IncomeExpenseSyncRejection>();
  const pendingApprovalIds = new Set<string>();
  const attemptedIds = new Set<string>();
  await normalizeQueue(ownerUserId, locationId);
  const events = await getPendingEvents(queuePartition(ownerUserId, locationId));
  const blockedIds = new Set(events.filter((event) => event.status !== "pending").map((event) => event.id));

  for (const event of events) {
    if (isIncomeExpenseBackgroundCommand(event)) continue;
    if (!navigator.onLine || blockedIds.has(event.id)) continue;
    try {
      attemptedIds.add(event.id);
      if (event.serverSubmissionAttempted !== true) {
        const marked = { ...event, serverSubmissionAttempted: true };
        if (!await reconcileSyncEventsIfCurrent([event], marked)) continue;
        Object.assign(event, marked);
        await queryClient.invalidateQueries({ queryKey: incomeExpenseOperationalQueryKeys.pending(ownerUserId, locationId) });
      }
      const response = await authFetch("/api/lanflow/income-expense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event.payload),
      });
      const data = await response.json();
      if (response.ok && (!isIncomeExpenseSyncResult(data, event.payload)
        || data.status === "failed" || data.status === "conflict")) continue;
      if (response.ok) {
        if (event.payload.billNumbering && (data.status === "rejected" || data.status === "discarded")) {
          await confirmIncomeNumberedEvent(event, data); continue;
        }
        if (data.status === "pending_approval") {
          pendingApprovalIds.add(event.id);
          if (event.payload.billNumbering) await confirmIncomeNumberedEvent(event, data); else await removeSyncEventIfCurrent(event);
          continue;
        }
        if (event.operation === "delete") {
          await cacheConfirmedIncomeExpense(queryClient, ownerUserId, locationId, event);
        } else if (
          typeof data.id === "string"
          && typeof data.serverBillNo === "string"
          && data.serverBillNo
          && Number.isInteger(data.revisionNo)
        ) {
          const receipt: IncomeExpenseSyncReceipt = {
            id: data.id,
            serverBillNo: data.serverBillNo,
            revisionNo: data.revisionNo,
            serverReceivedAt:
              typeof data.serverReceivedAt === "string"
                ? data.serverReceivedAt
                : undefined,
            title: typeof data.title === "string" ? data.title : undefined,
            cost: typeof data.cost === "number" ? data.cost : undefined,
            saleLineCount: Number.isInteger(data.saleLineCount) ? data.saleLineCount : undefined,
            saleLines: Array.isArray(data.saleLines) ? data.saleLines : undefined,
          };
          receipts.set(event.id, receipt);
          await cacheConfirmedIncomeExpense(queryClient, ownerUserId, locationId, event, receipt);
        }
        if (event.payload.billNumbering) await confirmIncomeNumberedEvent(event, data); else await removeSyncEventIfCurrent(event);
      }
      else if (isRetryableSyncResponse(response.status, data)) {
        break;
      }
      else {
        if (!event.payload.billNumbering) event.serverSubmissionAttempted = false;
        if (
          data.errorCode === "STOCK_SHORTAGE"
          && event.payload.billOption === "บิลขาย"
          && event.operation !== "delete"
        ) {
          const shortages = Array.isArray(data.stockShortages)
            ? data.stockShortages.filter((item: unknown): item is IncomeExpenseStockShortage => {
                if (!item || typeof item !== "object") return false;
                const row = item as Record<string, unknown>;
                return typeof row.productId === "string"
                  && typeof row.productName === "string"
                  && typeof row.requestedQuantity === "number"
                  && typeof row.availableQuantity === "number";
              })
            : [];
          rejections.set(event.id, { errorCode: "STOCK_SHORTAGE", shortages });
          await removeSyncEventIfCurrent(event);
          continue;
        }
        event.status = data.status === "conflict" ? "conflict" : "failed";
        event.errorMessage = data.errorMessage || (event.status === "conflict" ? "ข้อมูลชนกัน" : "ซิงก์ไม่สำเร็จ");
        await updateSyncEventIfCurrent(event);
        blockedIds.add(event.id);
      }
    } catch {
      break;
    }
  }

  return { receipts, rejections, pendingApprovalIds, attemptedIds };
}

export function syncPendingIncomeExpense(
  queryClient: QueryClient,
  ownerUserId: string,
  locationId: string
): Promise<IncomeExpenseSyncResult> {
  if (!ownerUserId || !locationId || !navigator.onLine) {
    return Promise.resolve({
      receipts: new Map(),
      rejections: new Map(),
      pendingApprovalIds: new Set(),
      attemptedIds: new Set(),
    });
  }

  const scopeKey = `${ownerUserId}:${locationId}`;
  return runIncomeExpenseSyncSingleFlight(scopeKey, async () => (
    (await canSyncCurrentSession(ownerUserId, locationId) ? runPendingIncomeExpenseSync(queryClient, ownerUserId, locationId) : Promise.resolve({ receipts: new Map(), rejections: new Map(), pendingApprovalIds: new Set<string>(), attemptedIds: new Set<string>() }))
      .then(async (result) => {
      if (result.attemptedIds.size) await invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId });
      return result;
      })
  ));
}

export function useIncomeExpense(
  locationId: string,
  ownerUserId: string,
  options: { mode?: IncomeExpenseOperationalMode; search?: string } = {},
) {
  const queryClient = useQueryClient();
  const operationalList = useIncomeExpenseOperationalList({
    locationId,
    ownerUserId,
    mode: options.mode ?? "latest",
    search: options.search ?? "",
  });
  const transactions = operationalList.rows;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.incomeExpenseFeed(ownerUserId, locationId) });
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.incomeExpensePending(ownerUserId, locationId) });
  };

  async function syncTransaction(
    submittedTransaction: IncomeExpense
  ): Promise<{ status: "synced" | "pending_approval" }> {
    if (!navigator.onLine) throw new Error("บิลขายต้องออนไลน์จนกว่าจะซิงก์สำเร็จ");

    let syncResult: IncomeExpenseSyncResult | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      syncResult = await syncPendingIncomeExpense(queryClient, ownerUserId, locationId);
      const rejection = syncResult.rejections.get(submittedTransaction.clientTempId);
      if (rejection?.errorCode === "STOCK_SHORTAGE") {
        throw new IncomeExpenseStockShortageError(rejection.shortages);
      }
      if (syncResult.pendingApprovalIds.has(submittedTransaction.clientTempId)) {
        return { status: "pending_approval" };
      }

      const remainingEvents = (await getPendingEvents(queuePartition(ownerUserId, locationId)))
        .filter((event) => event.id === submittedTransaction.clientTempId);
      const failedEvent = remainingEvents.find(
        (event) => event.status === "failed" || event.status === "conflict"
      );
      if (failedEvent) {
        throw new Error(failedEvent.errorMessage || "ซิงก์บิลขายไม่สำเร็จ");
      }
      if (remainingEvents.length === 0) break;

      const joinedOlderFlight = !syncResult.attemptedIds.has(submittedTransaction.clientTempId);
      if (attempt === 0 && joinedOlderFlight) continue;
      throw new Error(
        navigator.onLine
          ? "ซิงก์บิลขายไม่สำเร็จ กรุณาลองซิงก์อีกครั้ง"
          : "การเชื่อมต่อขาดหายระหว่างซิงก์บิลขาย"
      );
    }

    if (!syncResult?.receipts.has(submittedTransaction.clientTempId)) {
      throw new Error("ไม่พบผลการซิงก์หรือเลขบิลส่วนกลางของบิลขาย");
    }
    return { status: "synced" };
  }

  const saveTransaction = useMutation({
    networkMode: "always",
    mutationFn: async (transaction: IncomeExpense) => {
      const operation = Boolean(transaction.serverBillNo) || transaction.id !== transaction.clientTempId ? "update" : "create";
      if (transaction.billOption === "บิลขาย" && !navigator.onLine) throw new Error("บิลขายตัดสต็อก ต้องออนไลน์ก่อนบันทึก");
      if (operation === "update" && !navigator.onLine) throw new Error(OFFLINE_SYNCED_ACTION_MESSAGE);

      if (operation === "update" && transaction.billOption !== "บิลขาย") {
        await acceptIncomeExpenseBackground(transaction, "update", ownerUserId);
        return transaction;
      }

      const payload = buildIncomeExpensePayload(transaction, operation);
      const events = await getPendingEvents(queuePartition(ownerUserId, locationId));
      const sameRecord = events.filter((event) => event.id === transaction.clientTempId);
      if (operation === "create" && transaction.billOption !== "บิลขาย") {
        const accepted = await readIncomeSubmission(ownerUserId, locationId, transaction.clientTempId);
        if (accepted?.cancelled) throw new Error("รายการนี้ยกเลิกแล้ว กรุณาเพิ่มแถวใหม่");
        if (accepted && (!transaction.billNumbering || !sameRecord.length)) return enqueueNumberedIncomeCreate(transaction, ownerUserId);
      }
      if (operation === "create" && transaction.billOption !== "บิลขาย" && sameRecord.length) {
        throw new Error("บิลนี้กำลังรอซิงก์ จึงยังแก้ไขไม่ได้");
      }
      if (sameRecord.some((event) => event.status !== "pending")) throw new Error("ไม่สามารถบันทึกได้ กรุณาแก้ไขข้อมูลที่ขัดแย้ง หรือลองซิงก์ใหม่อีกครั้ง");
      if (sameRecord.some((event) => event.operation === "delete")) throw new Error("ไม่สามารถบันทึกได้ รายการนี้กำลังถูกลบ");
      if (sameRecord.some((event) => event.serverSubmissionAttempted === true)) throw new Error(PENDING_SERVER_ACTION_MESSAGE);

      if (operation === "create" && transaction.billOption !== "บิลขาย" && !transaction.billNumbering
        && !sameRecord.length) {
        return enqueueNumberedIncomeCreate(transaction, ownerUserId);
      }

      const keeper = sameRecord.find((event) => event.operation === "create") ?? sameRecord.find((event) => event.operation === "update");
      if (keeper) {
        const revision = keeper.operation === "create" ? 0 : keeper.payload.expectedRevisionNo;
        const replacement = { ...keeper,
          payload: { ...payload, operation: keeper.operation, expectedRevisionNo: revision, idempotencyKey: `${keeper.operation}:${transaction.clientTempId}:${revision}` },
          timestamp: Date.now() };
        if (!await reconcileSyncEventsIfCurrent(sameRecord, replacement, true)) throw new Error("คิวเปลี่ยนแล้ว กรุณาตรวจรายการอีกครั้ง");
      } else {
        const queued = await enqueueSyncEvent({ id: transaction.clientTempId, entity: ENTITY, ownerUserId, locationId, operation, payload, timestamp: Date.now(), status: "pending" }, sameRecord);
        if (queued === null) throw new Error("คิวเปลี่ยนแล้ว กรุณาตรวจรายการอีกครั้ง");
      }
      return transaction;
    },
    onSuccess: (_savedTransaction, transaction) => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["stock", locationId] });
      if (transaction.billOption !== "บิลขาย") {
        void runIncomeExpenseBackground(queryClient, ownerUserId).catch(() => {});
        void syncPendingIncomeExpense(queryClient, ownerUserId, locationId);
      }
    },
  });

  const deleteTransaction = useMutation({
    networkMode: "always",
    mutationFn: async ({ clientTempId, deletedByName, deletedByPhone }: { clientTempId: string; deletedByName: string; deletedByPhone: string }) => {
      const events = await getPendingEvents(queuePartition(ownerUserId, locationId));
      const sameRecord = events.filter((event) => event.id === clientTempId);
      if (sameRecord.some((event) => event.status !== "pending")) throw new Error("ไม่สามารถลบได้ กรุณาแก้ไขข้อมูลที่ขัดแย้ง หรือลองซิงก์ใหม่อีกครั้ง");
      if (sameRecord.some((event) => event.operation === "delete")) return;
      if (sameRecord.some((event) => event.serverSubmissionAttempted === true)) throw new Error(PENDING_SERVER_ACTION_MESSAGE);

      const pendingCreates = sameRecord.filter((event) => event.operation === "create");
      if (pendingCreates.length) {
        if (pendingCreates.some(event => event.payload.billOption === "บิลขาย")) {
          if (!await reconcileSyncEventsIfCurrent(sameRecord, undefined, true)) throw new Error("คิวเปลี่ยนแล้ว กรุณาตรวจรายการอีกครั้ง");
        } else await cancelUnsubmittedIncomeCreate(sameRecord);
        return;
      }
      if (!navigator.onLine) throw new Error(OFFLINE_SYNCED_ACTION_MESSAGE);

      const pendingUpdates = sameRecord.filter((event) => event.operation === "update");
      const transaction = transactions.find((item) => item.clientTempId === clientTempId)
        ?? (pendingUpdates[0] ? payloadToOptimisticRow(pendingUpdates[0]) : undefined);
      if (!transaction) throw new Error("ไม่พบรายการในแคช");
      if (transaction.billOption !== "บิลขาย") {
        await acceptIncomeExpenseBackground(transaction, "delete", ownerUserId, { name: deletedByName, phone: deletedByPhone });
        return;
      }
      const revision = pendingUpdates[0]?.payload.expectedRevisionNo ?? transaction.revisionNo;
      const payload = buildIncomeExpensePayload(transaction, "delete", { name: deletedByName, phone: deletedByPhone });
      payload.expectedRevisionNo = revision;
      payload.idempotencyKey = `delete:${clientTempId}:${revision}`;
      const deletion: SyncEvent = { id: clientTempId, entity: ENTITY, ownerUserId, locationId, operation: "delete", payload, timestamp: Date.now(), status: "pending" };
      if (pendingUpdates.length) {
        if (!await reconcileSyncEventsIfCurrent(sameRecord, { ...deletion, queueId: pendingUpdates[0].queueId }, true)) throw new Error("คิวเปลี่ยนแล้ว กรุณาตรวจรายการอีกครั้ง");
      } else if (await enqueueSyncEvent(deletion, sameRecord) === null) throw new Error("คิวเปลี่ยนแล้ว กรุณาตรวจรายการอีกครั้ง");
    },
    onSuccess: () => {
      refresh();
      void runIncomeExpenseBackground(queryClient, ownerUserId).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["stock", locationId] });
      void syncPendingIncomeExpense(queryClient, ownerUserId, locationId);
    },
  });

  async function discardFailedTransaction(clientTempId: string) {
    if (!navigator.onLine) throw new Error("ทิ้งรายการค้างได้เมื่อออนไลน์เท่านั้น");
    const events = await getPendingEvents(queuePartition(ownerUserId, locationId));
    const recordEvents = events.filter((event) => event.id === clientTempId);
    if (recordEvents.some((event) => event.serverSubmissionAttempted === true)) {
      throw new Error("รายการนี้อาจบันทึกถึงเซิร์ฟเวอร์แล้ว ต้องลองซิงก์เพื่อตรวจสอบผลก่อน");
    }
    const discardable = recordEvents.filter((event) => event.status === "failed" || event.status === "conflict");
    if (discardable.length === 0) {
      throw new Error("รายการนี้ไม่มีปัญหาการซิงก์ที่ทิ้งได้");
    }
    if (!await reconcileSyncEventsIfCurrent(recordEvents, undefined, true)) throw new Error("คิวเปลี่ยนแล้ว กรุณาตรวจรายการอีกครั้ง");
    if (!recordEvents.some(isIncomeExpenseBackgroundCommand)) removeFromFeedCache(queryClient, ownerUserId, locationId, clientTempId);
    await operationalList.refresh();
  }

  return {
    transactions,
    pendingApprovalCount: operationalList.pendingApprovalCount,
    offlineHistory: operationalList.offlineHistory,
    isLoading: operationalList.isLoading,
    isError: operationalList.isError,
    hasMore: operationalList.hasMore,
    isLoadingMore: operationalList.isLoadingMore,
    loadMore: operationalList.fetchNextPage,
    refresh: operationalList.refresh,
    addTransaction: saveTransaction.mutateAsync,
    updateTransaction: saveTransaction.mutateAsync,
    syncTransaction,
    deleteTransaction: deleteTransaction.mutateAsync,
    discardFailedTransaction,
  };
}
