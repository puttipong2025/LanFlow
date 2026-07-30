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
    averagePrice: 29.712871,
    currentWeight: 295,
    weightLossPercent: 2.640264,
    workRate: 1.5,
    otherOperatingCost: 120,
    workTotal: 562.5,
    expenseDestination: "branch",
    createdByName: "ผู้สร้างทดสอบ",
    createdByPhone: "0800000001",
    createdAt: "2026-07-29T08:04:00.000Z",
    verifiedByName: "ผู้ตรวจทดสอบ",
    verifiedByPhone: "0800000002",
    verifiedAt: "2026-07-29T08:30:00.000Z",
    deletedByName: null,
    deletedByPhone: null,
    deletedAt: null,
    itemCount: items.length,
    reportLockNo: null,
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
    };
  });
  return rubberExportDetails({
    id: "rubber-export-long-test",
    exportNo: "REX-20260729-060",
    status: "deleted",
    previousStatus: "verified",
    deletedByName: "ผู้ลบทดสอบ",
    deletedByPhone: "0800000003",
    deletedAt: "2026-07-29T09:30:00.000Z",
    itemCount: items.length,
    items,
  });
}
