import type { QueryClient } from "@tanstack/react-query";
import { authFetch, canSyncCurrentSession } from "@/lib/auth-fetch";
import { getSyncDb, SYNC_QUEUE_STORE } from "@/lib/idb-core";
import { enqueueSyncEvent, reconcileSyncEventsIfCurrent, type SyncEvent } from "@/lib/idb-queue";
import { createScopedSingleFlight } from "@/lib/scoped-single-flight";
import { acknowledgeRubberCommand } from "./complete-command";
import { isConfirmedRubberSyncResult } from "./sync-result";
import { isConfirmedRubberManagerResult, isRubberQueueRow, rubberQueueMessage, type RubberQueueRow } from "./central-queue-contract";
import { prepareRubberBillCommand } from "./command";
import { RubberPreparationError, isUnsubmittedRubberPreparationFailure } from "@/lib/rubber-bills/preparation-failure";
import { notifyRubberBackgroundFailure, notifyRubberManagerOutcome } from "./background-notifications";
import { invalidateMoneyFlowLocation } from "@/lib/money-flow/invalidation";
import { removeConfirmedRubberBillLocally, removeRubberBillFromOperationalFeedCacheByBillId, removeRubberBillApprovalRequestFromPendingFeedCache } from "./feed-cache";
import { preserveRubberApprovalInCache } from "./feed-cache";

export const RUBBER_QUEUE_ENDPOINT = "/api/lanflow/rubber-bills/queue";
const flight = createScopedSingleFlight();
const requestedOwners = new Set<string>();
const receiptCheckOwners = new Set<string>();
const activityListeners = new Map<string, Set<() => void>>();
export function subscribeRubberQueueActivity(owner: string, listener: () => void) {
  const listeners = activityListeners.get(owner) ?? new Set<() => void>();
  listeners.add(listener); activityListeners.set(owner, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) activityListeners.delete(owner);
  };
}
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

export async function runRubberCentralQueue(queryClient: QueryClient, ownerUserId: string, forceReceiptCheck = false) {
  for (const listener of activityListeners.get(ownerUserId) ?? []) listener();
  requestedOwners.add(ownerUserId);
  if (forceReceiptCheck) receiptCheckOwners.add(ownerUserId);
  return flight(ownerUserId, async () => {
    for (let round = 0; round < 3 && requestedOwners.delete(ownerUserId); round++) {
      await runRubberCentralQueueRound(queryClient, ownerUserId, receiptCheckOwners.delete(ownerUserId));
    }
  });
}

async function runRubberCentralQueueRound(queryClient: QueryClient, ownerUserId: string, forceReceiptCheck: boolean) {
    if (!ownerUserId || !navigator.onLine) return;
    const events = (await rubberOwnerWork(ownerUserId)).filter(event => !isUnsubmittedRubberPreparationFailure(event)
      && ((event.nextAttemptAt ?? 0) <= Date.now()
      || (forceReceiptCheck && event.centralAccepted && event.status === 'pending')))
      .sort((a, b) => (a.nextAttemptAt ?? 0) - (b.nextAttemptAt ?? 0));
    const changed = new Set<string>();
    const localStatusChanges = new Set<string>();
    const deferredBranches = new Set<string>();
    for (let snapshot of fairRubberQueueRound(events)) {
      if (!navigator.onLine) break;
      if (deferredBranches.has(snapshot.locationId)) continue;
      if (!await canSyncCurrentSession(ownerUserId, snapshot.locationId, { background: true })) {
        if (!await canSyncCurrentSession(ownerUserId, undefined, { background: true })) break;
        deferredBranches.add(snapshot.locationId);
        await reconcileSyncEventsIfCurrent([snapshot], { ...snapshot, nextAttemptAt: Date.now() + 30_000 } as CentralEvent);
        continue;
      }
      if (snapshot.payload.localContextPending === true) {
        try {
          if (snapshot.serverSubmissionAttempted || snapshot.centralAccepted) throw new Error("Command already submitted");
          const payload = await prepareRubberBillCommand(snapshot.payload, ownerUserId,
            { commandId: snapshot.payload.commandId, completingLocal: true });
          const prepared = { ...snapshot, payload, errorMessage: undefined, failureCode: undefined, failureHttpStatus: undefined };
          if (!await reconcileSyncEventsIfCurrent([snapshot], prepared)) continue;
          if (snapshot.errorMessage) localStatusChanges.add(snapshot.locationId);
          snapshot = prepared;
        } catch (error) {
          deferredBranches.add(snapshot.locationId);
          const permanent = error instanceof RubberPreparationError && !snapshot.serverSubmissionAttempted && !snapshot.centralAccepted;
          const next: CentralEvent = { ...snapshot, nextAttemptAt: Date.now() + 15000,
            status: permanent ? "failed" : "pending", serverSubmissionAttempted: snapshot.serverSubmissionAttempted ?? false,
            failureCode: permanent ? error.code : undefined, failureHttpStatus: permanent ? 400 : undefined,
            errorMessage: permanent ? error.message : "รอเตรียมข้อมูลบิล ระบบจะลองใหม่อัตโนมัติ" };
          if (await reconcileSyncEventsIfCurrent([snapshot], next)
            && (snapshot.status !== next.status || snapshot.errorMessage !== next.errorMessage)) changed.add(snapshot.locationId);
          continue;
        }
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
            if (confirmed && !manager && row.result.status === "pending_approval") await preserveRubberApprovalInCache(queryClient, event, String(row.result.requestId));
            if ((confirmed || managerRetired) && await acknowledgeRubberCommand(event, row.result)) {
              if (manager) notifyRubberManagerOutcome(event, managerRetired ? rubberQueueMessage(row)
                : manager === "approve" ? "อนุมัติคำขอแล้ว" : "ลบคำขอแล้ว", !managerRetired);
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
              changed.add(event.locationId);
            } else if (!confirmed && !managerRetired) {
              deferredBranches.add(event.locationId);
              await reconcileSyncEventsIfCurrent([event], { ...event, nextAttemptAt: Date.now() + 15_000 } as CentralEvent);
            }
            continue;
          }
          const correction = row.state === "correction_required";
          const now = Date.now();
          const delay = row.state === "paused" || row.state === "retry_wait"
            ? Math.max(2_000, Math.min(30_000, Date.parse(row.nextAttemptAt) - now)) : 2_000;
          const next: CentralEvent = { ...event, centralAccepted: true, status: correction ? "failed" : "pending",
            serverSubmissionAttempted: !correction, failureHttpStatus: correction ? 400 : undefined,
            errorMessage: row.state === "queued" ? "เซิร์ฟเวอร์รับแล้ว รอประมวลผล" : rubberQueueMessage(row),
            nextAttemptAt: now + delay };
          if (await reconcileSyncEventsIfCurrent([event], next)) {
            if (!event.centralAccepted || snapshot.status !== next.status || snapshot.failureHttpStatus !== next.failureHttpStatus) changed.add(event.locationId);
            else if ((event.errorMessage ?? "เซิร์ฟเวอร์รับแล้ว รอประมวลผล") !== next.errorMessage) localStatusChanges.add(event.locationId);
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
    for (const locationId of localStatusChanges) {
      if (!changed.has(locationId)) await queryClient.invalidateQueries({ queryKey: ["rubberBillLocalState", ownerUserId, locationId] });
    }
    for (const locationId of changed) {
      await queryClient.invalidateQueries({ queryKey: ["rubberCentralQueue", ownerUserId, locationId] });
      await invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId });
    }
}
