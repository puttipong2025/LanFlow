"use client";

import { useQuery } from "@tanstack/react-query";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { millisecondsUntilNextActionableBadgeRefresh } from "@/lib/time-tracking/payroll-cutoff-refresh";
import type { Tab } from "@/components/lanflow/tabs";

export const ACTIONABLE_BADGES_QUERY_KEY = "actionableBadges";

export type ModuleBadgeCounts = Partial<Record<Tab, number>>;
export type ActionableBadgeCounts = Record<string, ModuleBadgeCounts>;

type BadgeCountRow = {
  location_id: string;
  module_id: Tab;
  item_count: number;
};

type PayrollSettings = {
  workdayEndTime?: string;
  pendingEffectiveDate?: string | null;
};

export function useActionableBadges(enabled: boolean) {
  const query = useQuery({
    queryKey: [ACTIONABLE_BADGES_QUERY_KEY],
    enabled,
    queryFn: async () => {
      const supabase = createSupabaseBrowserClient();
      const [badgesResult, settingsResult] = await Promise.all([
        supabase.rpc("get_actionable_badge_counts"),
        supabase.rpc("get_time_payroll_settings"),
      ]);
      if (badgesResult.error) throw new Error(badgesResult.error.message);

      const counts: ActionableBadgeCounts = {};
      for (const row of (badgesResult.data ?? []) as BadgeCountRow[]) {
        counts[row.location_id] ??= {};
        counts[row.location_id][row.module_id] = Number(row.item_count ?? 0);
      }
      return {
        counts,
        payrollSettings: settingsResult.error ? null : settingsResult.data as PayrollSettings,
      };
    },
    staleTime: 30_000,
    refetchInterval: (query) => millisecondsUntilNextActionableBadgeRefresh(
      new Date(),
      query.state.data?.payrollSettings?.workdayEndTime,
      query.state.data?.payrollSettings?.pendingEffectiveDate,
    ),
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });

  return {
    counts: query.isError ? {} : query.data?.counts ?? {},
  };
}
