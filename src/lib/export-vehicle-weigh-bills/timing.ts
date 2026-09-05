const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1_000;
const INITIAL_TRUCK_INBOUND_LOOKBACK_MS = 2 * 60 * 60 * 1_000;
const DATE_TIME_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function bangkokDateTimeInput(value = new Date(), includeSeconds = false) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const minuteValue = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  return includeSeconds ? `${minuteValue}:${part("second")}` : minuteValue;
}

export function bangkokDateTimeInputToMillis(value: string) {
  const match = DATE_TIME_INPUT_PATTERN.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0"] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const wallClock = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    wallClock.getUTCFullYear() !== year
    || wallClock.getUTCMonth() !== month - 1
    || wallClock.getUTCDate() !== day
    || wallClock.getUTCHours() !== hour
    || wallClock.getUTCMinutes() !== minute
    || wallClock.getUTCSeconds() !== second
  ) return null;
  return wallClock.getTime() - BANGKOK_OFFSET_MS;
}

export function bangkokDateTimeInputToIso(value: string) {
  const millis = bangkokDateTimeInputToMillis(value);
  return millis === null ? null : new Date(millis).toISOString();
}

export function initialWexTruckInboundAt(value = new Date()) {
  return bangkokDateTimeInput(new Date(value.getTime() - INITIAL_TRUCK_INBOUND_LOOKBACK_MS));
}

export function currentBangkokDateTimeAfter(previousValues: string[], now = new Date()) {
  const candidate = bangkokDateTimeInput(now, true);
  const candidateMillis = bangkokDateTimeInputToMillis(candidate);
  if (candidateMillis === null) return "";
  const previousMillis = previousValues.map(bangkokDateTimeInputToMillis);
  return previousMillis.every((value) => value !== null && candidateMillis > value)
    ? candidate
    : "";
}

export function currentBangkokDateTimeNotBefore(previousValue: string, now = new Date()) {
  const candidate = bangkokDateTimeInput(now, true);
  const candidateMillis = bangkokDateTimeInputToMillis(candidate);
  const previousMillis = bangkokDateTimeInputToMillis(previousValue);
  if (candidateMillis === null || previousMillis === null || candidateMillis < previousMillis) return "";
  return candidate;
}
