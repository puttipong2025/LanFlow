export function formatCurrency(value: number) {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 0
  }).format(value || 0);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 2
  }).format(value || 0);
}

export function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export function compactDate(value = new Date()) {
  return value.toISOString().slice(2, 10).replace(/-/g, "");
}

export function getDeviceId() {
  if (typeof window === "undefined") return "DEVICE";
  const key = "lanflow:device-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;

  const random = crypto.getRandomValues(new Uint16Array(2)).join("");
  const deviceId = `TAB${random.slice(-4)}`;
  window.localStorage.setItem(key, deviceId);
  return deviceId;
}

export function makeClientTempId(prefix: string) {
  const randomId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.getRandomValues(new Uint32Array(2)).join("");
  return `${prefix}_${compactDate()}_${getDeviceId()}_${randomId}`;
}

export function makeLocalBillNo(locationCode: string, prefix: string, sequence: number) {
  return `TEMP-${locationCode}-${getDeviceId()}-${prefix}${String(sequence).padStart(4, "0")}`;
}

export function makeIdempotencyKey(operation: string, clientTempId: string) {
  return `${operation}:${clientTempId}`;
}

export function makeClientRecordedAt() {
  return new Date().toISOString();
}

export function makeSimulatedServerBillNo(sequence: number) {
  return `${compactDate()}-${String(sequence).padStart(3, "0")}`;
}
