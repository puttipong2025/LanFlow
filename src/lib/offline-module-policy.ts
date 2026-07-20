import type { Tab } from "@/components/lanflow/tabs";

const OFFLINE_BLOCKED_TABS: Partial<Record<Tab, string>> = {
  "money-transfer": "โมดูลโอนเงินใช้ได้เมื่อออนไลน์เท่านั้น",
  ocr: "อ่านใบชั่งและ OCR ใช้ได้เมื่อออนไลน์เท่านั้น",
  "time-tracking": "เวลาและเงินเดือนใช้ได้เมื่อออนไลน์เท่านั้น",
  admin: "ตั้งค่าระบบใช้ได้เมื่อออนไลน์เท่านั้น",
};

export function getOfflineTabBlockMessage(tab: Tab) {
  return OFFLINE_BLOCKED_TABS[tab] ?? null;
}

export function isTabBlockedOffline(tab: Tab, online: boolean) {
  return !online && Boolean(getOfflineTabBlockMessage(tab));
}
