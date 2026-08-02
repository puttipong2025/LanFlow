import type { ReportDetails } from "@/types/reports";

export function longReportDetails(): ReportDetails {
  const incomeExpense: ReportDetails["incomeExpense"] = Array.from(
    { length: 72 },
    (_, index) => {
      const row = String(index + 1).padStart(3, "0");
      return {
        date: "2026-07-29",
        number: `LEDGER-${row}`,
        type: index % 2 === 0 ? "income" as const : "expense" as const,
        title: `รายการทดสอบหลายหน้าลำดับ ${row} พร้อมรายละเอียดภาษาไทย END-${row}`,
        amount: 1_000 + index,
      };
    },
  );

  return {
    report: {
      id: "report-share-test",
      reportNo: "RPT-20260729-004",
      locationId: "location-share-test",
      locationName: "สาขาทดสอบ PDF",
      cutoffAt: "2026-07-29T08:00:00.000Z",
      status: "deleted",
      createdByName: "ผู้ทดสอบระบบ",
      createdAt: "2026-07-29T08:04:00.000Z",
      deletedAt: "2026-07-29T09:00:00.000Z",
      itemCount: 80,
      isLatestActive: false,
      hasCashCount: true,
      cashCountCheckerName: "ผู้ตรวจนับทดสอบ",
      cashCountSubmittedAt: "2026-07-29T08:03:00.000Z",
    },
    rubberBills: [
      {
        date: "2026-07-29",
        number: "RB-TRADER-001",
        customer: "ผู้ค้าขายทดสอบ",
        customerGroup: "trader",
        billType: "ชั่ง",
        netWeight: 120.5,
        averagePrice: 31.25,
        rubberValue: 3_765.63,
        deduction: 65.63,
        net: 3_700,
      },
      {
        date: "2026-07-29",
        number: "RB-FARMER-001",
        customer: "ชาวสวนทดสอบ",
        customerGroup: "farmer",
        billType: "ชั่ง",
        netWeight: 80,
        averagePrice: 30,
        rubberValue: 2_400,
        deduction: 0,
        net: 2_400,
      },
    ],
    ocrTickets: [{
      date: "2026-07-29",
      number: "OCR-001",
      customer: "ลูกค้าใบชั่ง",
      licensePlate: "กข 1234",
      weightIn: 800,
      weightOut: 200,
      weightNet: 600,
      weightDeducted: 20,
      weightRemaining: 580,
      amount: 18_000,
    }],
    incomeExpense,
    stock: [{
      date: "2026-07-29",
      number: "STOCK-001",
      product: "ปุ๋ยทดสอบ",
      type: "รับเข้า",
      quantity: 25,
      amount: 5_000,
    }],
    stockBalances: [
      { product: "ปุ๋ยทดสอบ", quantity: 25 },
      { product: "กรดทดสอบ", quantity: 12.5 },
    ],
    timePayroll: [
      {
        date: "2026-07-29",
        number: "TIME-001",
        category: "เวลาทำงาน",
        employee: "พนักงานหนึ่ง",
        detail: "ทำงานปกติ",
        quantity: 8,
        amount: null,
      },
      {
        date: "2026-07-29",
        number: "PAY-001",
        category: "เงินเดือน",
        employee: "พนักงานหนึ่ง",
        detail: "เงินเดือน",
        quantity: null,
        amount: 500,
      },
    ],
    bankTransfers: [{
      date: "2026-07-29",
      number: "TRANSFER-001",
      direction: "out",
      party: "สาขาปลายทาง",
      status: "สำเร็จ",
      amount: 5_000,
      slipAmount: 4_990,
      fee: 10,
      branchPaid: 5_000,
    }],
  };
}
