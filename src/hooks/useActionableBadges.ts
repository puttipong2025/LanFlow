"use client";

import { useQuery } from "@tanstack/react-query";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { millisecondsUntilNextActionableBadgeRefresh } from "@/lib/time-tracking/payroll-cutoff-refresh";
import { parseActionableBadgeCounts } from "@/lib/actionable-badge-counts";

export const ACTIONABLE_BADGES_QUERY_KEY = "actionableBadges";

export type { ModuleBadgeCounts, ActionableBadgeCounts } from "@/lib/actionable-badge-counts";

type PayrollSettings = {
  workdayEndTime?: string;
  pendingEffectiveDate?: string | null;
};

export function useActionableBadges(ownerUserId: string, enabled: boolean, poll = true) {
  const query = useQuery({
    queryKey: [ACTIONABLE_BADGES_QUERY_KEY, ownerUserId],
    enabled: Boolean(ownerUserId) && enabled,
    queryFn: async ({ signal }) => {
      if (!ownerUserId) throw new Error("ไม่พบบัญชีสำหรับตรวจจำนวนงาน");
      const supabase = createSupabaseBrowserClient();
      // Auth can switch sessions before the profile state catches up.
      const assertOwner = async () => {
        if (signal.aborted) throw signal.reason;
        const { data, error } = await supabase.auth.getSession();
        if (error || data.session?.user.id !== ownerUserId) throw new Error("บัญชีเปลี่ยนแล้ว กรุณาโหลดจำนวนงานใหม่");
        if (signal.aborted) throw signal.reason;
      };
      await assertOwner();
      const [badgesResult, settingsResult] = await Promise.all([
        supabase.rpc("get_actionable_badge_counts").abortSignal(signal),
        supabase.rpc("get_time_payroll_settings").abortSignal(signal),
      ]);
      await assertOwner();
      if (badgesResult.error) throw new Error(badgesResult.error.message);

      return {
        counts: parseActionableBadgeCounts(badgesResult.data),
        payrollSettings: settingsResult.error ? null : settingsResult.data as PayrollSettings,
      };
    },
    staleTime: 30_000,
    refetchInterval: (query) => !poll ? false : millisecondsUntilNextActionableBadgeRefresh(
      new Date(),
      query.state.data?.payrollSettings?.workdayEndTime,
      query.state.data?.payrollSettings?.pendingEffectiveDate,
    ),
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });

  return {
    counts: query.isError ? {} : query.data?.counts ?? {},
    error: query.isError,
    refresh: query.refetch,
  };
}
