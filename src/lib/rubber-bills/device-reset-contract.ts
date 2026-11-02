import { isIsoTimestamp, isUuid } from "@/lib/validation/primitives";

export const DEVICE_RESET_CONFIRMATION = "รีเซ็ตทั้งหมด";
export const DEVICE_RESET_MODE = "clear_registry_v1";
export type DeviceResetPreview = { mode: typeof DEVICE_RESET_MODE; count: number; snapshot: string };
export type DeviceResetRequest = { mode: typeof DEVICE_RESET_MODE; requestId: string; snapshot: string; confirmation: string };
export type DeviceResetReceipt = { mode: typeof DEVICE_RESET_MODE; requestId: string; snapshot: string; retiredCount: number; completedAt: string };
const snapshot = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export function isDeviceResetPreview(value: unknown): value is DeviceResetPreview {
  if (!value || typeof value !== "object") return false;
  const v = value as DeviceResetPreview;
  return v.mode === DEVICE_RESET_MODE && count(v.count) && snapshot(v.snapshot);
}
export function isDeviceResetRequest(value: unknown): value is DeviceResetRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as DeviceResetRequest;
  return v.mode === DEVICE_RESET_MODE && isUuid(v.requestId) && snapshot(v.snapshot) && v.confirmation === DEVICE_RESET_CONFIRMATION;
}
export function isDeviceResetReceipt(value: unknown): value is DeviceResetReceipt {
  if (!value || typeof value !== "object") return false;
  const v = value as DeviceResetReceipt;
  return v.mode === DEVICE_RESET_MODE && isUuid(v.requestId) && snapshot(v.snapshot) && count(v.retiredCount) && v.retiredCount > 0
    && isIsoTimestamp(v.completedAt);
}
