const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1_000;
const INITIAL_TRUCK_INBOUND_LOOKBACK_MS = 2 * 60 * 60 * 1_000;
const DATE_TIME_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function bangkokDateTimeInput(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
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

export function addRandomMinutes(
  baseValue: string,
  minMinutes: number,
  maxMinutes: number,
  rng: () => number = Math.random,
) {
  const baseMillis = bangkokDateTimeInputToMillis(baseValue);
  if (
    baseMillis === null
    || !Number.isInteger(minMinutes)
    || !Number.isInteger(maxMinutes)
    || minMinutes > maxMinutes
  ) return "";
  const randomValue = rng();
  if (
    !Number.isFinite(randomValue)
    || randomValue < 0
    || randomValue >= 1
  ) return "";
  const minutes = Math.floor(randomValue * (maxMinutes - minMinutes + 1)) + minMinutes;
  return bangkokDateTimeInput(new Date(baseMillis + (minutes * 60_000)));
}
