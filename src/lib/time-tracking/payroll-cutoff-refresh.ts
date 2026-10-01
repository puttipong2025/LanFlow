import { bangkokDateString } from "@/lib/bangkok-date";

function cutoffForMonth(year: number, month: number, workdayEndTime: string) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(`${year}-${String(month).padStart(2, "0")}-${lastDay}T${workdayEndTime}:01+07:00`);
}

export function millisecondsUntilNextPayrollCutoff(now: Date, workdayEndTime: string) {
  if (!/^\d{2}:\d{2}$/.test(workdayEndTime)) return null;
  const [year, month] = bangkokDateString(now).split("-").map(Number);
  let target = cutoffForMonth(year, month, workdayEndTime);
  if (target.getTime() <= now.getTime()) {
    const next = new Date(Date.UTC(year, month, 1));
    target = cutoffForMonth(next.getUTCFullYear(), next.getUTCMonth() + 1, workdayEndTime);
  }
  return target.getTime() - now.getTime();
}

export function millisecondsUntilNextPayrollRefresh(
  now: Date,
  workdayEndTime: string,
  endActivationDates: string[],
  pendingCutoffEffectiveDate?: string | null,
) {
  const monthEnd = millisecondsUntilNextPayrollCutoff(now, workdayEndTime);
  const activationDelays = [pendingCutoffEffectiveDate, ...endActivationDates]
    .filter((date): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date))
    .map((date) => new Date(`${date}T00:00:01+07:00`).getTime() - now.getTime())
    .filter((delay) => delay > 0);
  return Math.min(...(monthEnd == null ? activationDelays : [monthEnd, ...activationDelays]));
}

export function millisecondsUntilNextActionableBadgeRefresh(
  now: Date,
  workdayEndTime?: string,
  pendingCutoffEffectiveDate?: string | null,
) {
  if (!workdayEndTime) return 60_000;
  const payrollBoundary = millisecondsUntilNextPayrollRefresh(
    now,
    workdayEndTime,
    [],
    pendingCutoffEffectiveDate,
  );
  return Number.isFinite(payrollBoundary)
    ? Math.min(60_000, Math.max(1, payrollBoundary))
    : 60_000;
}
