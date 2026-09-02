import type {
  AttendancePeriodDto,
  PayrollPeriodAction,
  PayrollPeriodStateDto,
} from "@/lib/time-tracking/attendance-contract";

export type PayrollPeriodRow = {
  id: string;
  start_on: string;
  end_on: string | null;
  scheduled_action?: PayrollPeriodAction | null;
  scheduled_effective_on?: string | null;
  scheduled_activation_on?: string | null;
};

function toPeriodDto(period: PayrollPeriodRow): AttendancePeriodDto {
  return {
    id: period.id,
    startOn: period.start_on,
    endOn: period.end_on,
  };
}

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function buildPayrollPeriodState(
  periods: PayrollPeriodRow[],
  today: string,
): PayrollPeriodStateDto {
  const current = periods
    .filter((period) => period.start_on <= today && (
      period.end_on === null
      || (
        (period.scheduled_action === "PAUSE" || period.scheduled_action === "END")
        && Boolean(period.scheduled_activation_on)
        && period.scheduled_activation_on! > today
      )
    ))
    .sort((left, right) => right.start_on.localeCompare(left.start_on))[0];
  const scheduled = periods
    .filter((period) => (
      period.scheduled_action
      && period.scheduled_effective_on
      && period.scheduled_activation_on
      && period.scheduled_activation_on > today
    ))
    .sort((left, right) => left.scheduled_activation_on!.localeCompare(right.scheduled_activation_on!))[0];
  const started = periods
    .filter((period) => period.start_on <= today)
    .sort((left, right) => right.start_on.localeCompare(left.start_on));
  const hasPeriodHistory = started.length > 0;
  const latest = started[0];
  let correctionTarget = latest;
  for (const candidate of started.slice(1)) {
    if (!candidate.end_on || !correctionTarget || nextDate(candidate.end_on) !== correctionTarget.start_on) break;
    correctionTarget = candidate;
  }
  const previous = correctionTarget
    ? started.find((period) => (
        period.start_on < correctionTarget.start_on
        && period.end_on !== null
        && period.end_on < correctionTarget.start_on
      ))
    : undefined;
  const correctionEarliestOn = previous ? nextDate(previous.end_on!) : null;
  const latestStillEffective = latest && (
    latest.end_on === null
    || (
      (latest.scheduled_action === "PAUSE" || latest.scheduled_action === "END")
      && Boolean(latest.scheduled_activation_on)
      && latest.scheduled_activation_on! > today
    )
  );
  const correctionLatestOn = correctionTarget
    ? correctionTarget.id === latest?.id
      ? latestStillEffective ? today : latest.end_on
      : correctionTarget.end_on
    : null;
  const canMoveEarlier = correctionTarget && (correctionEarliestOn === null || correctionEarliestOn < correctionTarget.start_on);
  const canMoveLater = correctionTarget && correctionLatestOn && correctionTarget.start_on < correctionLatestOn;
  const periodStartCorrection = correctionTarget
    && correctionLatestOn
    && (canMoveEarlier || canMoveLater)
      ? {
          periodId: correctionTarget.id,
          currentStartOn: correctionTarget.start_on,
          earliestOn: correctionEarliestOn,
          latestOn: correctionLatestOn,
          endOn: latest.end_on,
        }
      : null;
  const resumeEarliestOn = !current && hasPeriodHistory && latest?.end_on
    ? latest.end_on >= today ? today : nextDate(latest.end_on)
    : null;

  return {
    currentStatus: current ? "ACTIVE" : "INACTIVE",
    currentPeriod: current ? toPeriodDto(current) : null,
    nextAction: scheduled
      ? {
          action: scheduled.scheduled_action!,
          selectedEffectiveOn: scheduled.scheduled_effective_on!,
          activationOn: scheduled.scheduled_activation_on!,
        }
      : null,
    hasPeriodHistory,
    resumeEarliestOn,
    periodStartCorrection,
  };
}
