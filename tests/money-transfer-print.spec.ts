import { expect, test } from "@playwright/test";

import {
  buildMoneyTransferReceiptModel,
  getMoneyTransferPrintBlockReason,
  renderMoneyTransferReceiptHtml,
  shortTransferId,
} from "../src/components/money-transfer/money-transfer-print";
import type { Location, MoneyTransfer } from "../src/types";

const locations: Location[] = [
  { id: "source-location", name: "สาขาต้นทาง", code: "SRC", active: true },
  { id: "target-location", name: "สาขาปลายทาง", code: "DST", active: true },
];

function makeTransfer(patch: Partial<MoneyTransfer> = {}): MoneyTransfer {
  return {
    id: "12345678-1234-4234-8234-1234567890ab",
    locationId: "source-location",
    customerId: "customer-1",
    customerName: "ลูกค้าทดสอบ",
    accountNumber: "123-4-56789-0",
    accountName: "บัญชีลูกค้า",
    bankName: "ธนาคารทดสอบ",
    netAmountToPay: 1_000,
    transferType: "customer",
    transferStatus: "paid",
    branchPaidAmount: 0,
    createdByName: "ผู้สร้าง",
    createdByPhone: "0800000000",
    createdAt: "2026-07-25T07:25:00.000Z",
    slips: [
      {
        id: "slip-two",
        amount: 600,
        referenceNumber: "REF-2",
        fee: 5,
        senderName: "ผู้ส่ง 2",
        receiverName: "ผู้รับ 2",
        transactionDate: "2026-07-25T07:20:00.000Z",
        slipImageUrl: "https://example.com/secret-slip.jpg",
        sortOrder: 2,
      },
      {
        id: "slip-one",
        amount: 400,
        referenceNumber: null,
        fee: 0,
        senderName: null,
        receiverName: null,
        transactionDate: null,
        slipImageUrl: null,
        sortOrder: 1,
      },
    ],
    items: [
      {
        id: "item-1",
        sourceType: "rubber_bill",
        sourceId: "abcdef12-1234-4234-8234-1234567890ab",
        customerName: "ลูกค้าทดสอบ",
        amount: 1_000,
      },
    ],
    ...patch,
  };
}

test.describe("Money transfer 80mm print", () => {
  test("allows only completed payment statuses", () => {
    for (const status of ["paid", "overpaid", "branch_and_transfer", "advance_payment"] as const) {
      expect(getMoneyTransferPrintBlockReason(makeTransfer({ transferStatus: status }))).toBeNull();
    }
    for (const status of ["pending", "partial", "cancelled"] as const) {
      expect(getMoneyTransferPrintBlockReason(makeTransfer({ transferStatus: status }))).toContain("จ่ายเสร็จสิ้น");
    }
  });

  test("builds stable parent-child totals and preserves every slip", () => {
    const model = buildMoneyTransferReceiptModel(makeTransfer(), locations);

    expect(model.shortId).toBe("12345678");
    expect(model.createdAtText).toContain("14:25");
    expect(model.slips.map((slip) => slip.id)).toEqual(["slip-one", "slip-two"]);
    expect(model.slips[0].transactionDateText).toBe("—");
    expect(model.slipTotal).toBe(1_000);
    expect(model.feeTotal).toBe(5);
    expect(model.sourceItemTotal).toBe(1_000);
    expect(model.difference).toBe(0);
  });

  test("uses head office only for branch transfers without a distinct source", () => {
    const headOfficeModel = buildMoneyTransferReceiptModel(makeTransfer({
      transferType: "branch",
      locationId: "target-location",
      targetLocationId: "target-location",
      targetLocationName: "สาขาปลายทาง",
      customerName: null,
    }), locations);
    const branchToBranchModel = buildMoneyTransferReceiptModel(makeTransfer({
      transferType: "branch",
      targetLocationId: "target-location",
      targetLocationName: "สาขาปลายทาง",
      customerName: null,
    }), locations);

    expect(headOfficeModel.sourceLocationName).toBe("สำนักงานใหญ่");
    expect(headOfficeModel.targetLocationName).toBe("สาขาปลายทาง");
    expect(branchToBranchModel.sourceLocationName).toBe("สาขาต้นทาง");
  });

  test("maps every transfer type and completed status to the receipt labels", () => {
    const cases = [
      { transferType: "customer", transferStatus: "paid", typeLabel: "โอนให้ลูกค้า", statusLabel: "จ่ายครบ" },
      { transferType: "transport", transferStatus: "overpaid", typeLabel: "จ่ายค่าขนส่ง", statusLabel: "ชำระเกิน" },
      { transferType: "branch", transferStatus: "branch_and_transfer", typeLabel: "โอนให้สาขา", statusLabel: "โอน + สาขาจ่าย" },
      { transferType: "customer", transferStatus: "advance_payment", typeLabel: "โอนให้ลูกค้า", statusLabel: "จ่ายล่วงหน้า" },
    ] as const;

    for (const item of cases) {
      const model = buildMoneyTransferReceiptModel(makeTransfer(item), locations);
      expect(model.typeLabel).toBe(item.typeLabel);
      expect(model.statusLabel).toBe(item.statusLabel);
    }
  });

  test("prints the actual slip total as the advance payment amount", () => {
    const model = buildMoneyTransferReceiptModel(makeTransfer({
      transferStatus: "advance_payment",
      netAmountToPay: 0,
      items: [],
    }), locations);

    expect(model.primaryAmountLabel).toBe("ยอดจ่ายล่วงหน้า");
    expect(model.primaryAmount).toBe(1_000);
  });

  test("renders escaped 80mm HTML with every child and no slip images", () => {
    const transfer = makeTransfer({
      customerName: '<img src=x onerror="alert(1)">',
      accountName: "ร้าน & ลูกค้า",
      items: [
        ...(makeTransfer().items ?? []),
        {
          id: "item-2",
          sourceType: "ocr_ticket",
          sourceId: "fedcba98-1234-4234-8234-1234567890ab",
          customerName: "ลูกค้า OCR",
          amount: 250,
        },
      ],
      slips: makeTransfer().slips?.map((slip) => (
        slip.id === "slip-two" ? { ...slip, referenceNumber: "<REF-2>" } : slip
      )),
    });
    const html = renderMoneyTransferReceiptHtml(buildMoneyTransferReceiptModel(transfer, locations));

    expect(html).toContain("@page { size: 80mm auto;");
    expect(html).toContain("รายการบิล/ใบชั่งต้นทาง (2)");
    expect(html).toContain("ยอดรายการต้นทางรวม");
    expect(html).toContain("ใบชั่ง OCR #FEDCBA98");
    expect(html).toContain("ลูกค้า OCR");
    expect(html).toContain("1,250.00");
    expect(html).toContain("สลิปประกอบรายการ (2)");
    expect(html).toContain("สลิป 1");
    expect(html).toContain("สลิป 2");
    expect(html).toContain("&lt;REF-2&gt;");
    expect(html).toContain("ร้าน &amp; ลูกค้า");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("secret-slip.jpg");
  });

  test("creates an eight-character reference without changing the source ID", () => {
    const id = "abcdef12-1234-4234-8234-1234567890ab";
    expect(shortTransferId(id)).toBe("ABCDEF12");
    expect(id).toBe("abcdef12-1234-4234-8234-1234567890ab");
  });
});
