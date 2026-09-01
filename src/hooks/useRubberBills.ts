import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { RubberBill } from "@/types";
import {
  enqueueSyncEvent,
  deleteRubberBillReceiptSnapshotsByClientTempId,
  getPendingEvents,
  removeSyncEvent,
  removeSyncEvents,
  type SyncEvent,
} from "@/lib/idb-queue";
import { toast } from "sonner";
import { OFFLINE_SYNCED_ACTION_MESSAGE } from "@/lib/record-action-locks";
import { authFetch } from "@/lib/auth-fetch";
import { isRetryableSyncResponse } from "@/lib/sync-response";
import {
  assertOfflineRubberBillPriceAllowed,
  isRubberBillPriceApprovalRequired,
} from "@/lib/rubber-bills/approval";
import type { EffectiveRubberApprovalSettings } from "@/types";
import {
  applyRubberBillCalculation,
  multiplyMoneyFloorBaht,
} from "@/lib/rubber-bills/calculations";
import { invalidateMoneyFlowLocation } from "@/lib/money-flow/invalidation";
import { createScopedSingleFlight } from "@/lib/scoped-single-flight";

export function assertRubberBillDeleteAllowed(pendingCreateCount: number, isOnline: boolean) {
  if (pendingCreateCount === 0 && !isOnline) {
    throw new Error(OFFLINE_SYNCED_ACTION_MESSAGE);
  }
}

function buildRpcPayload(
  bill: RubberBill,
  operation: "create" | "update" | "delete",
  configuredPriceSnapshot?: number | null,
  deletedByName?: string,
  deletedByPhone?: string
) {
  const calculatedBill = applyRubberBillCalculation({
    ...bill,
    weighItems: bill.weighItems ?? [],
  });
  const items: any[] = [];
  
  calculatedBill.weighItems.forEach((item, i) => {
    items.push({
      itemType: "weigh",
      title: item.label,
      description: item.label,
      inWeight: item.inWeight,
      outWeight: item.outWeight,
      netWeight: item.netWeight,
      unitPrice: item.price,
      totalAmount: item.total ?? multiplyMoneyFloorBaht(item.netWeight, item.price),
      sequenceNo: i + 1
    });
  });

  (calculatedBill.acidItems || []).forEach((item, i) => {
    items.push({
      itemType: "stock_deduction",
      title: item.name,
      description: item.name,
      stockProductId: item.stockProductId,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      totalAmount: item.total ?? multiplyMoneyFloorBaht(item.quantity, item.unitPrice),
      sequenceNo: calculatedBill.weighItems.length + i + 1
    });
  });

  const allDebts = calculatedBill.debtItems
    ?? (calculatedBill.debtItem ? [calculatedBill.debtItem] : []);
  allDebts.forEach((item, i) => {
    items.push({
      itemType: "debt",
      title: item.title,
      description: item.title,
      totalAmount: item.amount,
      sequenceNo: calculatedBill.weighItems.length + (calculatedBill.acidItems?.length || 0) + i + 1
    });
  });

  return {
    calculatedBill,
    payload: {
      operation,
      formulaVersion: 2,
      expectedRevisionNo: calculatedBill.revisionNo,
      clientTempId: calculatedBill.clientTempId,
      idempotencyKey: `${operation}:${calculatedBill.clientTempId}:${calculatedBill.revisionNo}`,
      locationId: calculatedBill.locationId,
      recordStatus: operation === "delete" ? "deleted" : calculatedBill.recordStatus,
      localBillNo: calculatedBill.localBillNo,
      billDate: calculatedBill.billDate,
      customerId: calculatedBill.customerId ?? null,
      customerName: calculatedBill.customerName,
      configuredPriceSnapshot:
        operation === "create"
          ? configuredPriceSnapshot
          : calculatedBill.configuredPriceSnapshot ?? null,
      billType: calculatedBill.billType,
      deductWeight: calculatedBill.deductWeight,
      weight: calculatedBill.weight,
      netWeight: calculatedBill.netWeight,
      rubberValue: calculatedBill.weighValueTotal,
      netRubberValue: calculatedBill.rubberValue,
      averagePrice: calculatedBill.price,
      deductionTotal: calculatedBill.deductionTotal,
      payableBeforeRounding: calculatedBill.payableBeforeRounding,
      netTotal: calculatedBill.netTotal,
      acidPackCount: calculatedBill.acidPackCount,
      createdByUserId: calculatedBill.createdByUserId,
      createdByName: calculatedBill.createdByName,
      createdByPhone: calculatedBill.createdByPhone,
      clientRecordedAt: calculatedBill.clientRecordedAt || new Date().toISOString(),
      clientCreatedAt: calculatedBill.clientCreatedAt || new Date().toISOString(),
      ...(operation === "create" ? {
        inputMethod: calculatedBill.inputMethod ?? "manual",
        ...(calculatedBill.inputMethod === "ocr" && calculatedBill.ocrUploadId
          ? { ocrUploadId: calculatedBill.ocrUploadId }
          : {}),
      } : {}),
      deletedByName,
      deletedByPhone,
      items,
    },
  };
}

const runRubberBillSyncSingleFlight = createScopedSingleFlight();

function queuePartition(ownerUserId: string, locationId: string) {
  return { entity: "rubber_bills" as const, ownerUserId, locationId };
}

export function syncPendingRubberBills(
  queryClient: QueryClient,
  ownerUserId: string,
  locationId: string,
): Promise<void> {
  if (!ownerUserId || !locationId || !navigator.onLine) return Promise.resolve();
  const scopeKey = `${ownerUserId}:${locationId}`;
  return runRubberBillSyncSingleFlight(scopeKey, async () => {
    try {
    await normalizeRubberBillQueueBeforeSync(ownerUserId, locationId);
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
        const response = await authFetch("/api/lanflow/rubber-bills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event.payload)
        });

        const data = await response.json();
        
        if (response.ok) {
          if (data.status === "pending_approval") {
            toast.success("ส่งคำขออนุมัติบิลยางแล้ว");
          }
          // Success -> remove from queue
          await removeSyncEvent(event.queueId!);
        } else if (isRetryableSyncResponse(response.status)) {
          break;
        } else {
          // Use RPC-level status to distinguish conflict from failed
          const isConflict = data.status === "conflict";
          const eventStatus = isConflict ? "conflict" : "failed";
          
          console.warn(`Sync ${eventStatus} for`, event.id, data.errorMessage);
          event.status = eventStatus;
          event.errorMessage = data.errorMessage || (isConflict ? "ข้อมูลชนกัน" : "ซิงก์ไม่สำเร็จ");
          await import("@/lib/idb-queue").then(m => m.updateSyncEvent(event));
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
  const { getPendingEvents, removeSyncEvent, updateSyncEvent } = await import("@/lib/idb-queue");
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

    if (result.action === "noop") {
      for (const e of group) await removeSyncEvent(e.queueId!);
    } else {
      await updateSyncEvent(result.keeper);
      for (const e of result.remove) await removeSyncEvent(e.queueId!);
    }
  }
}

export function useRubberBillMutations(
  locationId: string,
  ownerUserId: string,
  approvalSettings?: EffectiveRubberApprovalSettings | null,
) {
  const queryClient = useQueryClient();

  const saveBillMutation = useMutation({
    networkMode: "always",
    mutationFn: async (bill: RubberBill) => {
      const isUpdate = Boolean(bill.serverBillNo) || bill.id !== bill.clientTempId;
      const operation = isUpdate ? "update" : "create";
      if ((bill.acidItems?.length ?? 0) > 0 && typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error("รายการหักสินค้าตัดสต็อก ต้องออนไลน์ก่อนบันทึก");
      }
      if (operation === "update" && typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error(OFFLINE_SYNCED_ACTION_MESSAGE);
      }
      if (operation === "create" && typeof navigator !== "undefined") {
        if (!approvalSettings) {
          throw new Error(
            navigator.onLine
              ? "กำลังโหลดกติกาอนุมัติ กรุณารอสักครู่แล้วบันทึกอีกครั้ง"
              : "เครื่องนี้ยังไม่เคยโหลดกติกาอนุมัติ กรุณาออนไลน์ก่อนสร้างบิล"
          );
        }
        assertOfflineRubberBillPriceAllowed(
          (bill.weighItems ?? []).map((item) => item.price),
          bill.billDate,
          approvalSettings,
          navigator.onLine
        );
      }
      
      const { calculatedBill, payload } = buildRpcPayload(
        bill,
        operation,
        operation === "create" ? approvalSettings?.configuredPrice : bill.configuredPriceSnapshot
      );
      const isOnline = typeof navigator === "undefined" || navigator.onLine;
      const existingEvents = await getPendingEvents(queuePartition(ownerUserId, locationId));
      const clientEvents = existingEvents.filter(e => e.id === bill.clientTempId);

      if (clientEvents.some(e => e.status === "conflict" || e.status === "failed")) {
        throw new Error("ไม่สามารถบันทึกได้ กรุณาแก้ไขข้อมูลที่ขัดแย้ง หรือลองซิงก์ใหม่อีกครั้ง");
      }
      if (clientEvents.some(e => e.operation === "delete")) {
        throw new Error("ไม่สามารถบันทึกได้ บิลนี้กำลังถูกลบ");
      }

      const pendingCreates = clientEvents.filter(e => e.operation === "create");
      const pendingUpdates = clientEvents.filter(e => e.operation === "update");

      const mLib = await import("@/lib/idb-queue");

      let keeper: typeof clientEvents[0] | undefined;
      let toDelete: typeof clientEvents = [];
      let newlyQueuedEvent: SyncEvent | undefined;

      if (pendingCreates.length > 0) {
        keeper = pendingCreates[0]; // oldest create
        toDelete = [...pendingCreates.slice(1), ...pendingUpdates];
      } else if (pendingUpdates.length > 0) {
        keeper = pendingUpdates[0]; // oldest update
        toDelete = pendingUpdates.slice(1);
      }

      for (const e of toDelete) {
        if (e.queueId) await mLib.removeSyncEvent(e.queueId);
      }

      if (keeper) {
        if (keeper.operation === "create") {
          keeper.payload = { ...payload, operation: "create", expectedRevisionNo: 0 };
          keeper.timestamp = Date.now();
          await mLib.updateSyncEvent(keeper);
        } else {
          const originalRev = keeper.payload.expectedRevisionNo;
          keeper.payload = { 
            ...payload, 
            operation: "update", 
            expectedRevisionNo: originalRev,
            idempotencyKey: `update:${bill.clientTempId}:${originalRev}`
          };
          keeper.timestamp = Date.now();
          await mLib.updateSyncEvent(keeper);
        }
      } else {
        const event: Omit<SyncEvent, "queueId"> = {
          id: bill.clientTempId,
          entity: "rubber_bills",
          ownerUserId,
          locationId,
          operation,
          payload,
          timestamp: Date.now(),
          status: "pending"
        };
        const queueId = await enqueueSyncEvent(event);
        newlyQueuedEvent = { ...event, queueId };
      }

      if (isOnline && clientEvents.length === 0 && newlyQueuedEvent) {
        try {
          const response = await authFetch("/api/lanflow/rubber-bills", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
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
            await mLib.updateSyncEvent(newlyQueuedEvent);
            throw new Error(data.errorMessage || "บันทึกบิลไม่สำเร็จ");
          }
          await mLib.removeSyncEvent(newlyQueuedEvent.queueId!);
          return {
            ...calculatedBill,
            id: data.id ?? bill.id,
            serverBillNo: data.serverBillNo ?? bill.serverBillNo,
            billNo: data.serverBillNo ?? bill.billNo,
            syncStatus: data.status === "synced" ? "synced" as const : "pending" as const,
            revisionNo: data.revisionNo ?? bill.revisionNo,
            serverReceivedAt: data.serverReceivedAt ?? bill.serverReceivedAt,
            configuredPriceSnapshot:
              operation === "create"
                ? approvalSettings?.configuredPrice ?? null
                : bill.configuredPriceSnapshot,
            approvalPending: data.status === "pending_approval",
            approvalRequestId: data.requestId,
            approvalOperation: data.operation,
          };
        } catch (error) {
          if (newlyQueuedEvent.status !== "pending") throw error;
          console.error("Network error while saving rubber bill", error);
        }
      }
      
      return {
        ...calculatedBill,
        syncStatus: "pending" as const,
        configuredPriceSnapshot:
          operation === "create"
            ? approvalSettings?.configuredPrice ?? null
            : bill.configuredPriceSnapshot,
        approvalPending:
          operation === "create"
          && isRubberBillPriceApprovalRequired(
            (bill.weighItems ?? []).map((item) => item.price),
            {
              configuredPrice: approvalSettings?.configuredPrice ?? null,
              priceTimeExempt: approvalSettings?.priceTimeExempt ?? false,
            }
          ),
      };
    },
    onSuccess: (savedBill) => {
      if (savedBill.approvalPending) {
        toast.success("ส่งคำขออนุมัติบิลยางแล้ว");
      }
      void invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId });
      void syncPendingRubberBills(queryClient, ownerUserId, locationId);
    }
  });

  const deleteBillMutation = useMutation({
    networkMode: "always",
    mutationFn: async ({ bill, deletedByName, deletedByPhone }: { bill: RubberBill, deletedByName: string, deletedByPhone: string }) => {
      const clientTempId = bill.clientTempId;
      const existingEvents = await getPendingEvents(queuePartition(ownerUserId, locationId));
      const clientEvents = existingEvents.filter(e => e.id === clientTempId);

      if (clientEvents.some(e => e.status === "conflict" || e.status === "failed")) {
        throw new Error("ไม่สามารถลบได้ กรุณาแก้ไขข้อมูลที่ขัดแย้ง หรือลองซิงก์ใหม่อีกครั้ง");
      }
      if (clientEvents.some(e => e.operation === "delete")) {
        return { clientTempId, coalesced: false }; // Already deleting
      }

      const pendingCreates = clientEvents.filter(e => e.operation === "create");
      const pendingUpdates = clientEvents.filter(e => e.operation === "update");

      assertRubberBillDeleteAllowed(
        pendingCreates.length,
        typeof navigator === "undefined" || navigator.onLine
      );

      const mLib = await import("@/lib/idb-queue");

      // Cleanup all pending updates (they will be replaced by this delete)
      for (const e of pendingUpdates) {
        if (e.queueId) await mLib.removeSyncEvent(e.queueId);
      }

      if (pendingCreates.length > 0) {
        // Coalesce: remove all creates, and don't sync delete to server
        for (const e of pendingCreates) {
          if (e.queueId) await mLib.removeSyncEvent(e.queueId);
        }
        return { clientTempId, coalesced: true };
      }

      // If we replaced a pending update, use its server revision. Else use current bill's server revision.
      const targetRev = pendingUpdates.length > 0 ? pendingUpdates[0].payload.expectedRevisionNo : bill.revisionNo;
      const { payload: calculatedPayload } = buildRpcPayload(
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
        locationId,
        operation: "delete",
        payload,
        timestamp: Date.now(),
        status: "pending"
      };
      const queueId = await enqueueSyncEvent(event);
      const queuedEvent: SyncEvent = { ...event, queueId };

      if (typeof navigator === "undefined" || navigator.onLine) {
        try {
          const response = await authFetch("/api/lanflow/rubber-bills", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
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
            await mLib.updateSyncEvent(queuedEvent);
            throw new Error(data.errorMessage || "ลบบิลไม่สำเร็จ");
          }
          await mLib.removeSyncEvent(queueId);
          return {
            clientTempId,
            coalesced: false,
            approvalPending: data.status === "pending_approval",
          };
        } catch (error) {
          if (queuedEvent.status !== "pending") throw error;
          console.error("Network error while deleting rubber bill", error);
        }
      }

      return { clientTempId, coalesced: false, approvalPending: false };
    },
    onSuccess: (data) => {
      if (data.approvalPending) {
        toast.success("ส่งคำขออนุมัติลบบิลยางแล้ว");
      }
      void invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId });
      void syncPendingRubberBills(queryClient, ownerUserId, locationId);
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
    addBill: saveBillMutation.mutateAsync,
    updateBill: saveBillMutation.mutateAsync,
    deleteBill: deleteBillMutation.mutateAsync,
    discardSyncProblem,
  };
}
