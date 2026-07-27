import { expect, test } from "@playwright/test";

import {
  cashTransferReference,
  renderCashTransferReceiptHtml,
} from "../src/lib/cash-branch-transfer-receipt";
import { receiptPdfFilename } from "../src/lib/rubber-bills/print-receipt";
import type { CashBranchTransfer, CashDenominationCounts } from "../src/types";

const sent: CashDenominationCounts = {
  coin1: 1,
  coin2: 1,
  coin5: 0,
  coin10: 0,
  banknote20: 1,
  banknote50: 0,
  banknote100: 1,
  banknote500: 0,
  banknote1000: 0,
};

function transfer(patch: Partial<CashBranchTransfer> = {}): CashBranchTransfer {
  return {
    id: "12345678-1234-4123-8123-123456789abc",
    locationId: "source",
    targetLocationId: "target",
    targetLocationName: "สาขา <ปลายทาง>",
    createdByName: "ผู้ส่ง",
    createdByPhone: "0800000000",
    createdByUserId: "sender",
    sent,
    received: null,
    sentTotal: 123,
    receivedTotal: null,
    differenceTotal: null,
    status: "pending_receipt",
    note: "ทดสอบ & ตรวจสอบ",
    sentAt: "2026-07-27T03:00:00.000Z",
    receivedAt: null,
    receivedByName: null,
    receivedByPhone: null,
    reportLockNo: null,
    ...patch,
  };
}

test.describe("cash transfer 80mm receipt", () => {
  test("renders pending details with safe 80mm HTML", () => {
    const item = transfer();
    const html = renderCashTransferReceiptHtml(item, "สาขาต้นทาง");

    expect(cashTransferReference(item.id)).toBe("CASH-12345678");
    expect(receiptPdfFilename("LanFlow-cash-transfer", cashTransferReference(item.id)))
      .toBe("LanFlow-cash-transfer-CASH-12345678-80mm.pdf");
    expect(html).toContain("@page { size: 80mm auto;");
    expect(html).toContain("รายละเอียดเงินสด");
    expect(html).toContain("รอรับเงิน");
    expect(html).toContain("สาขาต้นทาง");
    expect(html).toContain("ยังไม่ตรวจรับ");
    expect(html).toContain("ทดสอบ &amp; ตรวจสอบ");
    expect(html).toContain("สาขา &lt;ปลายทาง&gt;");
    expect(html).not.toContain("สาขา <ปลายทาง>");
  });

  test("renders received counts, total difference, receiver, and receipt time", () => {
    const received = { ...sent, banknote20: 0 };
    const html = renderCashTransferReceiptHtml(transfer({
      status: "received",
      received,
      receivedTotal: 103,
      differenceTotal: -20,
      receivedAt: "2026-07-27T06:30:00.000Z",
      receivedByName: "ผู้รับ",
      receivedByPhone: "0811111111",
    }), "สาขาต้นทาง");

    expect(html).toContain("รับเงินแล้ว");
    expect(html).toContain("-20.00 บาท");
    expect(html).toContain("ผู้รับ");
    expect(html).toContain("0811111111");
    expect(html).toMatch(/27.*07.*2569/);
  });
});
