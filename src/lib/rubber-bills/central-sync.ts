import type { QueryClient } from "@tanstack/react-query";
import { authFetch, canSyncCurrentSession } from "@/lib/auth-fetch";
import { getSyncDb, SYNC_QUEUE_STORE } from "@/lib/idb-core";
import { enqueueSyncEvent, reconcileSyncEventsIfCurrent, type SyncEvent } from "@/lib/idb-queue";
import { createScopedSingleFlight } from "@/lib/scoped-single-flight";
import { acknowledgeRubberCommand } from "./complete-command";
import { isConfirmedRubberSyncResult } from "./sync-result";
import { isConfirmedRubberManagerResult, isRubberQueueRow, rubberQueueMessage, type RubberQueueRow } from "./central-queue-contract";
import { completeRubberQueuePrint } from "./central-print";
import { notifyRubberBackgroundFailure } from "./background-notifications";
import { invalidateMoneyFlowLocation } from "@/lib/money-flow/invalidation";
import { removeConfirmedRubberBillLocally, removeRubberBillFromOperationalFeedCacheByBillId, removeRubberBillApprovalRequestFromPendingFeedCache } from "./feed-cache";

export const RUBBER_QUEUE_ENDPOINT = "/api/lanflow/rubber-bills/queue";
const flight = createScopedSingleFlight();
type CentralEvent = SyncEvent & { nextAttemptAt?: number; attempts?: number; centralAccepted?: boolean };
export const isCentralRubberEvent = (event: SyncEvent) => event.entity === "rubber_bills" && event.payload.centralQueue === true;

export function fairRubberQueueRound(events: CentralEvent[], limit = 20) {
  const branches = new Map<string, CentralEvent[]>();
  for (const event of events) {
    const group = branches.get(event.locationId) ?? [];
    group.push(event); branches.set(event.locationId, group);
  }
  const round: CentralEvent[] = [];
  while (round.length < limit && branches.size) {
    for (const [location, group] of branches) {
      round.push(group.shift()!);
      if (!group.length) branches.delete(location);
      if (round.length === limit) break;
    }
  }
  return round;
}

export async function rubberOwnerWork(ownerUserId: string): Promise<CentralEvent[]> {
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_QUEUE_STORE, "readonly");
    const read = tx.objectStore(SYNC_QUEUE_STORE).index("ownerUserId").getAll(ownerUserId);
    read.onsuccess = () => resolve((read.result as CentralEvent[]).filter(isCentralRubberEvent));
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export function matchesRubberQueueEvent(row: unknown, event: SyncEvent): row is RubberQueueRow {
  return isRubberQueueRow(row) && row.commandId === event.payload.commandId && row.actorUserId === event.ownerUserId
    && row.locationId === event.locationId && row.clientTempId === event.id
    && row.action === (event.payload.queueAction ?? event.operation);
}

export async function acceptRubberManagerCommand(ownerUserId: string, locationId: string, targetRequestId: string, queueAction: "approve" | "cancel") {
  if (!navigator.onLine) throw new Error("ต้องออนไลน์เพื่อตรวจคำขออนุมัติ");
  if (!await canSyncCurrentSession(ownerUserId, locationId, { background: true })) throw new Error("กรุณาตรวจบัญชีและสิทธิ์ก่อนส่งคำสั่ง");
  const commandId = crypto.randomUUID();
  const id = `request:${targetRequestId}`;
  const payload = { centralQueue: true, background: true, contractVersion: 2, commandId, idempotencyKey: commandId,
    actorUserId: ownerUserId, locationId, clientTempId: id, queueAction, targetRequestId, operation: "update" };
  const existing = (await rubberOwnerWork(ownerUserId)).filter(event => event.locationId === locationId && event.id === id);
  if (existing.length) throw new Error("คำขอนี้มีคำสั่งรอยืนยันอยู่แล้ว");
  const queued = await enqueueSyncEvent({ id, entity: "rubber_bills", ownerUserId, locationId,
    operation: "update", payload, status: "pending", timestamp: Date.now() }, []);
  if (queued === null) throw new Error("คิวเปลี่ยนจากอีกหน้าต่าง กรุณาตรวจรายการล่าสุด");
  return { queued: true };
}

export async function runRubberCentralQueue(queryClient: QueryClient, ownerUserId: string) {
  return flight(ownerUserId, async () => {
    if (!ownerUserId || !navigator.onLine) return;
    const events = (await rubberOwnerWork(ownerUserId)).filter(event => (event.nextAttemptAt ?? 0) <= Date.now())
      .sort((a, b) => (a.nextAttemptAt ?? 0) - (b.nextAttemptAt ?? 0));
    const changed = new Set<string>();
    const deferredBranches = new Set<string>();
    for (const snapshot of fairRubberQueueRound(events)) {
      if (!navigator.onLine) break;
      if (deferredBranches.has(snapshot.locationId)) continue;
      if (!await canSyncCurrentSession(ownerUserId, snapshot.locationId, { background: true })) {
        if (!await canSyncCurrentSession(ownerUserId, undefined, { background: true })) break;
        deferredBranches.add(snapshot.locationId);
        await reconcileSyncEventsIfCurrent([snapshot], { ...snapshot, nextAttemptAt: Date.now() + 30_000 } as CentralEvent);
        continue;
      }
      // The marked immutable snapshot survives lost admission responses.
      const event: CentralEvent = { ...snapshot, serverSubmissionAttempted: true };
      if (!await reconcileSyncEventsIfCurrent([snapshot], event)) continue;
      try {
        const params = new URLSearchParams({ commandId: event.payload.commandId, locationId: event.locationId });
        const response = await authFetch(event.centralAccepted ? `${RUBBER_QUEUE_ENDPOINT}?${params}` : RUBBER_QUEUE_ENDPOINT,
          event.centralAccepted ? { cache: "no-store", signal: AbortSignal.timeout(15_000) }
            : { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000), body: JSON.stringify(event.payload) },
          { background: true });
        const row: unknown = await response.json();
        // Account changes during a request never reconcile/print into another session.
        if (!await canSyncCurrentSession(ownerUserId, undefined, { background: true })) break;
        if (response.ok && matchesRubberQueueEvent(row, event)) {
          if (row.state === "done" && row.result) {
            const manager = event.payload.queueAction;
            const confirmed = manager ? isConfirmedRubberManagerResult(row.result, manager, event.payload.targetRequestId)
              : isConfirmedRubberSyncResult(row.result, event);
            const managerRetired = manager && row.result.status === "discarded" && row.result.commandId === event.payload.commandId
              && row.result.operation === manager && row.result.clientTempId === event.id;
            if ((confirmed || managerRetired) && await acknowledgeRubberCommand(event, row.result)) {
              const scope = { ownerUserId, locationId: event.locationId };
              try {
                if (manager) {
                  await removeRubberBillApprovalRequestFromPendingFeedCache(queryClient, scope, event.payload.targetRequestId);
                  if (row.result.status === "approved" && row.result.operation === "delete" && typeof row.result.billId === "string") {
                    await removeRubberBillFromOperationalFeedCacheByBillId(queryClient, scope, row.result.billId);
                  }
                } else if ((event.operation === "delete" && row.result.status === "synced") || row.result.errorCode === "BILL_ALREADY_DELETED") {
                  await removeConfirmedRubberBillLocally(queryClient, scope, event.id);
                }
              } catch (error) { console.warn("Unable to refresh completed Rubber command cache", error); }
              completeRubberQueuePrint(event.payload.commandId, row.result);
              changed.add(event.locationId);
            } else if (!confirmed && !managerRetired) {
              deferredBranches.add(event.locationId);
              await reconcileSyncEventsIfCurrent([event], { ...event, nextAttemptAt: Date.now() + 15_000 } as CentralEvent);
            }
            continue;
          }
          const correction = row.state === "correction_required";
          const next: CentralEvent = { ...event, centralAccepted: true, status: correction ? "failed" : "pending",
            serverSubmissionAttempted: !correction, failureHttpStatus: correction ? 400 : undefined,
            errorMessage: correction ? rubberQueueMessage(row) : undefined,
            nextAttemptAt: Date.now() + 10_000 };
          if (await reconcileSyncEventsIfCurrent([event], next)) {
            changed.add(event.locationId);
            if (correction) await notifyRubberBackgroundFailure(next);
          }
        } else {
          deferredBranches.add(event.locationId);
          const attempts = (event.attempts ?? 0) + 1;
          await reconcileSyncEventsIfCurrent([event], { ...event, attempts,
            nextAttemptAt: Date.now() + Math.min(120_000, 5_000 * 2 ** Math.min(attempts, 5)) } as CentralEvent);
        }
      } catch {
        deferredBranches.add(event.locationId);
        await reconcileSyncEventsIfCurrent([event], { ...event, nextAttemptAt: Date.now() + 15_000 } as CentralEvent);
      }
    }
    for (const locationId of changed) {
      await queryClient.invalidateQueries({ queryKey: ["rubberCentralQueue", ownerUserId, locationId] });
      await invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId });
    }
  });
}
