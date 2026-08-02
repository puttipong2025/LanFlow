"use client";

import { useQuery } from "@tanstack/react-query";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import type {
  DashboardBranchSummary,
  DashboardMoneyFeed,
  DashboardSnapshot,
} from "@/types/dashboard";

export const DASHBOARD_BRANCH_SUMMARIES_QUERY_KEY = "dashboardBranchSummaries";
export const DASHBOARD_SNAPSHOT_QUERY_KEY = "dashboardSnapshot";
export const DASHBOARD_MONEY_FEED_QUERY_KEY = "dashboardMoneyFeed";

export function useDashboardBranchSummaries(ownerUserId: string, online: boolean) {
  return useQuery({
    queryKey: [DASHBOARD_BRANCH_SUMMARIES_QUERY_KEY, ownerUserId],
    enabled: Boolean(ownerUserId) && online,
    queryFn: async ({ signal }) => {
      const response = await authFetch(
        "/api/lanflow/dashboard/branch-summaries",
        { cache: "no-store", signal },
      );
      await assertApiResponse(response);
      return response.json() as Promise<DashboardBranchSummary[]>;
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnReconnect: "always",
    retry: 1,
  });
}

export function useDashboardSnapshot(
  locationId: string,
  online: boolean,
  requestedVersion: number | null = null,
) {
  return useQuery({
    queryKey: [DASHBOARD_SNAPSHOT_QUERY_KEY, locationId],
    enabled: Boolean(locationId) && online,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ locationId });
      const response = await authFetch(
        `/api/lanflow/dashboard/snapshot?${params}`,
        { cache: "no-store", signal },
      );
      await assertApiResponse(response);
      return response.json() as Promise<DashboardSnapshot>;
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const shouldPoll =
        !data.summary ||
        data.status === "queued" ||
        data.status === "running" ||
        (requestedVersion !== null &&
          data.snapshotVersion < requestedVersion &&
          data.status !== "failed");
      return shouldPoll ? (requestedVersion === null ? 5_000 : 1_000) : false;
    },
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
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ locationId });
      if (cursor) params.set("cursor", cursor);
      const response = await authFetch(
        `/api/lanflow/dashboard/feed?${params}`,
        { cache: "no-store", signal },
      );
      await assertApiResponse(response);
      return response.json() as Promise<DashboardMoneyFeed>;
    },
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === locationId ? previousData : undefined,
    retry: 1,
  });
}
