"use client";

import { useQuery } from "@tanstack/react-query";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import type {
  DashboardMoneyFeed,
  DashboardSnapshot,
} from "@/types/dashboard";

export const DASHBOARD_SNAPSHOT_QUERY_KEY = "dashboardSnapshot";
export const DASHBOARD_MONEY_FEED_QUERY_KEY = "dashboardMoneyFeed";

export function useDashboardSnapshot(locationId: string, online: boolean) {
  return useQuery({
    queryKey: [DASHBOARD_SNAPSHOT_QUERY_KEY, locationId],
    enabled: Boolean(locationId) && online,
    queryFn: async () => {
      const params = new URLSearchParams({ locationId });
      const response = await authFetch(
        `/api/lanflow/dashboard/snapshot?${params}`,
        { cache: "no-store" },
      );
      await assertApiResponse(response);
      return response.json() as Promise<DashboardSnapshot>;
    },
    refetchInterval: (query) =>
      query.state.data?.status === "queued" ||
      query.state.data?.status === "running"
        ? 5_000
        : false,
    retry: 1,
  });
}

export function useDashboardMoneyFeed(
  locationId: string,
  online: boolean,
  cursor: string | null
) {
  return useQuery({
    queryKey: [DASHBOARD_MONEY_FEED_QUERY_KEY, locationId, cursor],
    enabled: Boolean(locationId) && online,
    queryFn: async () => {
      const params = new URLSearchParams({ locationId });
      if (cursor) params.set("cursor", cursor);
      const response = await authFetch(
        `/api/lanflow/dashboard/feed?${params}`,
        { cache: "no-store" },
      );
      await assertApiResponse(response);
      return response.json() as Promise<DashboardMoneyFeed>;
    },
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === locationId ? previousData : undefined,
    retry: 1,
  });
}
