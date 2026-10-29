import type { QueryClient } from "@tanstack/react-query";
import type { IncomeExpense } from "@/types";
import { authFetch, canSyncCurrentSession } from "@/lib/auth-fetch";
import { enqueueSyncEvent, reconcileSyncEventsIfCurrent, getPendingEvents, type SyncEvent } from "@/lib/idb-queue";
import { buildIncomeExpensePayload } from "./build-income-expense-payload";
import { confirmedIncomeExpenseBackgroundOutcome, isIncomeExpenseBackgroundCommand } from "./background-command";
import { completeIncomeExpenseBackground, incomeExpenseOwnerWork } from "./background-idb";
import { isRetryableSyncResponse } from "@/lib/sync-response";
import { createScopedSingleFlight } from "@/lib/scoped-single-flight";
import { incomeExpenseOperationalQueryKeys } from "./query-keys";
import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";

const endpoint = "/api/lanflow/income-expense/background";
const flight = createScopedSingleFlight();
type TimedEvent = SyncEvent & { nextAttemptAt?: number; attempts?: number };

export async function acceptIncomeExpenseBackground(
  transaction: IncomeExpense, operation: "update" | "delete", ownerUserId: string,
  deletedBy?: { name: string; phone: string },
) {
  if (!navigator.onLine) throw new Error("ต้องออนไลน์เพื่อตรวจสถานะรายการก่อน");
  const response = await authFetch(`${endpoint}?${new URLSearchParams({ serverId: transaction.id, locationId: transaction.locationId })}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const context = await response.json();
  if (!response.ok || context.actorUserId !== ownerUserId || context.serverId !== transaction.id
    || context.clientTempId !== transaction.clientTempId || context.locationId !== transaction.locationId
    || context.billOption !== transaction.billOption) throw new Error("ยังตรวจสถานะรายการล่าสุดไม่ได้");
  if (context.recordStatus !== "active") throw new Error("รายการนี้ถูกลบแล้ว กรุณาโหลดข้อมูลล่าสุด");
  if (context.approvalPending) throw new Error("รายการนี้กำลังรออนุมัติการเปลี่ยนแปลง");
  if (context.revisionNo !== transaction.revisionNo) throw new Error("รายการเปลี่ยนแล้ว กรุณาเปิดข้อมูลล่าสุดก่อนแก้ไข");
  const events = await getPendingEvents({ entity: "income_expense", ownerUserId, locationId: transaction.locationId });
  if (events.some((event) => event.id === transaction.clientTempId)) throw new Error("รายการนี้มีงานค้าง กรุณารอยืนยันผล");
  const payload = { ...buildIncomeExpensePayload(transaction, operation, deletedBy), contractVersion: 2,
    background: true, commandId: crypto.randomUUID(), actorUserId: ownerUserId, expectedServerId: transaction.id };
  const queued = await enqueueSyncEvent({ entity: "income_expense", ownerUserId,
    locationId: transaction.locationId, id: transaction.clientTempId, operation,
    serverId: transaction.id, serverBillNo: transaction.serverBillNo, payload, status: "pending", timestamp: Date.now() }, []);
  if (queued === null) throw new Error("คิวเปลี่ยนจากอีกแท็บ กรุณาตรวจสถานะรายการ");
}

export async function runIncomeExpenseBackground(queryClient: QueryClient, ownerUserId: string, retryId?: string) {
  return flight(ownerUserId, async () => {
    if (!navigator.onLine || !ownerUserId) return;
    const events = ((await incomeExpenseOwnerWork(ownerUserId)).filter(isIncomeExpenseBackgroundCommand) as TimedEvent[])
      .filter((event) => event.id === retryId || (event.nextAttemptAt ?? 0) <= Date.now())
      .sort((a, b) => Number(b.id === retryId) - Number(a.id === retryId)
        || (a.nextAttemptAt ?? 0) - (b.nextAttemptAt ?? 0));
    const changed = new Set<string>();
    const completedBranches = new Set<string>();
    // One bounded owner round, not one timer or session request for every accessible branch.
    for (const snapshot of events.slice(0, 20)) {
      if (!navigator.onLine) break;
      if (snapshot.id !== retryId && (snapshot.nextAttemptAt ?? 0) > Date.now()) continue;
      if (!await canSyncCurrentSession(ownerUserId, snapshot.locationId, { background: true })) {
        if (!await canSyncCurrentSession(ownerUserId, undefined, { background: true })) break;
        await reconcileSyncEventsIfCurrent([snapshot], { ...snapshot, nextAttemptAt: Date.now() + 120_000 } as TimedEvent);
        continue;
      }
      if (snapshot.status !== "pending" && snapshot.id !== retryId) {
        // A failed business command is not repeatedly submitted. Only a positive
        // changed/deleted context warrants asking the server to resolve its receipt.
        try {
          const probe = await authFetch(`${endpoint}?${new URLSearchParams({ serverId: snapshot.serverId!, locationId: snapshot.locationId })}`,
            { cache: "no-store", signal: AbortSignal.timeout(8_000) }, { background: true });
          const context = await probe.json();
          if (!probe.ok || context.actorUserId !== ownerUserId || context.serverId !== snapshot.serverId
            || context.clientTempId !== snapshot.id || context.locationId !== snapshot.locationId
            || (context.recordStatus !== "deleted" && !(context.recordStatus === "active"
              && Number.isSafeInteger(context.revisionNo) && context.revisionNo > snapshot.payload.expectedRevisionNo))) {
            await reconcileSyncEventsIfCurrent([snapshot], { ...snapshot, nextAttemptAt: Date.now() + 120_000 } as TimedEvent);
            continue;
          }
        } catch {
          await reconcileSyncEventsIfCurrent([snapshot], { ...snapshot, nextAttemptAt: Date.now() + 120_000 } as TimedEvent);
          continue;
        }
      }
      const event = { ...snapshot, serverSubmissionAttempted: true };
      if (!await reconcileSyncEventsIfCurrent([snapshot], event)) continue;
      try {
        const response = await authFetch(endpoint, { method: "POST", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(event.payload) }, { background: true });
        const data = await response.json();
        const outcome = confirmedIncomeExpenseBackgroundOutcome(event, data);
        if (response.ok && outcome) {
          const message = outcome === "revision_conflict" ? "รายการเปลี่ยนแล้ว ยกเลิกการแก้ไข/ลบที่ค้างไว้ กรุณาตรวจข้อมูลล่าสุด"
            : outcome === "rejected" ? "คำขอไม่ได้รับอนุมัติ" : undefined;
          if (await completeIncomeExpenseBackground(event, message)) {
            changed.add(event.locationId);
            completedBranches.add(event.locationId);
          }
          continue;
        }
        const retryable = response.ok || response.status === 403 || data.errorCode === "ACTOR_CHANGED" || isRetryableSyncResponse(response.status, data);
        const attempts = (event.attempts ?? 0) + 1;
        const failed: TimedEvent = { ...event, status: retryable ? "pending" : "failed",
          serverSubmissionAttempted: retryable,
          errorMessage: retryable ? undefined : data.errorMessage ?? "บันทึกไม่สำเร็จ กรุณาตรวจรายการ",
          failureHttpStatus: response.status, attempts, nextAttemptAt: Date.now() + Math.min(120_000, 5_000 * 2 ** Math.min(attempts, 5)) };
        if (await reconcileSyncEventsIfCurrent([event], failed)) changed.add(event.locationId);
        if (response.status === 401 || data.errorCode === "ACTOR_CHANGED") break;
        if (response.status === 403 && !await canSyncCurrentSession(ownerUserId, undefined, { background: true })) break;
      } catch {
        const attempts = (event.attempts ?? 0) + 1;
        await reconcileSyncEventsIfCurrent([event], { ...event, attempts, nextAttemptAt: Date.now() + Math.min(120_000, 5_000 * 2 ** Math.min(attempts, 5)) } as TimedEvent);
      }
    }
    for (const locationId of changed) {
      await queryClient.invalidateQueries({ queryKey: incomeExpenseOperationalQueryKeys.pending(ownerUserId, locationId) });
      await queryClient.invalidateQueries({ queryKey: ["incomeExpenseBackgroundNotices", ownerUserId, locationId] });
      await queryClient.invalidateQueries({ queryKey: ["incomeExpenseFeed", ownerUserId, locationId] });
    }
    for (const locationId of completedBranches) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.dashboardSnapshot(locationId) }),
        queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.dashboardMoneyHistory(locationId) }),
      ]);
    }
    if (completedBranches.size) await Promise.all([
      queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.actionableBadges() }),
      queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.dashboardBranchSummaries() }),
    ]);
  });
}
