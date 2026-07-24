const BANGKOK_TIME_ZONE = "Asia/Bangkok";

export function bangkokDateString(value = new Date()) {
  return value.toLocaleDateString("sv-SE", { timeZone: BANGKOK_TIME_ZONE });
}

export function bangkokDateWindow(dayCount: number, value = new Date()) {
  const to = bangkokDateString(value);
  const fromDate = new Date(`${to}T00:00:00.000Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - (dayCount - 1));
  return { from: fromDate.toISOString().slice(0, 10), to };
}
