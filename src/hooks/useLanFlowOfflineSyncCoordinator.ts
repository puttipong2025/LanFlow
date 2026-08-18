import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { isDeviceOnline, subscribeConnectivity } from "@/lib/connectivity";
import { syncPendingIncomeExpense } from "@/hooks/useIncomeExpense";
import { syncPendingRubberBills } from "@/hooks/useRubberBills";

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
    handleConnectivityChange();
    return () => {
      clearRetryTimers();
      unsubscribe();
    };
  }, [locationId, ownerUserId, queryClient]);
}
