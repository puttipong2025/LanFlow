"use client";

import { useQuery } from "@tanstack/react-query";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import type { OperatorMoneyHistory } from "@/lib/operator-money-history";

export type OperatorHistoryFilters = {
  actor: string;
  locationId: string;
  route: string;
  date: string;
  action: string;
  cursor: string;
};

export function useOperatorMoneyHistory(ownerScope: string, online: boolean, filters: OperatorHistoryFilters) {
  return useQuery({
    queryKey: ["operatorMoneyHistory", ownerScope, filters],
    enabled: online,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value && value !== "all") params.set(key, value);
      }
      const response = await authFetch(`/api/lanflow/dashboard/operator-history?${params}`, {
        cache: "no-store", signal,
      });
      await assertApiResponse(response);
      return response.json() as Promise<OperatorMoneyHistory>;
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  });
}
