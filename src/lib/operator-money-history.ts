import type { DashboardMoneyHistory, DashboardMoneyHistoryRow } from "@/types/dashboard";

export const MONEY_HISTORY_ROUTES = {
  "income-expense": "รับ–จ่าย",
  "money-transfer": "โอนเงิน",
  "time-tracking": "เวลาและเงินเดือน",
  "rubber-bills": "บิลยาง",
  "rubber-export": "ส่งออกยาง",
} as const;

export type MoneyHistoryRoute = keyof typeof MONEY_HISTORY_ROUTES;
export type HistoryFacet = { key: string; name?: string; count: number };
export type OperatorMoneyHistory = Omit<DashboardMoneyHistory, "rows"> & {
  actors: Array<{ key: string; name: string }>;
  locations: HistoryFacet[];
  routes: HistoryFacet[];
  rows: Array<DashboardMoneyHistoryRow & {
    locationId: string;
    locationName: string;
    route: MoneyHistoryRoute;
  }>;
};

export const MONEY_HISTORY_ACTIONS = [
  { key: "all", name: "แสดงทั้งหมด" },
  { key: "create", name: "เพิ่มใหม่" },
  { key: "update", name: "แก้ไข" },
  { key: "delete", name: "ลบ" },
] as const;
