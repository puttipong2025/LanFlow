import type { DashboardSummary } from "../../src/types/dashboard";

/** Complete read-model fixture: partial snapshots break other live dashboard readers. */
export function dashboardSummaryFixture(netCashFlow: number): DashboardSummary {
  const rubber = {
    billCount: 0, netWeight: 0, averagePrice: null, rubberValue: 0,
    deductionTotal: 0, unpricedBillCount: 0, pendingApprovalCount: 0,
  };
  return {
    purchaseToday: { ...rubber, paidTotal: 0 },
    rubberRemaining: { ...rubber },
    purchase7Days: { paidTotal: 0, dailyAverage: 0, netWeight: 0, averageCostPerKg: null },
    cashToday: { income: 0, expense: 0, net: 0 },
    netCashFlow,
    operatingExpenseAccumulated: 0,
    payablePurchaseAccumulated: 0,
    operatingBurdenPercent: null,
    rubberInventoryWeight: 0,
    waterLoss7Days: { exportCount: 0, weight: 0, percent: null },
    stock: { inStockCount: 0, outOfStockCount: 0, items: [] },
  };
}
