import type { RubberExportDetails } from "@/types/rubber-exports";

export function rubberExportDetails(
  overrides: Partial<RubberExportDetails> = {},
): RubberExportDetails {
  const items = Array.from({ length: 3 }, (_, index) => ({
    id: `export-item-${index + 1}`,
    sourceReportItemId: `report-item-${index + 1}`,
    sourceBillId: `bill-${index + 1}`,
    billDate: "2026-07-29",
    billNo: `RB-${String(index + 1).padStart(3, "0")}`,
    customerName: `ลูกค้าทดสอบ ${index + 1}`,
    eligibilityAt: "2026-07-29T08:10:00.000Z",
    netWeight: 100 + index,
    paidAmount: 3_000 + index,
    rubberValueAmount: 2_900 + index,
    ageHours: 48 + index,
    ageIsEstimated: index === 2,
  }));
  return {
    id: "rubber-export-share-test",
    exportNo: "REX-20260729-004",
    locationId: "location-rubber-export-test",
    locationName: "สาขาทดสอบ PDF",
    status: "verified",
    previousStatus: null,
    originalWeightTotal: 303,
    paidTotal: 9_003,
    rubberValueTotal: 8_703,
    averagePrice: 28.72,
    currentWeight: 295,
    weightLossPercent: 2.640264,
    workRate: 1.5,
    otherOperatingCost: 120,
    workTotal: 574.5,
    expenseDestination: "branch",
    createdByName: "ผู้สร้างทดสอบ",
    createdAt: "2026-07-29T08:04:00.000Z",
    verifiedByName: "ผู้ตรวจทดสอบ",
    verifiedAt: "2026-07-29T08:30:00.000Z",
    deletedByName: null,
    deletedAt: null,
    itemCount: items.length,
    reportLockNo: null,
    ageCalculatedAt: "2026-07-29T08:30:00.000Z",
    averageAgeHours: 49.01,
    oldestAgeHours: 50,
    estimatedAgeItemCount: 1,
    items,
    ...overrides,
  };
}

export function longRubberExportDetails() {
  const items = Array.from({ length: 60 }, (_, index) => {
    const row = String(index + 1).padStart(3, "0");
    return {
      id: `export-long-item-${row}`,
      sourceReportItemId: `report-long-item-${row}`,
      sourceBillId: `bill-long-${row}`,
      billDate: "2026-07-29",
      billNo: `RB-LONG-${row}`,
      customerName: `ลูกค้าหลายหน้า END-${row}`,
      eligibilityAt: "2026-07-29T08:10:00.000Z",
      netWeight: 100 + index,
      paidAmount: 3_000 + index,
      rubberValueAmount: 2_900 + index,
      ageHours: 48 + index,
      ageIsEstimated: false,
    };
  });
  return rubberExportDetails({
    id: "rubber-export-long-test",
    exportNo: "REX-20260729-060",
    status: "verified",
    itemCount: items.length,
    items,
  });
}
