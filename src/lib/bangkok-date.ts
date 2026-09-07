export const BANGKOK_TIME_ZONE = "Asia/Bangkok";
const BANGKOK_OFFSET_MINUTES = 7 * 60;

type DateValue = Date | string | number;

function toDate(value: DateValue) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid date value");
  return date;
}

export function bangkokDateString(value = new Date()) {
  return value.toLocaleDateString("sv-SE", { timeZone: BANGKOK_TIME_ZONE });
}

export function bangkokDateTimeLocalValue(value: DateValue) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BANGKOK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(toDate(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function bangkokWallClockToUtcIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) throw new RangeError("Invalid Bangkok wall-clock value");

  const [, year, month, day, hour, minute, second = "0", millisecond = "0"] = match;
  const utcMilliseconds = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond.padEnd(3, "0")),
  ) - BANGKOK_OFFSET_MINUTES * 60_000;
  const result = new Date(utcMilliseconds);
  if (bangkokDateTimeLocalValue(result) !== `${year}-${month}-${day}T${hour}:${minute}`) {
    throw new RangeError("Invalid Bangkok wall-clock value");
  }
  return result.toISOString();
}

export function normalizeBangkokDateTime(value: string | null | undefined) {
  if (!value) return null;
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? toDate(value).toISOString()
    : bangkokWallClockToUtcIso(value);
}

export function formatBangkokDateTime(value: DateValue) {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: BANGKOK_TIME_ZONE,
    dateStyle: "short",
    timeStyle: "short",
    hourCycle: "h23",
  }).format(toDate(value));
}

export function bangkokBuddhistYear(value = new Date()) {
  return Number(bangkokDateString(value).slice(0, 4)) + 543;
}
