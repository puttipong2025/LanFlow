import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { IncomeExpense } from "@/types";
import { enqueueSyncEvent, getPendingEvents, removeSyncEvent, updateSyncEvent, type SyncEvent } from "@/lib/idb-queue";
import { coalesceQueueGroup } from "@/lib/coalesceQueueGroup";
import { buildIncomeExpensePayload } from "@/lib/income-expense/build-income-expense-payload";
import { OFFLINE_SYNCED_ACTION_MESSAGE } from "@/lib/record-action-locks";

const ENTITY = "income_expense" as const;
const FEED_QUERY_KEY = "incomeExpenseFeed" as const;
const PENDING_QUERY_KEY = "incomeExpensePending" as const;
const PAGE_SIZE = 100;

type FeedPage = { rows: IncomeExpense[]; nextCursor: string | null };

function queuePartition(ownerUserId: string, locationId: string) {
  return { entity: ENTITY, ownerUserId, locationId };
}

function defaultDateWindow() {
  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setUTCDate(fromDate.getUTCDate() - 89);
  return { from: fromDate.toISOString().slice(0, 10), to };
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
    incomeSaleItemId: payload.incomeSaleItemId ?? undefined,
    stockProductId: payload.stockProductId ?? undefined,
    stockQuantity: payload.stockQuantity ?? undefined,
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

let isSyncing = false;

async function syncPendingIncomeExpense(queryClient: ReturnType<typeof useQueryClient>, ownerUserId: string, locationId: string) {
  if (isSyncing || !ownerUserId || !locationId || !navigator.onLine) return;
  isSyncing = true;
  try {
    await normalizeQueue(ownerUserId, locationId);
    const events = await getPendingEvents(queuePartition(ownerUserId, locationId));
    const blockedIds = new Set(events.filter((event) => event.status !== "pending").map((event) => event.id));

    for (const event of events) {
      if (!navigator.onLine || blockedIds.has(event.id)) continue;
      try {
        const response = await fetch("/api/lanflow/income-expense", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event.payload),
        });
        const data = await response.json();
        if (response.ok) await removeSyncEvent(event.queueId!);
        else {
          event.status = data.status === "conflict" ? "conflict" : "failed";
          event.errorMessage = data.errorMessage || (event.status === "conflict" ? "ข้อมูลชนกัน" : "ซิงก์ไม่สำเร็จ");
          await updateSyncEvent(event);
          blockedIds.add(event.id);
          if (response.status >= 500) break;
        }
      } catch {
        break;
      }
    }
  } finally {
    isSyncing = false;
    queryClient.invalidateQueries({ queryKey: [FEED_QUERY_KEY, ownerUserId, locationId] });
    queryClient.invalidateQueries({ queryKey: [PENDING_QUERY_KEY, ownerUserId, locationId] });
  }
}

export function useIncomeExpense(locationId: string, ownerUserId: string) {
  const queryClient = useQueryClient();
  const dateWindow = useMemo(defaultDateWindow, []);
  const feedQuery = useInfiniteQuery({
    queryKey: [FEED_QUERY_KEY, ownerUserId, locationId, dateWindow.from, dateWindow.to],
    initialPageParam: null as string | null,
    enabled: !!locationId && !!ownerUserId,
    queryFn: async ({ pageParam }): Promise<FeedPage> => {
      if (!navigator.onLine) return { rows: [], nextCursor: null };
      const params = new URLSearchParams({ locationId, from: dateWindow.from, to: dateWindow.to, pageSize: String(PAGE_SIZE) });
      if (pageParam) params.set("cursor", pageParam);
      const response = await fetch(`/api/lanflow/income-expense/feed?${params}`);
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

  useEffect(() => {
    const handleOnline = () => void syncPendingIncomeExpense(queryClient, ownerUserId, locationId);
    window.addEventListener("online", handleOnline);
    if (navigator.onLine) handleOnline();
    return () => window.removeEventListener("online", handleOnline);
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
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["acidStock", locationId] });
      void syncPendingIncomeExpense(queryClient, ownerUserId, locationId);
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
      queryClient.invalidateQueries({ queryKey: ["acidStock", locationId] });
      void syncPendingIncomeExpense(queryClient, ownerUserId, locationId);
    },
  });

  return {
    transactions,
    isLoading: feedQuery.isLoading || pendingQuery.isLoading,
    isError: feedQuery.isError || pendingQuery.isError,
    hasMore: feedQuery.hasNextPage,
    isLoadingMore: feedQuery.isFetchingNextPage,
    loadMore: () => feedQuery.fetchNextPage(),
    addTransaction: saveTransaction.mutateAsync,
    updateTransaction: saveTransaction.mutateAsync,
    deleteTransaction: deleteTransaction.mutateAsync,
  };
}
