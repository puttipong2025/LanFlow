import { notifyRubberBackgroundFailure, isRubberBackgroundScopeActive } from "@/lib/rubber-bills/background-notifications";
import { probeDeletedRubberCommand } from "@/lib/rubber-bills/sync-request";
import { sendRubberBillCommand, isConfirmedRubberSyncResult, recordRubberSyncFailure, prepareRubberBillCommand, acknowledgeRubberCommand } from "@/lib/rubber-bills/command";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { RubberBill } from "@/types";
import {
  enqueueSyncEvent,
  deleteRubberBillReceiptSnapshotsByClientTempId,
  getPendingEvents,
  reconcileSyncEventsIfCurrent,
  removeSyncEventIfCurrent,
  type SyncEvent,
} from "@/lib/idb-queue";
import { toast } from "sonner";
import {
  OFFLINE_SYNCED_ACTION_MESSAGE,
  PENDING_SERVER_ACTION_MESSAGE,
  isSyncedServerRecord,
} from "@/lib/record-action-locks";
import { canSyncCurrentSession } from "@/lib/auth-fetch";
import { isRetryableSyncResponse } from "@/lib/sync-response";
import { assertOfflineRubberBillPriceAllowed } from "@/lib/rubber-bills/approval";
import type { EffectiveRubberApprovalSettings } from "@/types";
import { invalidateMoneyFlowLocation } from "@/lib/money-flow/invalidation";
import { createScopedSingleFlight } from "@/lib/scoped-single-flight";
import { buildRubberBillRpcPayload } from "@/lib/rubber-bills/submission";
import { publishRubberBillLocalQueue, removeConfirmedRubberBillLocally } from "@/lib/rubber-bills/feed-cache";
import { normalizeRubberBillQueueBeforeSync } from "@/lib/rubber-bills/normalize-sync-queue";
import { isCentralRubberEvent, runRubberCentralQueue } from "@/lib/rubber-bills/central-sync";
import { immediateRubberReceipt } from "@/lib/rubber-bills/immediate-receipt";
import { isUnsubmittedRubberPreparationFailure } from "@/lib/rubber-bills/preparation-failure";
import { enqueueNumberedRubberCreate } from "@/lib/rubber-bills/numbering-idb";
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
    try { if (!await canSyncCurrentSession(ownerUserId, locationId)) return;
    if (!await normalizeRubberBillQueueBeforeSync(ownerUserId, locationId)) return;
    const pending = await getPendingEvents(queuePartition(ownerUserId, locationId));
    if (pending.some(isCentralRubberEvent)) await runRubberCentralQueue(queryClient, ownerUserId);
    const events = pending.filter(event => !isCentralRubberEvent(event));
    // Precompute: block ALL ids that have any failed/conflict event
    const blockedIds = new Set<string>(
      events
        .filter(e => e.status === "conflict" || e.status === "failed")
        .map(e => e.id)
    );

    for (const event of events) {
      if (!navigator.onLine || (event.payload.background && !isRubberBackgroundScopeActive(ownerUserId, locationId))) break;

      if (blockedIds.has(event.id)) {
        if (event.payload.background) {
          const proof = await probeDeletedRubberCommand(event);
          if (proof) await acknowledgeRubberCommand(event, await proof.json());
          else await notifyRubberBackgroundFailure(event);
        }
        continue;
      }

      try {
        if (event.serverSubmissionAttempted !== true) {
          const markedEvent = { ...event, serverSubmissionAttempted: true };
          if (!await reconcileSyncEventsIfCurrent([event], markedEvent)) break;
          event.serverSubmissionAttempted = true;
        }
        const response = await sendRubberBillCommand(event, {
            ...event.payload,
            ...(event.serverId ? { expectedServerId: event.serverId } : {}),
            submissionMode: "replay",
        });

        const data = await response.json();
        if (response.ok && !isConfirmedRubberSyncResult(data, event)) break;
        
        if (response.ok) {
          if (data.status === "pending_approval" && !data.silent) {
            toast.success("ส่งคำขออนุมัติบิลยางแล้ว");
          }
          if (event.payload.background) {
            if (!await acknowledgeRubberCommand(event, data)) continue;
          } else if (event.operation === "delete" && data.status === "synced") {
            if (!await removeSyncEventIfCurrent(event)) continue;
            await removeConfirmedRubberBillLocally(
              queryClient,
              { ownerUserId, locationId },
              event.id,
            );
          } else {
            await removeRubberBillQueueEventBestEffort(event);
          }
        } else {
          const outcome = await recordRubberSyncFailure(event, response.status, data);
          if (outcome === "discarded") {
            toast.info("ทิ้งรายการค้างที่ข้อมูลชนกันแล้ว บิลบนเซิร์ฟเวอร์ยังคงเดิม");
            continue;
          }
          if (outcome === "pending") break;
          await notifyRubberBackgroundFailure(event);
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

export function useRubberBillMutations(
  locationId: string,
  ownerUserId: string,
  approvalSettings?: EffectiveRubberApprovalSettings | null
) {
  const queryClient = useQueryClient();
  const saveBillMutation = useMutation({
    onError: async (_error, variables) => {
      await invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId: variables.bill.locationId || locationId });
    },
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
      let { calculatedBill, payload: builtPayload } = buildRubberBillRpcPayload(
        bill,
        operation,
        operation === "create" ? mutationApprovalSettings?.effectivePriceCap : bill.configuredPriceSnapshot
      );
      const isOnline = typeof navigator === "undefined" || navigator.onLine;
      let immediatePdfBill = immediateRubberReceipt(calculatedBill, mutationApprovalSettings);
      const existingEvents = await getPendingEvents(queuePartition(ownerUserId, mutationLocationId));
      const clientEvents = existingEvents.filter(e => e.id === bill.clientTempId);
      if (clientEvents[0]?.payload.billNumbering) {
        calculatedBill = { ...calculatedBill, localBillNo: clientEvents[0].payload.localBillNo, billNo: clientEvents[0].payload.localBillNo, billNumbering: clientEvents[0].payload.billNumbering };
        builtPayload = { ...builtPayload, localBillNo: calculatedBill.localBillNo, billNumbering: calculatedBill.billNumbering! };
        immediatePdfBill = immediateRubberReceipt(calculatedBill, mutationApprovalSettings);
      }
      const payload = clientEvents.length > 0 ? builtPayload : await prepareRubberBillCommand({ ...builtPayload, ...(operation === "update" ? { background: true, expectedServerId: bill.id } : {}) }, ownerUserId, { deferContext: operation === "update" || immediatePdfBill !== null });
      const centralQueue = "centralQueue" in payload && payload.centralQueue === true;
      if (clientEvents.some((event) => event.serverSubmissionAttempted === true)) {
        throw new Error(PENDING_SERVER_ACTION_MESSAGE);
      }

      const correcting = clientEvents.length === 1 && clientEvents[0].status === "failed"
        && clientEvents[0].failureHttpStatus === 400 && clientEvents[0].operation === operation;
      if (correcting && clientEvents[0].payload.centralQueue && !isOnline) throw new Error("ต้องออนไลน์เพื่อตรวจข้อมูลล่าสุดก่อนแก้ไขร่างในคิวกลาง");
      if (!correcting && clientEvents.some(e => e.status === "conflict" || e.status === "failed")) {
        throw new Error("ไม่สามารถบันทึกได้ กรุณาแก้ไขข้อมูลที่ขัดแย้ง หรือลองซิงก์ใหม่อีกครั้ง");
      }
      if (clientEvents.some(e => e.operation === "delete")) {
        throw new Error("ไม่สามารถบันทึกได้ บิลนี้กำลังถูกลบ");
      }

      const pendingCreates = clientEvents.filter(e => e.operation === "create");
      const pendingUpdates = clientEvents.filter(e => e.operation === "update");

      const keeper = pendingCreates[0] ?? pendingUpdates[0];
      let newlyQueuedEvent: SyncEvent | undefined;
      let committedLocalEvent: SyncEvent | undefined;

      if (keeper) {
        const commandPayload = correcting && keeper.payload.contractVersion === 2
          ? await prepareRubberBillCommand({ ...builtPayload, expectedRevisionNo: keeper.payload.expectedRevisionNo, ...(operation === "update" ? { background: true } : {}) }, ownerUserId, { deferContext: immediatePdfBill !== null })
          : keeper.payload.contractVersion === 2
            ? { ...builtPayload, ...(keeper.payload.centralQueue ? { centralQueue: true, actorUserId: ownerUserId, expectedQueueVersion: keeper.payload.expectedQueueVersion } : {}), ...(keeper.payload.background ? { background: true } : {}), contractVersion: 2, commandId: keeper.payload.commandId,
              expectedCommandGeneration: keeper.payload.expectedCommandGeneration, ...(keeper.payload.localContextPending ? { localContextPending: true } : {}) }
            : payload;
        const originalRev = keeper.payload.expectedRevisionNo;
        const updatedKeeper = {
          ...keeper,
          status: "pending" as const,
          errorMessage: undefined,
          failureHttpStatus: undefined,
          failureCode: undefined,
          serverSubmissionAttempted: correcting ? false : keeper.serverSubmissionAttempted,
          ...(correcting ? { centralAccepted: false, nextAttemptAt: 0 } : {}),
          payload: keeper.operation === "create"
            ? { ...commandPayload, operation: "create", expectedRevisionNo: 0,
              idempotencyKey: correcting && keeper.payload.contractVersion === 2 ? commandPayload.idempotencyKey : keeper.payload.idempotencyKey }
            : { ...commandPayload, operation: "update", expectedRevisionNo: originalRev,
              idempotencyKey: correcting && keeper.payload.contractVersion === 2 ? commandPayload.idempotencyKey : keeper.payload.idempotencyKey },
          timestamp: Date.now(),
        };
        if (!await reconcileSyncEventsIfCurrent(clientEvents, updatedKeeper)) {
          throw new Error("ข้อมูลบิลในเครื่องถูกเปลี่ยนจากอีกหน้าต่าง กรุณาลองใหม่อีกครั้ง");
        }
        committedLocalEvent = updatedKeeper;
      } else {
        const directSubmissionScope = !centralQueue && isOnline && operation === "create" && clientEvents.length === 0
          ? `${ownerUserId}:${mutationLocationId}`
          : null;
        if (directSubmissionScope) beginDirectSubmission(directSubmissionScope);
        let event: Omit<SyncEvent, "queueId"> = {
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
          const numbered = bill.numberingRequested && operation === "create" ? await enqueueNumberedRubberCreate(event, calculatedBill) : null;
          if (numbered) { event = numbered.event; calculatedBill = numbered.bill; immediatePdfBill = immediateRubberReceipt(calculatedBill, mutationApprovalSettings); }
          const queuedId = numbered ? numbered.event.queueId! : await enqueueSyncEvent(event, clientEvents);
          if (queuedId === null) {
            throw new Error("ข้อมูลบิลในเครื่องถูกเปลี่ยนจากอีกหน้าต่าง กรุณาลองใหม่อีกครั้ง");
          }
          queueId = queuedId;
        } catch (error) {
          if (directSubmissionScope) endDirectSubmission(directSubmissionScope);
          throw error;
        }
        newlyQueuedEvent = { ...event, queueId };
        committedLocalEvent = newlyQueuedEvent;
      }

      if (!centralQueue && isOnline && clientEvents.length === 0 && newlyQueuedEvent && operation === "create") {
        try {
          const response = await sendRubberBillCommand(newlyQueuedEvent, {
              ...payload,
          });
          const data = await response.json();
          if (response.ok && !isConfirmedRubberSyncResult(data, newlyQueuedEvent)) {
            throw new Error("กำลังรอยืนยันผลบิลยางจากเซิร์ฟเวอร์");
          }
          if (!response.ok) {
            if (isRetryableSyncResponse(response.status, data)) {
              throw new Error(data.errorMessage || "ระบบไม่พร้อมใช้งานชั่วคราว");
            }
            const outcome = await recordRubberSyncFailure(newlyQueuedEvent, response.status, data);
            if (outcome === "discarded") {
              newlyQueuedEvent.status = "conflict";
              throw new Error("ทิ้งรายการค้างที่ข้อมูลชนกันแล้ว บิลบนเซิร์ฟเวอร์ยังคงเดิม");
            }
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
            immediatePdfBill: null as RubberBill | null,
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
        immediatePdfBill,
        syncStatus: "pending" as const,
        committedLocalEvent,
        serverSubmissionAttempted: operation === "update" || (isOnline && centralQueue) || newlyQueuedEvent?.serverSubmissionAttempted === true,
        configuredPriceSnapshot:
          operation === "create"
            ? mutationApprovalSettings?.effectivePriceCap ?? null
            : bill.configuredPriceSnapshot,
        approvalPending: false,
      };
    },
    onSuccess: async (savedBill, variables) => {
      if (savedBill.approvalPending) {
        toast.success("ส่งคำขออนุมัติบิลยางแล้ว");
      }
      const mutationLocationId = variables?.bill.locationId || locationId;
      // Hand the mutation lock to the pending row before the form can close.
      await publishRubberBillLocalQueue(queryClient, { ownerUserId, locationId: mutationLocationId }, variables.bill.clientTempId,
        "committedLocalEvent" in savedBill ? savedBill.committedLocalEvent : undefined);
      void invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId: mutationLocationId });
      void syncPendingRubberBills(queryClient, ownerUserId, mutationLocationId);
    }
  });

  const deleteBillMutation = useMutation({
    onError: async (_error, variables) => {
      await invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId: variables.bill.locationId || locationId });
    },
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
      if (clientEvents.some((event) => event.serverSubmissionAttempted === true)) {
        throw new Error(PENDING_SERVER_ACTION_MESSAGE);
      }

      if (clientEvents.some(e => e.status === "conflict" || e.status === "failed")) {
        throw new Error("ไม่สามารถลบได้ กรุณาแก้ไขข้อมูลที่ขัดแย้ง หรือลองซิงก์ใหม่อีกครั้ง");
      }
      const existingDelete = clientEvents.find(e => e.operation === "delete");
      if (existingDelete) {
        return { approvalPending: false, committedLocalEvent: existingDelete };
      }

      const pendingCreates = clientEvents.filter(e => e.operation === "create");
      const pendingUpdates = clientEvents.filter(e => e.operation === "update");

      assertRubberBillDeleteAllowed(
        pendingCreates.length,
        isOnline
      );

      if (pendingCreates.length > 0) {
        if (bill.syncStatus !== "pending" || bill.serverBillNo || bill.id !== bill.clientTempId || clientEvents.some(event => event.serverId || event.serverBillNo
          || event.serverSubmissionAttempted !== false || (event as SyncEvent & { centralAccepted?: boolean }).centralAccepted === true)) {
          throw new Error(PENDING_SERVER_ACTION_MESSAGE);
        }
        // Coalesce: remove the entire local-only history atomically, and don't
        // sync a delete for a record that never reached the Server.
        const coalescedEvents = [...pendingCreates, ...pendingUpdates];
        if (!await reconcileSyncEventsIfCurrent(coalescedEvents, undefined, true)) {
          throw new Error("ข้อมูลบิลในเครื่องถูกเปลี่ยนจากอีกหน้าต่าง กรุณาลองลบอีกครั้ง");
        }
        await removeConfirmedRubberBillLocally(
          queryClient, { ownerUserId, locationId: mutationLocationId }, clientTempId);
        return { approvalPending: false };
      }

      if (!isSyncedServerRecord(bill)) {
        throw new Error("สถานะบิลเปลี่ยนแล้ว กรุณาโหลดรายการล่าสุดก่อนลบ");
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
      const payload = await prepareRubberBillCommand({
        ...calculatedPayload, background: true, expectedServerId: bill.id,
        expectedRevisionNo: targetRev,
        idempotencyKey: `delete:${clientTempId}:${targetRev}`
      }, ownerUserId, { deferContext: true });

      const event: Omit<SyncEvent, "queueId"> = {
        id: clientTempId,
        entity: "rubber_bills",
        ownerUserId,
        locationId: mutationLocationId,
        operation: "delete",
        serverSubmissionAttempted: false,
        serverId: bill.id,
        serverBillNo: bill.serverBillNo,
        payload,
        timestamp: Date.now(),
        status: "pending"
      };
      let committedLocalEvent: SyncEvent;
      if (pendingUpdates.length > 0) {
        const [keeper] = pendingUpdates;
        const queueId = keeper.queueId;
        if (typeof queueId !== "number") {
          throw new Error("ข้อมูลคิวในเครื่องไม่สมบูรณ์ กรุณาลองเปิดแอปใหม่");
        }
        const queuedEvent = { ...event, queueId };
        if (!await reconcileSyncEventsIfCurrent(pendingUpdates, queuedEvent)) {
          throw new Error("ข้อมูลบิลในเครื่องถูกเปลี่ยนจากอีกหน้าต่าง กรุณาลองลบอีกครั้ง");
        }
        committedLocalEvent = queuedEvent;
      } else {
        const queueId = await enqueueSyncEvent(event, clientEvents);
        if (queueId === null) {
          throw new Error("ข้อมูลบิลในเครื่องถูกเปลี่ยนจากอีกหน้าต่าง กรุณาลองลบอีกครั้ง");
        }
        committedLocalEvent = { ...event, queueId };
      }
      return { approvalPending: false, committedLocalEvent };
      } finally {
        if (directSubmissionScope) endDirectSubmission(directSubmissionScope);
      }
    },
    onSuccess: async (_data, variables) => {
      const mutationLocationId = variables?.bill.locationId || locationId;
      await publishRubberBillLocalQueue(queryClient, { ownerUserId, locationId: mutationLocationId }, variables.bill.clientTempId, _data.committedLocalEvent);
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
    if (relatedEvents.some(event => isCentralRubberEvent(event) && !isUnsubmittedRubberPreparationFailure(event))) {
      throw new Error("รายการนี้อยู่ในคิวซิงก์กลาง กรุณาแก้ไขร่างจากคิวซิงก์กลางก่อน");
    }

    const queueIds = relatedEvents.flatMap((event) => (
      typeof event.queueId === "number" ? [event.queueId] : []
    ));
    if (queueIds.length !== relatedEvents.length) {
      throw new Error("ข้อมูลคิวในเครื่องไม่สมบูรณ์ กรุณาลองเปิดแอปใหม่");
    }

    if (!await reconcileSyncEventsIfCurrent(relatedEvents, undefined, true)) {
      throw new Error("รายการค้างถูกเปลี่ยนจากอีกหน้าต่าง กรุณาลองใหม่");
    }
    await deleteRubberBillReceiptSnapshotsByClientTempId(locationId, clientTempId);
    await invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId });
  }

  return {
    pendingBillClientId: saveBillMutation.isPending ? saveBillMutation.variables?.bill.clientTempId : deleteBillMutation.isPending ? deleteBillMutation.variables?.bill.clientTempId : undefined,
    addBill: (bill: RubberBill) => saveBillMutation.mutateAsync({ bill, approvalSettings: approvalSettings ?? null }),
    updateBill: (bill: RubberBill) => saveBillMutation.mutateAsync({ bill, approvalSettings: approvalSettings ?? null }),
    deleteBill: deleteBillMutation.mutateAsync,
    discardSyncProblem,
  };
}
