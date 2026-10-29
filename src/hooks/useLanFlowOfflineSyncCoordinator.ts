import { registerRubberBackgroundNotifications } from "@/lib/rubber-bills/background-notifications";
import { toast } from "sonner";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { isDeviceOnline, subscribeConnectivity } from "@/lib/connectivity";
import { syncPendingIncomeExpense } from "@/hooks/useIncomeExpense";
import { syncPendingRubberBills } from "@/hooks/useRubberBills";
import { getPendingEvents } from "@/lib/idb-queue";
import { runIncomeExpenseBackground } from "@/lib/income-expense/background-sync";
import { isIncomeExpenseBackgroundCommand } from "@/lib/income-expense/background-command";
import { rubberOwnerWork, runRubberCentralQueue, subscribeRubberQueueActivity } from "@/lib/rubber-bills/central-sync";

const PENDING_SYNC_RETRY_INTERVAL_MS = 30_000;

export function useLanFlowOfflineSyncCoordinator({
  ownerUserId,
  locationId,
}: {
  ownerUserId: string;
  locationId: string;
}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!ownerUserId || !locationId) return;
    const stopNotifications = registerRubberBackgroundNotifications(ownerUserId, locationId,
      (message, kind) => kind === "success" ? toast.success(message) : toast.error(message));
    const retryTimers: ReturnType<typeof setTimeout>[] = [];

    const syncCurrentScope = (forceReceiptCheck = false) => {
      if (disposed || !isDeviceOnline()) return;
      void Promise.allSettled([
        runIncomeExpenseBackground(queryClient, ownerUserId),
        runRubberCentralQueue(queryClient, ownerUserId, forceReceiptCheck),
        syncPendingRubberBills(queryClient, ownerUserId, locationId),
        syncPendingIncomeExpense(queryClient, ownerUserId, locationId),
      ]);
    };

    const syncPendingCurrentScope = async () => {
      if (!isDeviceOnline()) return;

      const [rubberEvents, incomeExpenseEvents] = await Promise.all([
        getPendingEvents({ entity: "rubber_bills", ownerUserId, locationId }).catch(() => []),
        getPendingEvents({ entity: "income_expense", ownerUserId, locationId }).catch(() => []),
      ]);
      if (disposed) return;
      const syncTasks: Promise<unknown>[] = [];
      syncTasks.push(runIncomeExpenseBackground(queryClient, ownerUserId));
      syncTasks.push(runRubberCentralQueue(queryClient, ownerUserId));

      if (rubberEvents.some((event) => event.payload.background || event.status === "pending" || event.status === "conflict" || event.failureHttpStatus === undefined)) {
        syncTasks.push(syncPendingRubberBills(queryClient, ownerUserId, locationId));
      }
      if (incomeExpenseEvents.some((event) => !isIncomeExpenseBackgroundCommand(event) && event.status === "pending")) {
        syncTasks.push(syncPendingIncomeExpense(queryClient, ownerUserId, locationId));
      }
      await Promise.allSettled(syncTasks);
    };

    const clearRetryTimers = () => {
      for (const timer of retryTimers.splice(0)) clearTimeout(timer);
    };
    const handleConnectivityChange = () => {
      clearRetryTimers();
      if (!isDeviceOnline()) return;
      syncCurrentScope(true);
      // Browsers can publish `online` before the first request is routable.
      // Keep retries bounded; queue idempotency and scoped single-flight make
      // them safe if the immediate attempt already succeeded.
      for (const delay of [750, 2_500]) {
        retryTimers.push(setTimeout(() => syncCurrentScope(), delay));
      }
    };

    const unsubscribe = subscribeConnectivity(handleConnectivityChange);
    const handleCashCountUnlocked = () => syncCurrentScope(true);
    window.addEventListener("lanflow:cash-count-unlocked", handleCashCountUnlocked);
    const retryInterval = setInterval(() => {
      void syncPendingCurrentScope();
    }, PENDING_SYNC_RETRY_INTERVAL_MS);
    let checking = false;
    let checkRequested = false;
    let disposed = false;
    let activeTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleActiveCheck = (delay = 2_000) => {
      if (disposed) return;
      if (checking) { checkRequested = true; return; }
      if (activeTimer !== undefined) return;
      activeTimer = setTimeout(checkActiveWork, delay);
    };
    const checkActiveWork = async () => {
      activeTimer = undefined;
      if (disposed || checking || !isDeviceOnline()) return;
      checking = true;
      checkRequested = false;
      let delay: number | undefined;
      try {
        const events = await rubberOwnerWork(ownerUserId);
        const pending = events.filter(event => event.status === "pending");
        if (pending.length) delay = Math.max(2_000, Math.min(30_000,
          Math.min(...pending.map(event => event.nextAttemptAt ?? 0)) - Date.now()));
        if (!disposed && pending.some(event => (event.nextAttemptAt ?? 0) <= Date.now())) {
          await runRubberCentralQueue(queryClient, ownerUserId);
        }
      } catch { /* The recovery interval retries local queue read failures. */ }
      finally {
        checking = false;
        if (delay !== undefined || checkRequested) scheduleActiveCheck(delay);
      }
    };
    const stopActivity = subscribeRubberQueueActivity(ownerUserId, scheduleActiveCheck);
    handleConnectivityChange();
    return () => {
      disposed = true;
      stopNotifications();
      clearInterval(retryInterval);
      stopActivity();
      if (activeTimer !== undefined) clearTimeout(activeTimer);
      clearRetryTimers();
      unsubscribe();
      window.removeEventListener("lanflow:cash-count-unlocked", handleCashCountUnlocked);
    };
  }, [locationId, ownerUserId, queryClient]);
}
