import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { isDeviceOnline, subscribeConnectivity } from "@/lib/connectivity";
import { useEffect, useMemo } from "react";
import type { IncomeExpense } from "@/types";
import { enqueueSyncEvent, getPendingEvents, removeSyncEvent, updateSyncEvent, type SyncEvent } from "@/lib/idb-queue";
import { coalesceQueueGroup } from "@/lib/coalesceQueueGroup";
import { buildIncomeExpensePayload } from "@/lib/income-expense/build-income-expense-payload";
import { OFFLINE_SYNCED_ACTION_MESSAGE } from "@/lib/record-action-locks";
import { INCOME_EXPENSE_FEED_QUERY_KEY } from "@/lib/income-expense/query-keys";
import { bangkokDateWindow } from "@/lib/bangkok-date";
import { authFetch } from "@/lib/auth-fetch";
import { isRetryableSyncResponse } from "@/lib/sync-response";

const ENTITY = "income_expense" as const;
const FEED_QUERY_KEY = INCOME_EXPENSE_FEED_QUERY_KEY;
const PENDING_QUERY_KEY = "incomeExpensePending" as const;
const PAGE_SIZE = 100;

type FeedPage = { rows: IncomeExpense[]; nextCursor: string | null };
type IncomeExpenseSyncReceipt = {
  id: string;
  serverBillNo: string;
  revisionNo: number;
  serverReceivedAt?: string;
  title?: string;
  cost?: number;
  saleLineCount?: number;
  saleLines?: IncomeExpense["saleLines"];
};
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
};

function queuePartition(ownerUserId: string, locationId: string) {
  return { entity: ENTITY, ownerUserId, locationId };
}

function defaultDateWindow() {
  return bangkokDateWindow(90);
}

function payloadToOptimisticRow(event: SyncEvent): IncomeExpense {
  const payload = event.payload;
  return {
    id: payload.clientTempId,
    clientTempId: payload.clientTempId,
    localBillNo: payload.localBillNo,
    syncStatus: event.status === "conflict" ? "conflict" : event.status === "failed" ? "failed" : "pending",
    idempotencyKey: payload.idempotencyKey,
    locationId: payload.locationId,
    type: payload.type,
    number: payload.localBillNo,
    txDate: payload.txDate,
    title: payload.title,
    cost: payload.cost,
    billOption: payload.billOption,
    unit: payload.unit ?? undefined,
    price: payload.price ?? undefined,
    saleLineCount: payload.saleLines?.length,
    saleLines: payload.saleLines?.map((line: NonNullable<ReturnType<typeof buildIncomeExpensePayload>["saleLines"]>[number]) => ({
      ...line,
      stockProductId: "",
      title: "",
      lineTotal: Math.round((line.quantity * line.unitPrice + Number.EPSILON) * 100) / 100,
    })),
    createdByUserId: payload.createdByUserId ?? "",
    createdByName: payload.createdByName ?? "",
    createdByPhone: payload.createdByPhone ?? "",
    clientCreatedAt: payload.clientCreatedAt,
    clientRecordedAt: payload.clientRecordedAt,
    revisionNo: payload.expectedRevisionNo,
    recordStatus: "active",
    syncErrorMessage: event.errorMessage,
  };
}

function mergeFeedWithPending(feedRows: IncomeExpense[], events: SyncEvent[]) {
  const rows = new Map(feedRows.map((row) => [row.clientTempId, row]));
  for (const event of events) {
    if (event.operation === "delete") {
      if (event.status === "pending") rows.delete(event.id);
      else {
        const existing = rows.get(event.id);
        if (existing) rows.set(event.id, {
          ...existing,
          syncStatus: event.status === "conflict" ? "conflict" : "failed",
          syncErrorMessage: event.errorMessage,
        });
      }
      continue;
    }

    const optimistic = payloadToOptimisticRow(event);
    const existing = rows.get(event.id);
    rows.set(event.id, existing ? {
      ...existing,
      ...optimistic,
      id: existing.id,
      serverBillNo: existing.serverBillNo,
      number: existing.serverBillNo ?? existing.number,
      createdByUserId: existing.createdByUserId,
      createdByName: existing.createdByName,
      createdByPhone: existing.createdByPhone,
      serverReceivedAt: existing.serverReceivedAt,
    } : optimistic);
  }

  return Array.from(rows.values()).sort(
    (left, right) => new Date(right.clientRecordedAt).getTime() - new Date(left.clientRecordedAt).getTime()
  );
}

function removeFromFeedCache(
  queryClient: ReturnType<typeof useQueryClient>,
  ownerUserId: string,
  locationId: string,
  clientTempId: string
) {
  queryClient.setQueriesData<InfiniteData<FeedPage>>(
    { queryKey: [FEED_QUERY_KEY, ownerUserId, locationId] },
    (cached) => cached ? {
      ...cached,
      pages: cached.pages.map((page) => ({
        ...page,
        rows: page.rows.filter((row) => row.clientTempId !== clientTempId),
      })),
    } : cached
  );
}

function upsertSyncedIntoFeedCache(
  queryClient: ReturnType<typeof useQueryClient>,
  ownerUserId: string,
  locationId: string,
  event: SyncEvent,
  receipt: IncomeExpenseSyncReceipt
) {
  const optimistic = payloadToOptimisticRow(event);
  queryClient.setQueriesData<InfiniteData<FeedPage>>(
    { queryKey: [FEED_QUERY_KEY, ownerUserId, locationId] },
    (cached) => {
      const existing = cached?.pages
        .flatMap((page) => page.rows)
        .find((row) => row.clientTempId === event.id);
      const synced: IncomeExpense = {
        ...existing,
        ...optimistic,
        id: receipt.id,
        serverBillNo: receipt.serverBillNo,
        number: receipt.serverBillNo,
        syncStatus: "synced",
        revisionNo: receipt.revisionNo,
        serverReceivedAt: receipt.serverReceivedAt,
        title: receipt.title ?? optimistic.title,
        cost: receipt.cost ?? optimistic.cost,
        saleLineCount: receipt.saleLineCount ?? optimistic.saleLineCount,
        saleLines: receipt.saleLines ?? optimistic.saleLines,
        syncErrorMessage: undefined,
      };

      if (!cached || cached.pages.length === 0) {
        return {
          pages: [{ rows: [synced], nextCursor: null }],
          pageParams: [null],
        };
      }

      return {
        ...cached,
        pages: cached.pages.map((page, index) => {
          const rows = page.rows.filter((row) => row.clientTempId !== event.id);
          return {
            ...page,
            rows: index === 0 ? [synced, ...rows] : rows,
          };
        }),
      };
    }
  );
}

async function normalizeQueue(ownerUserId: string, locationId: string) {
  const grouped = new Map<string, SyncEvent[]>();
  for (const event of await getPendingEvents(queuePartition(ownerUserId, locationId))) {
    const events = grouped.get(event.id) ?? [];
    events.push(event);
    grouped.set(event.id, events);
  }

  for (const events of grouped.values()) {
    if (events.length < 2 || events.some((event) => event.status !== "pending")) continue;
    const result = coalesceQueueGroup(events);
    if (result.action === "noop") {
      for (const event of events) await removeSyncEvent(event.queueId!);
    } else {
      await updateSyncEvent(result.keeper);
      for (const event of result.remove) await removeSyncEvent(event.queueId!);
    }
  }
}

let activeSyncPromise: Promise<IncomeExpenseSyncResult> | null = null;

async function runPendingIncomeExpenseSync(
  queryClient: ReturnType<typeof useQueryClient>,
  ownerUserId: string,
  locationId: string
) {
  const receipts = new Map<string, IncomeExpenseSyncReceipt>();
  const rejections = new Map<string, IncomeExpenseSyncRejection>();
  await normalizeQueue(ownerUserId, locationId);
  const events = await getPendingEvents(queuePartition(ownerUserId, locationId));
  const blockedIds = new Set(events.filter((event) => event.status !== "pending").map((event) => event.id));

  for (const event of events) {
    if (!navigator.onLine || blockedIds.has(event.id)) continue;
    try {
      const response = await authFetch("/api/lanflow/income-expense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event.payload),
      });
      const data = await response.json();
      if (response.ok) {
        if (event.operation === "delete") {
          await queryClient.cancelQueries({ queryKey: [FEED_QUERY_KEY, ownerUserId, locationId] });
          removeFromFeedCache(queryClient, ownerUserId, locationId, event.id);
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
          await queryClient.cancelQueries({ queryKey: [FEED_QUERY_KEY, ownerUserId, locationId] });
          upsertSyncedIntoFeedCache(queryClient, ownerUserId, locationId, event, receipt);
        }
        await removeSyncEvent(event.queueId!);
      }
      else if (isRetryableSyncResponse(response.status)) {
        break;
      }
      else {
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
          await removeSyncEvent(event.queueId!);
          continue;
        }
        event.status = data.status === "conflict" ? "conflict" : "failed";
        event.errorMessage = data.errorMessage || (event.status === "conflict" ? "ข้อมูลชนกัน" : "ซิงก์ไม่สำเร็จ");
        await updateSyncEvent(event);
        blockedIds.add(event.id);
      }
    } catch {
      break;
    }
  }

  return { receipts, rejections };
}

async function syncPendingIncomeExpense(
  queryClient: ReturnType<typeof useQueryClient>,
  ownerUserId: string,
  locationId: string
): Promise<IncomeExpenseSyncResult> {
  if (!ownerUserId || !locationId || !navigator.onLine) {
    return { receipts: new Map(), rejections: new Map() };
  }

  if (activeSyncPromise) {
    const activeResult = await activeSyncPromise;
    const remainingResult = await syncPendingIncomeExpense(queryClient, ownerUserId, locationId);
    return {
      receipts: new Map([...activeResult.receipts, ...remainingResult.receipts]),
      rejections: new Map([...activeResult.rejections, ...remainingResult.rejections]),
    };
  }

  const syncPromise = runPendingIncomeExpenseSync(queryClient, ownerUserId, locationId);
  activeSyncPromise = syncPromise;
  try {
    return await syncPromise;
  } finally {
    if (activeSyncPromise === syncPromise) activeSyncPromise = null;
    queryClient.invalidateQueries({ queryKey: [FEED_QUERY_KEY, ownerUserId, locationId] });
    queryClient.invalidateQueries({ queryKey: [PENDING_QUERY_KEY, ownerUserId, locationId] });
    queryClient.invalidateQueries({ queryKey: ["dashboardOverview", locationId] });
  }
}

export function useIncomeExpense(locationId: string, ownerUserId: string) {
  const queryClient = useQueryClient();
  const dateWindow = useMemo(defaultDateWindow, []);
  const feedQuery = useInfiniteQuery({
    queryKey: [FEED_QUERY_KEY, ownerUserId, locationId, dateWindow.from, dateWindow.to],
    initialPageParam: null as string | null,
    enabled: !!locationId && !!ownerUserId,
    queryFn: async ({ pageParam, signal }): Promise<FeedPage> => {
      if (!navigator.onLine) return { rows: [], nextCursor: null };
      const params = new URLSearchParams({ locationId, from: dateWindow.from, to: dateWindow.to, pageSize: String(PAGE_SIZE) });
      if (pageParam) params.set("cursor", pageParam);
      const response = await authFetch(`/api/lanflow/income-expense/feed?${params}`, { signal });
      if (!response.ok) throw new Error("โหลดรายการรับ-จ่ายไม่สำเร็จ");
      return response.json();
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const pendingQuery = useQuery({
    queryKey: [PENDING_QUERY_KEY, ownerUserId, locationId],
    enabled: !!locationId && !!ownerUserId,
    networkMode: "always",
    queryFn: () => getPendingEvents(queuePartition(ownerUserId, locationId)),
  });

  const transactions = useMemo(
    () => mergeFeedWithPending(feedQuery.data?.pages.flatMap((page) => page.rows) ?? [], pendingQuery.data ?? []),
    [feedQuery.data, pendingQuery.data]
  );
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [FEED_QUERY_KEY, ownerUserId, locationId] });
    queryClient.invalidateQueries({ queryKey: [PENDING_QUERY_KEY, ownerUserId, locationId] });
  };

  async function syncTransaction(submittedTransaction: IncomeExpense): Promise<IncomeExpense> {
    if (!navigator.onLine) throw new Error("บิลขายต้องออนไลน์จนกว่าจะซิงก์สำเร็จ");

    const syncResult = await syncPendingIncomeExpense(queryClient, ownerUserId, locationId);
    const rejection = syncResult.rejections.get(submittedTransaction.clientTempId);
    if (rejection?.errorCode === "STOCK_SHORTAGE") {
      throw new IncomeExpenseStockShortageError(rejection.shortages);
    }
    const remainingEvents = (await getPendingEvents(queuePartition(ownerUserId, locationId)))
      .filter((event) => event.id === submittedTransaction.clientTempId);
    const failedEvent = remainingEvents.find(
      (event) => event.status === "failed" || event.status === "conflict"
    );
    if (failedEvent) {
      throw new Error(failedEvent.errorMessage || "ซิงก์บิลขายไม่สำเร็จ");
    }
    if (remainingEvents.length > 0) {
      throw new Error(
        navigator.onLine
          ? "ซิงก์บิลขายไม่สำเร็จ กรุณาลองซิงก์อีกครั้ง"
          : "การเชื่อมต่อขาดหายระหว่างซิงก์บิลขาย"
      );
    }

    const receipt = syncResult.receipts.get(submittedTransaction.clientTempId);
    if (!receipt) {
      throw new Error("ไม่พบผลการซิงก์หรือเลขบิลส่วนกลางของบิลขาย");
    }
    return {
      ...submittedTransaction,
      id: receipt.id,
      serverBillNo: receipt.serverBillNo,
      number: receipt.serverBillNo,
      syncStatus: "synced",
      revisionNo: receipt.revisionNo,
      serverReceivedAt: receipt.serverReceivedAt,
      title: receipt.title ?? submittedTransaction.title,
      cost: receipt.cost ?? submittedTransaction.cost,
      saleLineCount: receipt.saleLineCount ?? submittedTransaction.saleLineCount,
      saleLines: receipt.saleLines ?? submittedTransaction.saleLines,
    };
  }

  useEffect(() => {
    const handleConnectivity = () => {
      if (isDeviceOnline()) {
        void syncPendingIncomeExpense(queryClient, ownerUserId, locationId);
      }
    };
    const unsubscribe = subscribeConnectivity(handleConnectivity);
    if (isDeviceOnline()) handleConnectivity();
    return unsubscribe;
  }, [queryClient, ownerUserId, locationId]);

  const saveTransaction = useMutation({
    networkMode: "always",
    mutationFn: async (transaction: IncomeExpense) => {
      const operation = Boolean(transaction.serverBillNo) || transaction.id !== transaction.clientTempId ? "update" : "create";
      if (transaction.billOption === "บิลขาย" && !navigator.onLine) throw new Error("บิลขายตัดสต็อก ต้องออนไลน์ก่อนบันทึก");
      if (operation === "update" && !navigator.onLine) throw new Error(OFFLINE_SYNCED_ACTION_MESSAGE);

      const payload = buildIncomeExpensePayload(transaction, operation);
      const events = await getPendingEvents(queuePartition(ownerUserId, locationId));
      const sameRecord = events.filter((event) => event.id === transaction.clientTempId);
      if (sameRecord.some((event) => event.status !== "pending")) throw new Error("ไม่สามารถบันทึกได้ กรุณาแก้ไขข้อมูลที่ขัดแย้ง หรือลองซิงก์ใหม่อีกครั้ง");
      if (sameRecord.some((event) => event.operation === "delete")) throw new Error("ไม่สามารถบันทึกได้ รายการนี้กำลังถูกลบ");

      const keeper = sameRecord.find((event) => event.operation === "create") ?? sameRecord.find((event) => event.operation === "update");
      if (keeper) {
        const revision = keeper.operation === "create" ? 0 : keeper.payload.expectedRevisionNo;
        keeper.payload = { ...payload, operation: keeper.operation, expectedRevisionNo: revision, idempotencyKey: `${keeper.operation}:${transaction.clientTempId}:${revision}` };
        keeper.timestamp = Date.now();
        await updateSyncEvent(keeper);
        for (const event of sameRecord) if (event !== keeper) await removeSyncEvent(event.queueId!);
      } else {
        await enqueueSyncEvent({ id: transaction.clientTempId, entity: ENTITY, ownerUserId, locationId, operation, payload, timestamp: Date.now(), status: "pending" });
      }
      return transaction;
    },
    onSuccess: (_savedTransaction, transaction) => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["stock", locationId] });
      if (transaction.billOption !== "บิลขาย") {
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

      const pendingCreates = sameRecord.filter((event) => event.operation === "create");
      if (pendingCreates.length) {
        for (const event of sameRecord) await removeSyncEvent(event.queueId!);
        return;
      }
      if (!navigator.onLine) throw new Error(OFFLINE_SYNCED_ACTION_MESSAGE);

      const pendingUpdates = sameRecord.filter((event) => event.operation === "update");
      const transaction = transactions.find((item) => item.clientTempId === clientTempId)
        ?? (pendingUpdates[0] ? payloadToOptimisticRow(pendingUpdates[0]) : undefined);
      if (!transaction) throw new Error("ไม่พบรายการในแคช");
      const revision = pendingUpdates[0]?.payload.expectedRevisionNo ?? transaction.revisionNo;
      const payload = buildIncomeExpensePayload(transaction, "delete", { name: deletedByName, phone: deletedByPhone });
      payload.expectedRevisionNo = revision;
      payload.idempotencyKey = `delete:${clientTempId}:${revision}`;
      await enqueueSyncEvent({ id: clientTempId, entity: ENTITY, ownerUserId, locationId, operation: "delete", payload, timestamp: Date.now(), status: "pending" });
      for (const event of pendingUpdates) await removeSyncEvent(event.queueId!);
    },
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["stock", locationId] });
      void syncPendingIncomeExpense(queryClient, ownerUserId, locationId);
    },
  });

  async function discardFailedTransaction(clientTempId: string) {
    const events = await getPendingEvents(queuePartition(ownerUserId, locationId));
    const discardable = events.filter((event) => (
      event.id === clientTempId
      && event.operation === "create"
      && event.status === "failed"
    ));
    if (discardable.length === 0) {
      throw new Error("รายการนี้ไม่ใช่บิลค้างที่ลบได้");
    }
    for (const event of discardable) await removeSyncEvent(event.queueId!);
    removeFromFeedCache(queryClient, ownerUserId, locationId, clientTempId);
    refresh();
  }

  return {
    transactions,
    isLoading: feedQuery.isLoading || pendingQuery.isLoading,
    isError: feedQuery.isError || pendingQuery.isError,
    hasMore: feedQuery.hasNextPage,
    isLoadingMore: feedQuery.isFetchingNextPage,
    loadMore: () => feedQuery.fetchNextPage(),
    addTransaction: saveTransaction.mutateAsync,
    updateTransaction: saveTransaction.mutateAsync,
    syncTransaction,
    deleteTransaction: deleteTransaction.mutateAsync,
    discardFailedTransaction,
  };
}
