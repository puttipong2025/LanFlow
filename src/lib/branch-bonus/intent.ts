import type { BonusSettings } from "@/types/branch-bonus";
import { isUuid } from "@/lib/validation/primitives";
import { parseBonusSettings } from "./input";

export type BonusIntent = { id: string; locationId: string; ownerId: string; input: BonusSettings; expected: string; finalAmount: number | null };
const key = (owner: string, location: string) => `lanflow:bonus-intent:${owner}:${location}`;
export function readBonusIntent(owner: string, location: string): BonusIntent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(owner, location));
    if (!raw) return null;
    const value = JSON.parse(raw) as BonusIntent;
    return value.ownerId === owner && value.locationId === location && isUuid(value.id)
      && parseBonusSettings(value.input) && /^[a-f0-9]{32}$/.test(value.expected)
      && (value.finalAmount === null || (typeof value.finalAmount === "number" && Number.isFinite(value.finalAmount))) ? value : null;
  } catch { return null; }
}
export function persistBonusIntent(value: BonusIntent) {
  // Never send a financially meaningful write without a recoverable retry identity.
  window.localStorage.setItem(key(value.ownerId, value.locationId), JSON.stringify(value));
}
export function clearBonusIntent(owner: string, location: string) {
  window.localStorage.removeItem(key(owner, location));
}
