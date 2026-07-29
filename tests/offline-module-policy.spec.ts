import { expect, test } from "@playwright/test";
import {
  getOfflineTabBlockMessage,
  isTabBlockedOffline,
  OFFLINE_FALLBACK_TAB,
} from "../src/lib/offline-module-policy";

test("blocks every online-only navigation tab and falls back to Rubber Bills", () => {
  expect(OFFLINE_FALLBACK_TAB).toBe("rubber");

  for (const tab of [
    "dashboard",
    "acid-stock",
    "customers",
    "transport",
    "money-transfer",
    "ocr",
    "time-tracking",
    "rubber-export",
    "reports",
    "admin",
  ] as const) {
    expect(getOfflineTabBlockMessage(tab)).toBeTruthy();
    expect(isTabBlockedOffline(tab, false)).toBe(true);
    expect(isTabBlockedOffline(tab, true)).toBe(false);
  }

  for (const tab of ["rubber", "cash"] as const) {
    expect(getOfflineTabBlockMessage(tab)).toBeNull();
    expect(isTabBlockedOffline(tab, false)).toBe(false);
  }
});
