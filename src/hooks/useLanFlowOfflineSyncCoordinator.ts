import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { isDeviceOnline, subscribeConnectivity } from "@/lib/connectivity";
import { syncPendingIncomeExpense } from "@/hooks/useIncomeExpense";
import { syncPendingRubberBills } from "@/hooks/useRubberBills";
import { getPendingEvents } from "@/lib/idb-queue";

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
    const retryTimers: ReturnType<typeof setTimeout>[] = [];

    const syncCurrentScope = () => {
      if (!isDeviceOnline()) return;
      void Promise.allSettled([
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
      const syncTasks: Promise<unknown>[] = [];

      if (rubberEvents.some((event) => event.status === "pending")) {
        syncTasks.push(syncPendingRubberBills(queryClient, ownerUserId, locationId));
      }
      if (incomeExpenseEvents.some((event) => event.status === "pending")) {
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
      syncCurrentScope();
      // Browsers can publish `online` before the first request is routable.
      // Keep retries bounded; queue idempotency and scoped single-flight make
      // them safe if the immediate attempt already succeeded.
      for (const delay of [750, 2_500]) {
        retryTimers.push(setTimeout(syncCurrentScope, delay));
      }
    };

    const unsubscribe = subscribeConnectivity(handleConnectivityChange);
    const retryInterval = setInterval(() => {
      void syncPendingCurrentScope();
    }, PENDING_SYNC_RETRY_INTERVAL_MS);
    handleConnectivityChange();
    return () => {
      clearInterval(retryInterval);
      clearRetryTimers();
      unsubscribe();
    };
  }, [locationId, ownerUserId, queryClient]);
}
