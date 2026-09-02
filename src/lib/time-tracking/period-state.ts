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
  const previous = latest
    ? started.find((period) => (
        period.id !== latest.id
        && period.start_on < latest.start_on
        && period.end_on !== null
        && period.end_on < latest.start_on
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
  const correctionLatestOn = latest
    ? latestStillEffective ? today : latest.end_on
    : null;
  const canMoveEarlier = latest && (correctionEarliestOn === null || correctionEarliestOn < latest.start_on);
  const canMoveLater = latest && correctionLatestOn && latest.start_on < correctionLatestOn;
  const periodStartCorrection = latest
    && correctionLatestOn
    && (canMoveEarlier || canMoveLater)
      ? {
          periodId: latest.id,
          currentStartOn: latest.start_on,
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
