"use client";

import { useQuery } from "@tanstack/react-query";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Tab } from "@/components/lanflow/tabs";

export const ACTIONABLE_BADGES_QUERY_KEY = "actionableBadges";

export type ModuleBadgeCounts = Partial<Record<Tab, number>>;
export type ActionableBadgeCounts = Record<string, ModuleBadgeCounts>;

type BadgeCountRow = {
  location_id: string;
  module_id: Tab;
  item_count: number;
};

export function useActionableBadges(enabled: boolean) {
  const query = useQuery({
    queryKey: [ACTIONABLE_BADGES_QUERY_KEY],
    enabled,
    queryFn: async (): Promise<ActionableBadgeCounts> => {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("get_actionable_badge_counts");
      if (error) throw new Error(error.message);

      const counts: ActionableBadgeCounts = {};
      for (const row of (data ?? []) as BadgeCountRow[]) {
        counts[row.location_id] ??= {};
        counts[row.location_id][row.module_id] = Number(row.item_count ?? 0);
      }
      return counts;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  return {
    counts: query.data ?? {},
    isLoading: query.isLoading,
  };
}
