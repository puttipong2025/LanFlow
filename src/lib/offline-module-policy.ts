import type { Tab } from "@/components/lanflow/tabs";

const OFFLINE_BLOCKED_TABS: Partial<Record<Tab, string>> = {
  dashboard: "ภาพรวมใช้ได้เมื่อออนไลน์เท่านั้น",
  "acid-stock": "สต็อกสินค้าใช้ได้เมื่อออนไลน์เท่านั้น",
  customers: "ลูกค้าใช้ได้เมื่อออนไลน์เท่านั้น",
  transport: "ขนส่งและพนักงานใช้ได้เมื่อออนไลน์เท่านั้น",
  "money-transfer": "โมดูลโอนเงินใช้ได้เมื่อออนไลน์เท่านั้น",
  ocr: "อ่านใบชั่งและ OCR ใช้ได้เมื่อออนไลน์เท่านั้น",
  "time-tracking": "เวลาและเงินเดือนใช้ได้เมื่อออนไลน์เท่านั้น",
  "rubber-export": "ส่งออกยางใช้ได้เมื่อออนไลน์เท่านั้น",
  reports: "รายงานใช้ได้เมื่อออนไลน์เท่านั้น",
  admin: "ตั้งค่าระบบใช้ได้เมื่อออนไลน์เท่านั้น",
};

export const OFFLINE_FALLBACK_TAB: Tab = "rubber";

export function getOfflineTabBlockMessage(tab: Tab) {
  return OFFLINE_BLOCKED_TABS[tab] ?? null;
}

export function isTabBlockedOffline(tab: Tab, online: boolean) {
  return !online && Boolean(getOfflineTabBlockMessage(tab));
}
