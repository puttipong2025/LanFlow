import { expect, test } from "@playwright/test";
import { dashboardStatusLabel, dashboardPollInterval } from "@/lib/dashboard-freshness";
import type { DashboardSnapshot, DashboardSummary } from "@/types/dashboard";

const now = Date.parse("2026-09-12T03:00:00Z");
const metrics = { billCount: 0, netWeight: 0, averagePrice: null, rubberValue: 0, deductionTotal: 0, unpricedBillCount: 0, pendingApprovalCount: 0 };
const currentSummary: DashboardSummary = {
  purchaseToday: { ...metrics, paidTotal: 0 },
  rubberRemaining: { ...metrics, branchReceipts: {
    crossBranch: { billCount: 0, netWeight: 0, rubberValue: 0 },
    sameBranch: { billCount: 0, netWeight: 0, rubberValue: 0 },
  } },
  purchase7Days: { paidTotal: 0, dailyAverage: 0, netWeight: 0, averageCostPerKg: null },
  cashToday: { income: 0, expense: 0, net: 0 }, netCashFlow: 0,
  operatingExpenseAccumulated: 0, payablePurchaseAccumulated: 0, operatingBurdenPercent: null,
  rubberInventoryWeight: 0, waterLoss7Days: { exportCount: 0, weight: 0, percent: null },
  stock: { inStockCount: 0, outOfStockCount: 0, items: [] },
};
const snapshot = (overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot => ({
  status: "dirty", sourceVersion: 2, snapshotVersion: 1,
  summary: null, calculatedAt: null, manualRequestedAt: null, lastError: null,
  isOverdue: false, nextCheckAt: new Date(now + 60_000).toISOString(),
  ...overrides,
});

test("uses product labels and gives overdue disclosure priority", () => {
  expect(["dirty", "queued", "running", "failed", "ready"].map((status) =>
    dashboardStatusLabel(status as DashboardSnapshot["status"], false),
  )).toEqual(["ข้อมูลรออัปเดต", "อยู่ในคิวคำนวณ", "กำลังคำนวณ", "อัปเดตไม่สำเร็จ", null]);
  expect(dashboardStatusLabel("failed", true)).toBe("อัปเดตล่าช้า");
  expect(dashboardStatusLabel("ready", true)).toBeNull();
});

test("failed snapshots, even without a summary, wake at next retry instead of stopping or storming", () => {
  expect(dashboardPollInterval(snapshot({ status: "failed" }), null, now)).toBe(60_000);
  expect(dashboardPollInterval(snapshot({ status: "failed", nextCheckAt: new Date(now - 1).toISOString() }), null, now)).toBe(5_000);
});

test("pending manual and queued work remain fast while dirty work follows the server deadline", () => {
  expect(dashboardPollInterval(snapshot(), 2, now)).toBe(1_000);
  expect(dashboardPollInterval(snapshot({ status: "queued" }), null, now)).toBe(5_000);
  expect(dashboardPollInterval(snapshot({ status: "dirty" }), null, now)).toBe(5_000);
  expect(dashboardPollInterval(snapshot({ summary: currentSummary }), null, now)).toBe(60_000);
  expect(dashboardPollInterval(snapshot({ summary: currentSummary, nextCheckAt: new Date(now - 1).toISOString() }), null, now)).toBe(5_000);
  expect(dashboardPollInterval(snapshot({ summary: currentSummary, status: "ready" }), null, now)).toBe(false);
  expect(dashboardPollInterval(snapshot({ status: "failed", nextCheckAt: undefined }), null, now)).toBe(30_000);
  expect(dashboardPollInterval(undefined, null, now)).toBe(false);
});
