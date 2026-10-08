import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { RubberBill } from "@/types";
import {
  enqueueSyncEvent,
  deleteRubberBillReceiptSnapshotsByClientTempId,
  getPendingEvents,
  reconcileSyncEventsIfCurrent,
  removeSyncEventIfCurrent,
  removeSyncEvents,
  updateSyncEventIfCurrent,
  type SyncEvent,
} from "@/lib/idb-queue";
import { toast } from "sonner";
import {
  OFFLINE_SYNCED_ACTION_MESSAGE,
  PENDING_SERVER_ACTION_MESSAGE,
} from "@/lib/record-action-locks";
import { authFetch } from "@/lib/auth-fetch";
import { isRetryableSyncResponse } from "@/lib/sync-response";
import { assertOfflineRubberBillPriceAllowed } from "@/lib/rubber-bills/approval";
import type { EffectiveRubberApprovalSettings } from "@/types";
import { invalidateMoneyFlowLocation } from "@/lib/money-flow/invalidation";
import { createScopedSingleFlight } from "@/lib/scoped-single-flight";
import { buildRubberBillRpcPayload } from "@/lib/rubber-bills/submission";
import { removeConfirmedRubberBillLocally } from "@/lib/rubber-bills/feed-cache";

export function assertRubberBillDeleteAllowed(pendingCreateCount: number, isOnline: boolean) {
  if (pendingCreateCount === 0 && !isOnline) throw new Error(OFFLINE_SYNCED_ACTION_MESSAGE);
}

const runRubberBillSyncSingleFlight = createScopedSingleFlight();
const activeDirectSubmissionScopes = new Map<string, number>();
function beginDirectSubmission(scopeKey: string) {
  activeDirectSubmissionScopes.set(scopeKey, (activeDirectSubmissionScopes.get(scopeKey) ?? 0) + 1);
}

function endDirectSubmission(scopeKey: string) {
  const remaining = (activeDirectSubmissionScopes.get(scopeKey) ?? 1) - 1;
  if (remaining > 0) activeDirectSubmissionScopes.set(scopeKey, remaining);
  else activeDirectSubmissionScopes.delete(scopeKey);
}

function queuePartition(ownerUserId: string, locationId: string) { return { entity: "rubber_bills" as const, ownerUserId, locationId }; }

async function removeRubberBillQueueEventBestEffort(event: SyncEvent) {
  try { await removeSyncEventIfCurrent(event); } catch (error) {
    console.warn("Unable to remove confirmed Rubber Bill queue event", error);
  }
}

export function syncPendingRubberBills(
  queryClient: QueryClient,
  ownerUserId: string,
  locationId: string,
): Promise<void> {
  if (!ownerUserId || !locationId || !navigator.onLine) return Promise.resolve();
  const scopeKey = `${ownerUserId}:${locationId}`;
  if (activeDirectSubmissionScopes.has(scopeKey)) return Promise.resolve();
  return runRubberBillSyncSingleFlight(scopeKey, async () => {
    try {
    if (!await normalizeRubberBillQueueBeforeSync(ownerUserId, locationId)) return;
    const events = await getPendingEvents(queuePartition(ownerUserId, locationId));
    // Precompute: block ALL ids that have any failed/conflict event
    const blockedIds = new Set<string>(
      events
        .filter(e => e.status === "conflict" || e.status === "failed")
        .map(e => e.id)
    );

    for (const event of events) {
      if (!navigator.onLine) break;

      if (blockedIds.has(event.id)) continue;

      try {
        if (event.operation === "create" && event.serverSubmissionAttempted !== true) {
          const markedEvent = { ...event, serverSubmissionAttempted: true };
          if (!await reconcileSyncEventsIfCurrent([event], markedEvent)) break;
          event.serverSubmissionAttempted = true;
        }
        const response = await authFetch("/api/lanflow/rubber-bills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...event.payload,
            ...(event.serverId ? { expectedServerId: event.serverId } : {}),
            submissionMode: "replay",
          })
        });

        const data = await response.json();
        
        if (response.ok) {
          if (data.status === "pending_approval") {
            toast.success("ส่งคำขออนุมัติบิลยางแล้ว");
          }
          if (event.operation === "delete" && data.status === "synced") {
            await removeConfirmedRubberBillLocally(
              queryClient,
              { ownerUserId, locationId },
              event.id,
              event.queueId,
            );
          } else {
            await removeRubberBillQueueEventBestEffort(event);
          }
        } else if (isRetryableSyncResponse(response.status)) {
          break;
        } else {
          // Use RPC-level status to distinguish conflict from failed
          const isConflict = data.status === "conflict";
          const eventStatus = isConflict ? "conflict" : "failed";
          
          console.warn(`Sync ${eventStatus} for`, event.id, data.errorMessage);
          event.status = eventStatus;
          event.errorMessage = data.errorMessage || (isConflict ? "ข้อมูลชนกัน" : "ซิงก์ไม่สำเร็จ");
          await updateSyncEventIfCurrent(event);
          blockedIds.add(event.id);
        }
      } catch (err) {
        console.error("Network error during sync", err);
        break; // Stop on network error
      }
    }
    } finally {
      await invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId });
    }
  });
}

async function normalizeRubberBillQueueBeforeSync(ownerUserId: string, locationId: string) {
  const { coalesceQueueGroup } = await import("@/lib/coalesceQueueGroup");
  const events = await getPendingEvents(queuePartition(ownerUserId, locationId));
  const grouped = new Map<string, typeof events>();
  for (const e of events) {
    if (!grouped.has(e.id)) grouped.set(e.id, []);
    grouped.get(e.id)!.push(e);
  }

  for (const [_id, group] of grouped.entries()) {
    if (group.length <= 1) continue;
    // Don't coalesce if any event is locked (failed/conflict) — user must resolve first
    if (group.some(e => e.status === "conflict" || e.status === "failed")) continue;

    const result = coalesceQueueGroup(group);

    if (!await reconcileSyncEventsIfCurrent(
      group,
      result.action === "keep" ? result.keeper : undefined,
    )) return false;
  }
  return true;
}

export function useRubberBillMutations(
  locationId: string,
  ownerUserId: string,
  approvalSettings?: EffectiveRubberApprovalSettings | null
) {
  const queryClient = useQueryClient();
  const saveBillMutation = useMutation({
    networkMode: "always",
    mutationFn: async ({ bill, approvalSettings: submittedApprovalSettings }: {
      bill: RubberBill;
      approvalSettings?: EffectiveRubberApprovalSettings | null;
    }) => {
      const mutationLocationId = bill.locationId || locationId;
      const mutationApprovalSettings = submittedApprovalSettings === undefined ? approvalSettings : submittedApprovalSettings;
      const isUpdate = Boolean(bill.serverBillNo) || bill.id !== bill.clientTempId;
      const operation = isUpdate ? "update" : "create";
      if ((bill.acidItems?.length ?? 0) > 0 && typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error("รายการหักสินค้าตัดสต็อก ต้องออนไลน์ก่อนบันทึก");
      }
      if (operation === "update" && typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error(OFFLINE_SYNCED_ACTION_MESSAGE);
      }
      if (operation === "create" && typeof navigator !== "undefined") {
        if (!mutationApprovalSettings) {
          throw new Error(
            navigator.onLine
              ? "กำลังโหลดกติกาอนุมัติ กรุณารอสักครู่แล้วบันทึกอีกครั้ง"
              : "เครื่องนี้ยังไม่เคยโหลดกติกาอนุมัติ กรุณาออนไลน์ก่อนสร้างบิล"
          );
        }
        assertOfflineRubberBillPriceAllowed(
          (bill.weighItems ?? []).map((item) => item.price),
          bill.billDate,
          mutationApprovalSettings,
          navigator.onLine
        );
      }
      
      const { calculatedBill, payload } = buildRubberBillRpcPayload(
        bill,
        operation,
        operation === "create" ? mutationApprovalSettings?.effectivePriceCap : bill.configuredPriceSnapshot
      );
      const isOnline = typeof navigator === "undefined" || navigator.onLine;
      const existingEvents = await getPendingEvents(queuePartition(ownerUserId, mutationLocationId));
      const clientEvents = existingEvents.filter(e => e.id === bill.clientTempId);

      if (clientEvents.some(e => e.status === "conflict" || e.status === "failed")) {
        throw new Error("ไม่สามารถบันทึกได้ กรุณาแก้ไขข้อมูลที่ขัดแย้ง หรือลองซิงก์ใหม่อีกครั้ง");
      }
      if (clientEvents.some(e => e.operation === "delete")) {
        throw new Error("ไม่สามารถบันทึกได้ บิลนี้กำลังถูกลบ");
      }

      const pendingCreates = clientEvents.filter(e => e.operation === "create");
      const pendingUpdates = clientEvents.filter(e => e.operation === "update");
      if (pendingCreates.some((event) => event.serverSubmissionAttempted === true)) {
        throw new Error(PENDING_SERVER_ACTION_MESSAGE);
      }

      const keeper = pendingCreates[0] ?? pendingUpdates[0];
      let newlyQueuedEvent: SyncEvent | undefined;

      if (keeper) {
        const originalRev = keeper.payload.expectedRevisionNo;
        const updatedKeeper = {
          ...keeper,
          payload: keeper.operation === "create"
            ? { ...payload, operation: "create", expectedRevisionNo: 0 }
            : { ...payload, operation: "update", expectedRevisionNo: originalRev,
              idempotencyKey: `update:${bill.clientTempId}:${originalRev}` },
          timestamp: Date.now(),
        };
        if (!await reconcileSyncEventsIfCurrent(clientEvents, updatedKeeper)) {
          throw new Error("ข้อมูลบิลในเครื่องถูกเปลี่ยนจากอีกหน้าต่าง กรุณาลองใหม่อีกครั้ง");
        }
      } else {
        const directSubmissionScope = isOnline && clientEvents.length === 0
          ? `${ownerUserId}:${mutationLocationId}`
          : null;
        if (directSubmissionScope) beginDirectSubmission(directSubmissionScope);
        const event: Omit<SyncEvent, "queueId"> = {
          id: bill.clientTempId,
          entity: "rubber_bills",
          ownerUserId,
          locationId: mutationLocationId,
          operation,
          serverId: operation === "update" ? bill.id : undefined,
          serverBillNo: operation === "update" ? bill.serverBillNo : undefined,
          serverSubmissionAttempted: operation === "create" && directSubmissionScope !== null,
          payload,
          timestamp: Date.now(),
          status: "pending"
        };
        let queueId: number;
        try {
          const queuedId = await enqueueSyncEvent(event, clientEvents);
          if (queuedId === null) {
            throw new Error("ข้อมูลบิลในเครื่องถูกเปลี่ยนจากอีกหน้าต่าง กรุณาลองใหม่อีกครั้ง");
          }
          queueId = queuedId;
        } catch (error) {
          if (directSubmissionScope) endDirectSubmission(directSubmissionScope);
          throw error;
        }
        newlyQueuedEvent = { ...event, queueId };
      }

      if (isOnline && clientEvents.length === 0 && newlyQueuedEvent) {
        try {
          const response = await authFetch("/api/lanflow/rubber-bills", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...payload,
              ...(operation === "update" ? { expectedServerId: bill.id } : {}),
            }),
          });
          const data = await response.json();
          if (!response.ok) {
            if (isRetryableSyncResponse(response.status)) {
              throw new Error(data.errorMessage || "ระบบไม่พร้อมใช้งานชั่วคราว");
            }
            const isConflict = data.status === "conflict";
            newlyQueuedEvent.status = isConflict ? "conflict" : "failed";
            newlyQueuedEvent.errorMessage =
              data.errorMessage || (isConflict ? "ข้อมูลชนกัน" : "ซิงก์ไม่สำเร็จ");
            await updateSyncEventIfCurrent(newlyQueuedEvent);
            throw new Error(data.errorMessage || "บันทึกบิลไม่สำเร็จ");
          }
          await removeRubberBillQueueEventBestEffort(newlyQueuedEvent);
          return {
            ...calculatedBill,
            id: data.id ?? bill.id,
            serverBillNo: data.serverBillNo ?? bill.serverBillNo,
            billNo: data.serverBillNo ?? bill.billNo,
            syncStatus: data.status === "synced" ? "synced" as const : "pending" as const,
            serverSubmissionAttempted: undefined,
            revisionNo: data.revisionNo ?? bill.revisionNo,
            serverReceivedAt: data.serverReceivedAt ?? bill.serverReceivedAt,
            configuredPriceSnapshot:
              operation === "create"
                ? mutationApprovalSettings?.effectivePriceCap ?? null
                : bill.configuredPriceSnapshot,
            approvalPending: data.status === "pending_approval",
            approvalRequestId: data.requestId,
            approvalOperation: data.operation,
          };
        } catch (error) {
          if (newlyQueuedEvent.status !== "pending") throw error;
          console.error("Network error while saving rubber bill", error);
        } finally {
          endDirectSubmission(`${ownerUserId}:${mutationLocationId}`);
        }
      }
      
      return {
        ...calculatedBill,
        syncStatus: "pending" as const,
        serverSubmissionAttempted: newlyQueuedEvent?.serverSubmissionAttempted === true,
        configuredPriceSnapshot:
          operation === "create"
            ? mutationApprovalSettings?.effectivePriceCap ?? null
            : bill.configuredPriceSnapshot,
        approvalPending: false,
      };
    },
    onSuccess: (savedBill, variables) => {
      if (savedBill.approvalPending) {
        toast.success("ส่งคำขออนุมัติบิลยางแล้ว");
      }
      const mutationLocationId = variables?.bill.locationId || locationId;
      void invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId: mutationLocationId });
      void syncPendingRubberBills(queryClient, ownerUserId, mutationLocationId);
    }
  });

  const deleteBillMutation = useMutation({
    networkMode: "always",
    mutationFn: async ({ bill, deletedByName, deletedByPhone }: { bill: RubberBill, deletedByName: string, deletedByPhone: string }) => {
      const isOnline = typeof navigator === "undefined" || navigator.onLine;
      const mutationLocationId = bill.locationId || locationId;
      const directSubmissionScope = isOnline ? `${ownerUserId}:${mutationLocationId}` : null;
      if (directSubmissionScope) beginDirectSubmission(directSubmissionScope);
      try {
      const clientTempId = bill.clientTempId;
      const existingEvents = await getPendingEvents(queuePartition(ownerUserId, mutationLocationId));
      const clientEvents = existingEvents.filter(e => e.id === clientTempId);

      if (clientEvents.some(e => e.status === "conflict" || e.status === "failed")) {
        throw new Error("ไม่สามารถลบได้ กรุณาแก้ไขข้อมูลที่ขัดแย้ง หรือลองซิงก์ใหม่อีกครั้ง");
      }
      if (clientEvents.some(e => e.operation === "delete")) {
        return { approvalPending: false }; // Already deleting
      }

      const pendingCreates = clientEvents.filter(e => e.operation === "create");
      const pendingUpdates = clientEvents.filter(e => e.operation === "update");
      if (pendingCreates.some((event) => event.serverSubmissionAttempted === true)) {
        throw new Error(PENDING_SERVER_ACTION_MESSAGE);
      }

      assertRubberBillDeleteAllowed(
        pendingCreates.length,
        isOnline
      );

      if (pendingCreates.length > 0) {
        // Coalesce: remove the entire local-only history atomically, and don't
        // sync a delete for a record that never reached the Server.
        const coalescedEvents = [...pendingCreates, ...pendingUpdates];
        if (!await reconcileSyncEventsIfCurrent(coalescedEvents)) {
          throw new Error("ข้อมูลบิลในเครื่องถูกเปลี่ยนจากอีกหน้าต่าง กรุณาลองลบอีกครั้ง");
        }
        await removeConfirmedRubberBillLocally(
          queryClient, { ownerUserId, locationId: mutationLocationId }, clientTempId);
        return { approvalPending: false };
      }

      // If we replaced a pending update, use its server revision. Else use current bill's server revision.
      const targetRev = pendingUpdates.length > 0 ? pendingUpdates[0].payload.expectedRevisionNo : bill.revisionNo;
      const { payload: calculatedPayload } = buildRubberBillRpcPayload(
        bill,
        "delete",
        bill.configuredPriceSnapshot,
        deletedByName,
        deletedByPhone
      );
      const payload = {
        ...calculatedPayload,
        expectedRevisionNo: targetRev,
        idempotencyKey: `delete:${clientTempId}:${targetRev}`
      };

      const event: Omit<SyncEvent, "queueId"> = {
        id: clientTempId,
        entity: "rubber_bills",
        ownerUserId,
        locationId: mutationLocationId,
        operation: "delete",
        serverId: bill.id,
        serverBillNo: bill.serverBillNo,
        payload,
        timestamp: Date.now(),
        status: "pending"
      };
      let queuedEvent: SyncEvent;
      if (pendingUpdates.length > 0) {
        const [keeper] = pendingUpdates;
        const queueId = keeper.queueId;
        if (typeof queueId !== "number") {
          throw new Error("ข้อมูลคิวในเครื่องไม่สมบูรณ์ กรุณาลองเปิดแอปใหม่");
        }
        queuedEvent = { ...event, queueId };
        if (!await reconcileSyncEventsIfCurrent(pendingUpdates, queuedEvent)) {
          throw new Error("ข้อมูลบิลในเครื่องถูกเปลี่ยนจากอีกหน้าต่าง กรุณาลองลบอีกครั้ง");
        }
      } else {
        const queueId = await enqueueSyncEvent(event, clientEvents);
        if (queueId === null) {
          throw new Error("ข้อมูลบิลในเครื่องถูกเปลี่ยนจากอีกหน้าต่าง กรุณาลองลบอีกครั้ง");
        }
        queuedEvent = { ...event, queueId };
      }

      if (isOnline) {
        try {
          const response = await authFetch("/api/lanflow/rubber-bills", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, expectedServerId: bill.id }),
          });
          const data = await response.json();
          if (!response.ok) {
            if (isRetryableSyncResponse(response.status)) {
              throw new Error(data.errorMessage || "ระบบไม่พร้อมใช้งานชั่วคราว");
            }
            const isConflict = data.status === "conflict";
            queuedEvent.status = isConflict ? "conflict" : "failed";
            queuedEvent.errorMessage =
              data.errorMessage || (isConflict ? "ข้อมูลชนกัน" : "ซิงก์ไม่สำเร็จ");
            await updateSyncEventIfCurrent(queuedEvent);
            throw new Error(data.errorMessage || "ลบบิลไม่สำเร็จ");
          }
          const removeFromList = data.status === "synced";
          if (removeFromList) {
            await removeConfirmedRubberBillLocally(
              queryClient,
              { ownerUserId, locationId: mutationLocationId },
              clientTempId,
              queuedEvent.queueId,
            );
          } else {
            await removeRubberBillQueueEventBestEffort(queuedEvent);
          }
          return { approvalPending: data.status === "pending_approval" };
        } catch (error) {
          if (queuedEvent.status !== "pending") throw error;
          console.error("Network error while deleting rubber bill", error);
        }
      }

      return { approvalPending: false };
      } finally {
        if (directSubmissionScope) endDirectSubmission(directSubmissionScope);
      }
    },
    onSuccess: async (data, variables) => {
      if (data.approvalPending) {
        toast.success("ส่งคำขออนุมัติลบบิลยางแล้ว");
      }
      const mutationLocationId = variables?.bill.locationId || locationId;
      void invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId: mutationLocationId });
      void syncPendingRubberBills(queryClient, ownerUserId, mutationLocationId);
    }
  });

  async function discardSyncProblem(clientTempId: string) {
    const events = await getPendingEvents(queuePartition(ownerUserId, locationId));
    const relatedEvents = events.filter((event) => event.id === clientTempId);
    const hasSyncProblem = relatedEvents.some((event) => (
      event.status === "failed" || event.status === "conflict"
    ));
    if (!hasSyncProblem) {
      throw new Error("ไม่พบรายการซิงก์ที่มีปัญหาในเครื่องนี้");
    }

    const queueIds = relatedEvents.flatMap((event) => (
      typeof event.queueId === "number" ? [event.queueId] : []
    ));
    if (queueIds.length !== relatedEvents.length) {
      throw new Error("ข้อมูลคิวในเครื่องไม่สมบูรณ์ กรุณาลองเปิดแอปใหม่");
    }

    await removeSyncEvents(queueIds);
    await deleteRubberBillReceiptSnapshotsByClientTempId(locationId, clientTempId);
    await invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId });
  }

  return {
    addBill: (bill: RubberBill) => saveBillMutation.mutateAsync({ bill, approvalSettings: approvalSettings ?? null }),
    updateBill: (bill: RubberBill) => saveBillMutation.mutateAsync({ bill, approvalSettings: approvalSettings ?? null }),
    deleteBill: deleteBillMutation.mutateAsync,
    discardSyncProblem,
  };
}
