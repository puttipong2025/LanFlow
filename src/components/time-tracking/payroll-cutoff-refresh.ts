import { useEffect } from "react";
import { millisecondsUntilNextPayrollRefresh } from "@/lib/time-tracking/payroll-cutoff-refresh";

const MAX_TIMEOUT_MS = 2_147_000_000;

export function usePayrollCutoffRefresh(
  refresh: (showLoading?: boolean) => Promise<void>,
  workdayEndTime: string | undefined,
  pendingCutoffEffectiveDate: string | null | undefined,
  users: Array<{ period_state?: { nextAction?: { action?: string; activationOn?: string } | null } }> | undefined,
) {
  const endActivationKey = (users || []).flatMap((user) => (
    user.period_state?.nextAction?.action === "END" && user.period_state.nextAction.activationOn
      ? [user.period_state.nextAction.activationOn]
      : []
  )).sort().join(",");
  useEffect(() => {
    if (!workdayEndTime) return;
    let timer = 0;
    const schedule = () => {
      const remaining = millisecondsUntilNextPayrollRefresh(
        new Date(),
        workdayEndTime,
        endActivationKey ? endActivationKey.split(",") : [],
        pendingCutoffEffectiveDate,
      );
      if (!Number.isFinite(remaining)) return;
      const delay = Math.min(remaining, MAX_TIMEOUT_MS);
      timer = window.setTimeout(() => {
        if (delay < remaining) schedule();
        else {
          void refresh(false);
          schedule();
        }
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [endActivationKey, pendingCutoffEffectiveDate, refresh, workdayEndTime]);
}
