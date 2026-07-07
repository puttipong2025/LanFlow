import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { IncomeExpense } from "@/types";
import { enqueueSyncEvent, getPendingEvents, removeSyncEvent, updateSyncEvent, type SyncEvent } from "@/lib/idb-queue";
import { coalesceQueueGroup } from "@/lib/coalesceQueueGroup";
import { buildIncomeExpensePayload } from "@/lib/income-expense/build-income-expense-payload";
import { useEffect } from "react";
import { INCOME_EXPENSE_BRANCH_TRANSFER_LOCK_MESSAGE, OFFLINE_SYNCED_ACTION_MESSAGE } from "@/lib/record-action-locks";

const ENTITY = "income_expense" as const;
const QUERY_KEY = "incomeExpense" as const;

type IncomingBranchTransferRow = {
  id: string;
  location_id: string;
  target_location_id: string | null;
  target_location_name: string | null;
  net_amount_to_pay: number | string | null;
  transfer_status: string | null;
  transfer_type: string | null;
  record_status: string | null;
  revision_no: number | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_by_phone: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type LocationLookupRow = {
  id: string;
  name: string;
  code: string | null;
};

// ─── Sync ────────────────────────────────────────────────────

let isSyncing = false;

async function syncPendingIncomeExpense(queryClient: any, locationId: string) {
  if (isSyncing) return;
  if (!navigator.onLine) return;

  isSyncing = true;
  try {
    await normalizeQueue();
    const events = await getPendingEvents(ENTITY);

    const blockedIds = new Set<string>(
      events
        .filter(e => e.status === "conflict" || e.status === "failed")
        .map(e => e.id)
    );

    for (const event of events) {
      if (!navigator.onLine) break;
      if (blockedIds.has(event.id)) continue;

      try {
        const response = await fetch("/api/lanflow/income-expense", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event.payload),
        });

        const data = await response.json();

        if (response.ok) {
          await removeSyncEvent(event.queueId!);
        } else {
          const isConflict = data.status === "conflict";
          const eventStatus = isConflict ? "conflict" : "failed";
          event.status = eventStatus;
          event.errorMessage = data.errorMessage || (isConflict ? "ข้อมูลชนกัน" : "ซิงก์ไม่สำเร็จ");
          await updateSyncEvent(event);
          blockedIds.add(event.id);
          if (response.status >= 500) break;
        }
      } catch {
        break; // Network error → retry later
      }
    }
  } finally {
    isSyncing = false;
    queryClient.invalidateQueries({ queryKey: [QUERY_KEY, locationId] });
  }
}

async function normalizeQueue() {
  const events = await getPendingEvents(ENTITY);
  const grouped = new Map<string, SyncEvent[]>();
  for (const e of events) {
    if (!grouped.has(e.id)) grouped.set(e.id, []);
    grouped.get(e.id)!.push(e);
  }

  for (const [, group] of grouped.entries()) {
    if (group.length <= 1) continue;
    if (group.some(e => e.status === "conflict" || e.status === "failed")) continue;

    const result = coalesceQueueGroup(group);
    if (result.action === "noop") {
      for (const e of group) await removeSyncEvent(e.queueId!);
    } else {
      await updateSyncEvent(result.keeper);
      for (const e of result.remove) await removeSyncEvent(e.queueId!);
    }
  }
}

// ─── Optimistic row builder ──────────────────────────────────

function payloadToOptimisticRow(event: SyncEvent): IncomeExpense {
  const p = event.payload;
  return {
    id: p.clientTempId,
    clientTempId: p.clientTempId,
    localBillNo: p.localBillNo,
    serverBillNo: undefined,
    syncStatus: event.status === "conflict" ? "conflict" : event.status === "failed" ? "failed" : "pending",
    idempotencyKey: p.idempotencyKey,
    locationId: p.locationId,
    type: p.type,
    number: p.localBillNo,
    txDate: p.txDate,
    title: p.title,
    cost: p.cost,
    billOption: p.billOption,
    unit: p.unit ?? undefined,
    price: p.price ?? undefined,
    createdByUserId: p.createdByUserId ?? "",
    createdByName: p.createdByName ?? "",
    createdByPhone: p.createdByPhone ?? "",
    clientCreatedAt: p.clientCreatedAt,
    clientRecordedAt: p.clientRecordedAt,
    revisionNo: p.expectedRevisionNo,
    recordStatus: "active",
    syncErrorMessage: event.errorMessage,
  };
}

function branchTransferToIncomeRow(
  transfer: IncomingBranchTransferRow,
  sourceLocation?: LocationLookupRow
): IncomeExpense {
  const displayNo = `TR-${transfer.id.slice(0, 8)}`;
  const recordedAt = transfer.created_at ?? transfer.updated_at ?? "1970-01-01T00:00:00.000Z";
  const sourceName = sourceLocation?.name ?? "สาขาต้นทาง";

  return {
    id: `money-transfer-income:${transfer.id}`,
    clientTempId: `money-transfer-income:${transfer.id}`,
    localBillNo: displayNo,
    serverBillNo: displayNo,
    syncStatus: "synced",
    idempotencyKey: `money-transfer:${transfer.id}`,
    locationId: transfer.target_location_id ?? "",
    type: "income",
    number: displayNo,
    txDate: recordedAt.slice(0, 10),
    title: `รับโอนจาก ${sourceName}`,
    cost: Number(transfer.net_amount_to_pay ?? 0),
    billOption: "รายรับ",
    createdByUserId: transfer.created_by_user_id ?? "",
    createdByName: transfer.created_by_name ?? "ระบบโอนเงิน",
    createdByPhone: transfer.created_by_phone ?? "",
    clientCreatedAt: recordedAt,
    clientRecordedAt: recordedAt,
    serverReceivedAt: transfer.updated_at ?? transfer.created_at ?? undefined,
    revisionNo: transfer.revision_no ?? 0,
    recordStatus: "active",
    relationSourceType: "money_transfer",
    relationSourceId: transfer.id,
    relationLabel: "โอนเงินสาขา",
    relationLockReason: INCOME_EXPENSE_BRANCH_TRANSFER_LOCK_MESSAGE,
  };
}

// ─── Hook ────────────────────────────────────────────────────

export function useIncomeExpense(locationId: string) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();

  // Auto-sync on mount (if online) and when coming back online
  useEffect(() => {
    const handleOnline = () => syncPendingIncomeExpense(queryClient, locationId);
    window.addEventListener("online", handleOnline);
    if (navigator.onLine) syncPendingIncomeExpense(queryClient, locationId);
    return () => window.removeEventListener("online", handleOnline);
  }, [queryClient, locationId]);

  // ── Query: server rows + pending queue merge ──

  const query = useQuery({
    queryKey: [QUERY_KEY, locationId],
    networkMode: "always",
    queryFn: async () => {
      // 1. Fetch server state (gracefully degrade when offline)
      let serverRows: IncomeExpense[] = [];
      let incomingBranchIncomeRows: IncomeExpense[] = [];

      try {
        const { data, error } = await supabase
          .from("income_expense")
          .select("*")
          .eq("location_id", locationId)
          .eq("record_status", "active")
          .order("tx_date", { ascending: false })
          .order("created_at", { ascending: false });

        if (error) throw new Error(error.message || JSON.stringify(error));

        serverRows = (data || []).map((row: any): IncomeExpense => ({
          id: row.id,
          clientTempId: row.client_temp_id ?? row.id,
          localBillNo: row.local_bill_no,
          serverBillNo: row.server_bill_no ?? undefined,
          idempotencyKey: row.idempotency_key ?? `server:${row.id}`,
          locationId: row.location_id,
          syncStatus: "synced",
          recordStatus: row.record_status,
          type: row.type,
          number: row.number ?? row.server_bill_no ?? row.local_bill_no,
          txDate: row.tx_date,
          title: row.title,
          cost: Number(row.cost),
          unit: row.unit ?? undefined,
          price: row.price != null ? Number(row.price) : undefined,
          billOption: row.bill_option,
          clientRecordedAt: row.client_recorded_at ?? row.created_at,
          clientCreatedAt: row.client_created_at ?? row.created_at,
          serverReceivedAt: row.server_received_at ?? undefined,
          revisionNo: row.revision_no ?? 0,
          deletedAt: row.deleted_at ?? undefined,
          deletedByName: row.deleted_by_name ?? undefined,
          deletedByPhone: row.deleted_by_phone ?? undefined,
          createdByUserId: row.created_by_user_id,
          createdByName: row.created_by_name,
          createdByPhone: row.created_by_phone,
        }));
      } catch (err) {
        if (!navigator.onLine) {
          serverRows = [];
        } else {
          throw err;
        }
      }

      try {
        const { data: branchTransfers, error } = await supabase
          .from("money_transfers")
          .select(`
            id,
            location_id,
            target_location_id,
            target_location_name,
            net_amount_to_pay,
            transfer_status,
            transfer_type,
            record_status,
            revision_no,
            created_by_user_id,
            created_by_name,
            created_by_phone,
            created_at,
            updated_at
          `)
          .eq("transfer_type", "branch")
          .eq("target_location_id", locationId)
          .neq("record_status", "deleted")
          .neq("transfer_status", "cancelled");

        if (error) throw new Error(error.message || JSON.stringify(error));

        const incomingTransfers = (branchTransfers || []) as IncomingBranchTransferRow[];
        const sourceLocationIds = Array.from(new Set(incomingTransfers.map(t => t.location_id).filter(Boolean)));
        const locationsById = new Map<string, LocationLookupRow>();

        if (sourceLocationIds.length > 0) {
          const { data: sourceLocations, error: locationsError } = await supabase
            .from("locations")
            .select("id, name, code")
            .in("id", sourceLocationIds);

          if (!locationsError) {
            (sourceLocations || []).forEach((location: LocationLookupRow) => {
              locationsById.set(location.id, location);
            });
          }
        }

        incomingBranchIncomeRows = incomingTransfers
          .filter(transfer => Number(transfer.net_amount_to_pay ?? 0) > 0)
          .map(transfer => branchTransferToIncomeRow(transfer, locationsById.get(transfer.location_id)));
      } catch (err) {
        if (navigator.onLine) {
          console.warn("Unable to load incoming branch transfer income rows:", err);
        }
      }

      // 2. Fetch pending queue
      const pendingEvents = await getPendingEvents(ENTITY);

      // 3. Merge
      const rowsMap = new Map<string, IncomeExpense>();
      serverRows.forEach(r => rowsMap.set(r.clientTempId, r));
      incomingBranchIncomeRows.forEach(r => rowsMap.set(r.clientTempId, r));

      for (const event of pendingEvents) {
        if (event.operation === "delete") {
          if (event.status === "pending") {
            rowsMap.delete(event.id);
          } else {
            // conflict/failed → show row back with error
            const existing = rowsMap.get(event.id);
            if (existing) {
              rowsMap.set(event.id, {
                ...existing,
                syncStatus: event.status === "conflict" ? "conflict" : "failed",
                syncErrorMessage: event.errorMessage,
              });
            }
          }
        } else {
          const optimistic = payloadToOptimisticRow(event);
          const existing = rowsMap.get(event.id);
          rowsMap.set(event.id, existing ? {
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
      }

      return Array.from(rowsMap.values()).sort(
        (a, b) => new Date(b.clientRecordedAt).getTime() - new Date(a.clientRecordedAt).getTime()
      );
    },
    enabled: !!locationId,
  });

  // ── Save (add / update) ──

  const saveTxMutation = useMutation({
    networkMode: "always",
    mutationFn: async (transaction: IncomeExpense) => {
      const isUpdate = Boolean(transaction.serverBillNo) || transaction.id !== transaction.clientTempId;
      const operation = isUpdate ? "update" : "create";
      if (operation === "update" && typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error(OFFLINE_SYNCED_ACTION_MESSAGE);
      }
      const payload = buildIncomeExpensePayload(transaction, operation);

      const existingEvents = await getPendingEvents(ENTITY);
      const clientEvents = existingEvents.filter(e => e.id === transaction.clientTempId);

      if (clientEvents.some(e => e.status === "conflict" || e.status === "failed")) {
        throw new Error("ไม่สามารถบันทึกได้ กรุณาแก้ไขข้อมูลที่ขัดแย้ง หรือลองซิงก์ใหม่อีกครั้ง");
      }
      if (clientEvents.some(e => e.operation === "delete")) {
        throw new Error("ไม่สามารถบันทึกได้ รายการนี้กำลังถูกลบ");
      }

      const pendingCreates = clientEvents.filter(e => e.operation === "create");
      const pendingUpdates = clientEvents.filter(e => e.operation === "update");

      let keeper: SyncEvent | undefined;
      let toDelete: SyncEvent[] = [];

      if (pendingCreates.length > 0) {
        keeper = pendingCreates[0];
        toDelete = [...pendingCreates.slice(1), ...pendingUpdates];
      } else if (pendingUpdates.length > 0) {
        keeper = pendingUpdates[0];
        toDelete = pendingUpdates.slice(1);
      }

      for (const e of toDelete) {
        if (e.queueId) await removeSyncEvent(e.queueId);
      }

      if (keeper) {
        if (keeper.operation === "create") {
          keeper.payload = { ...payload, operation: "create", expectedRevisionNo: 0, idempotencyKey: `create:${transaction.clientTempId}:0` };
        } else {
          const originalRev = keeper.payload.expectedRevisionNo;
          keeper.payload = { ...payload, operation: "update", expectedRevisionNo: originalRev, idempotencyKey: `update:${transaction.clientTempId}:${originalRev}` };
        }
        keeper.timestamp = Date.now();
        await updateSyncEvent(keeper);
      } else {
        await enqueueSyncEvent({
          id: transaction.clientTempId,
          entity: ENTITY,
          operation,
          payload,
          timestamp: Date.now(),
          status: "pending",
        });
      }

      return transaction;
    },
    onSuccess: (savedTx) => {
      queryClient.setQueryData<IncomeExpense[]>([QUERY_KEY, locationId], (old) => {
        if (!old) return [{ ...savedTx, syncStatus: "pending" as const }];
        const idx = old.findIndex(t => t.clientTempId === savedTx.clientTempId);
        if (idx >= 0) {
          const updated = [...old];
          updated[idx] = { ...updated[idx], ...savedTx, syncStatus: "pending" };
          return updated;
        }
        return [{ ...savedTx, syncStatus: "pending" as const }, ...old];
      });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, locationId] });
      syncPendingIncomeExpense(queryClient, locationId);
    },
  });

  // ── Delete ──

  const deleteTxMutation = useMutation({
    networkMode: "always",
    mutationFn: async ({
      clientTempId,
      deletedByName,
      deletedByPhone,
    }: {
      clientTempId: string;
      deletedByName: string;
      deletedByPhone: string;
    }) => {
      const existingEvents = await getPendingEvents(ENTITY);
      const clientEvents = existingEvents.filter(e => e.id === clientTempId);

      if (clientEvents.some(e => e.status === "conflict" || e.status === "failed")) {
        throw new Error("ไม่สามารถลบได้ กรุณาแก้ไขข้อมูลที่ขัดแย้ง หรือลองซิงก์ใหม่อีกครั้ง");
      }
      if (clientEvents.some(e => e.operation === "delete")) {
        return { clientTempId, coalesced: false };
      }

      const pendingCreates = clientEvents.filter(e => e.operation === "create");
      const pendingUpdates = clientEvents.filter(e => e.operation === "update");

      if (pendingCreates.length === 0 && typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error(OFFLINE_SYNCED_ACTION_MESSAGE);
      }

      // Create + delete = noop
      if (pendingCreates.length > 0) {
        for (const e of clientEvents) {
          if (e.queueId) await removeSyncEvent(e.queueId);
        }
        return { clientTempId, coalesced: true };
      }

      // Build delete payload from cached row
      const rows = queryClient.getQueryData<IncomeExpense[]>([QUERY_KEY, locationId]);
      const latestPendingUpdate = [...pendingUpdates].sort((a, b) => (b.queueId || 0) - (a.queueId || 0))[0];
      const tx = rows?.find(t => t.clientTempId === clientTempId)
        ?? (latestPendingUpdate ? payloadToOptimisticRow(latestPendingUpdate) : undefined);
      if (!tx) throw new Error("ไม่พบรายการในแคช");

      const targetRev = pendingUpdates.length > 0
        ? pendingUpdates[0].payload.expectedRevisionNo
        : tx.revisionNo;

      const payload = buildIncomeExpensePayload(tx, "delete", { name: deletedByName, phone: deletedByPhone });
      payload.expectedRevisionNo = targetRev;
      payload.idempotencyKey = `delete:${clientTempId}:${targetRev}`;

      await enqueueSyncEvent({
        id: clientTempId,
        entity: ENTITY,
        operation: "delete",
        payload,
        timestamp: Date.now(),
        status: "pending",
      });

      // Clean up pending updates only after the delete event is safely queued.
      for (const e of pendingUpdates) {
        if (e.queueId) await removeSyncEvent(e.queueId);
      }

      return { clientTempId, coalesced: false };
    },
    onSuccess: (data) => {
      queryClient.setQueryData<IncomeExpense[]>([QUERY_KEY, locationId], (old) => {
        if (!old) return old;
        return old.filter(t => t.clientTempId !== data.clientTempId);
      });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, locationId] });
      syncPendingIncomeExpense(queryClient, locationId);
    },
  });

  return {
    transactions: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    addTransaction: saveTxMutation.mutateAsync,
    updateTransaction: saveTxMutation.mutateAsync,
    deleteTransaction: deleteTxMutation.mutateAsync,
  };
}
