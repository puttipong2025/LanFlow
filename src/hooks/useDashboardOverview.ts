"use client";

import { useQuery } from "@tanstack/react-query";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import type {
  DashboardBranchSummary,
  DashboardMoneyHistory,
  DashboardMoneyHistoryAction,
  DashboardSnapshot,
} from "@/types/dashboard";

export const DASHBOARD_BRANCH_SUMMARIES_QUERY_KEY = "dashboardBranchSummaries";
export const DASHBOARD_SNAPSHOT_QUERY_KEY = "dashboardSnapshot";
export const DASHBOARD_MONEY_HISTORY_QUERY_KEY = "dashboardMoneyHistory";

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

export function useDashboardMoneyHistory(
  locationId: string,
  online: boolean,
  eventDate: string | null,
  action: DashboardMoneyHistoryAction,
  cursor: string | null
) {
  return useQuery({
    queryKey: [
      DASHBOARD_MONEY_HISTORY_QUERY_KEY,
      locationId,
      eventDate,
      action,
      cursor,
    ],
    enabled: Boolean(locationId) && online,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ locationId });
      if (eventDate) params.set("date", eventDate);
      if (action !== "all") params.set("action", action);
      if (cursor) params.set("cursor", cursor);
      const response = await authFetch(
        `/api/lanflow/dashboard/feed?${params}`,
        { cache: "no-store", signal },
      );
      await assertApiResponse(response);
      return response.json() as Promise<DashboardMoneyHistory>;
    },
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === locationId &&
      previousQuery?.queryKey[2] === eventDate &&
      previousQuery?.queryKey[3] === action
        ? previousData
        : undefined,
    retry: 1,
  });
}
