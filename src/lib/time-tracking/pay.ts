const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WORKDAY_MS = 8 * 60 * 60 * 1000;
const CUTOFF_MS = 15 * 60 * 60 * 1000;

export type PaidWorkSegment = {
  start_time: string;
  end_time: string | null;
};

export function calculateTimeSegmentPaidDays(segment: PaidWorkSegment): number {
  if (!segment.end_time) return 0;

  const startMs = new Date(segment.start_time).getTime();
  const endMs = new Date(segment.end_time).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }

  const durationDays = (endMs - startMs) / WORKDAY_MS;
  const startBangkokMs = startMs + BANGKOK_OFFSET_MS;
  const endBangkokMs = endMs + BANGKOK_OFFSET_MS;
  let cutoffBangkokMs = Math.floor(startBangkokMs / DAY_MS) * DAY_MS + CUTOFF_MS;

  if (cutoffBangkokMs <= startBangkokMs) {
    cutoffBangkokMs += DAY_MS;
  }

  let cutoffDays = 0;
  while (cutoffBangkokMs <= endBangkokMs) {
    cutoffDays += 1;
    cutoffBangkokMs += DAY_MS;
  }

  return cutoffDays > 0 ? cutoffDays : durationDays;
}

type ExceptionAttendanceInput = {
  month: string;
  workdayEndTime: string;
  periods: Array<{ startOn: string; endOn: string | null }>;
  exceptions: Array<{ date: string; status: "HALF_DAY" | "OFF" }>;
  dailyWage: number;
  now: Date;
};

type ExceptionAttendanceSummary = {
  fullDays: number;
  halfDays: number;
  offDays: number;
  paidDays: number;
  grossPay: number;
};

function bangkokNowParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

export function calculateExceptionAttendance(
  input: ExceptionAttendanceInput,
): ExceptionAttendanceSummary {
  const [year, monthNumber] = input.month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const now = bangkokNowParts(input.now);
  const exceptions = new Map(input.exceptions.map((item) => [item.date, item.status]));
  const isActive = (date: string) => input.periods.some((period) =>
    period.startOn <= date && (period.endOn == null || date <= period.endOn));

  let fullDays = 0;
  let halfDays = 0;
  let offDays = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${input.month}-${String(day).padStart(2, "0")}`;
    if (!isActive(date)) continue;
    if (date > now.date || (date === now.date && now.time < input.workdayEndTime)) continue;

    const status = exceptions.get(date);
    if (status === "HALF_DAY") halfDays += 1;
    else if (status === "OFF") offDays += 1;
    else fullDays += 1;
  }

  const paidDays = fullDays + (halfDays * 0.5);
  return {
    fullDays,
    halfDays,
    offDays,
    paidDays,
    grossPay: Math.trunc(paidDays * input.dailyWage * 100) / 100,
  };
}
