import { expect, test } from "@playwright/test";

import {
  calculateCashDifferences,
  calculateCashTotal,
} from "../src/lib/cash-branch-transfer";

import {
  cashTransferReference,
  renderCashTransferReceiptHtml,
} from "../src/lib/cash-branch-transfer-receipt";
import { CASH_DENOMINATIONS } from "../src/lib/cash-branch-transfer";
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
  test("derives sent, received, and difference totals from denomination counts", () => {
    const received = { ...sent, banknote20: 0, coin5: 2 };

    expect(calculateCashTotal(sent)).toBe(123);
    expect(calculateCashTotal(received)).toBe(113);
    expect(calculateCashDifferences(sent, received)).toMatchObject({ total: -10 });
  });

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
    expect(html).toContain(">ส่ง<");
    expect(html).not.toContain(">รับ<");
    expect(html).not.toContain(">ต่าง<");
    expect(html).toContain("ยอดส่ง");
    expect(html).not.toContain("ยอดรับ");
    expect(html).not.toContain("ผลต่าง");
    expect(html).not.toContain("ผู้ตรวจรับ");
    expect(html).not.toContain("รับเมื่อ");
    expect(html).toContain("<th>ชนิด</th><th class=\"number\">จำนวน</th><th class=\"number\">บาท</th>");
    expect(html).not.toContain("NaN");
    expect(html).toContain("ทดสอบ &amp; ตรวจสอบ");
    expect(html).toContain("สาขา &lt;ปลายทาง&gt;");
    expect(html).not.toContain("สาขา <ปลายทาง>");
  });

  test("renders received counts, total difference, receiver, and receipt time", () => {
    const received = { ...sent, banknote20: 0, coin5: 2 };
    const html = renderCashTransferReceiptHtml(transfer({
      status: "received",
      received,
      receivedTotal: 113,
      differenceTotal: -10,
      receivedAt: "2026-07-27T06:30:00.000Z",
      receivedByName: "ผู้รับ",
      receivedByPhone: "0811111111",
    }), "สาขาต้นทาง");

    expect(html).toContain("รับเงินแล้ว");
    expect(html).toContain(">ส่ง<");
    expect(html).toContain(">รับ<");
    expect(html).toContain(">ต่าง<");
    expect(html).toContain("ยอดรับ");
    expect(html).toContain("ผลต่าง");
    expect(html).toContain("-10.00 บาท");
    expect(html).toContain("-1");
    expect(html).toContain("-20.00");
    expect(html).toContain("+2");
    expect(html).toContain("+10.00");
    expect(html).toContain("ผู้รับ");
    expect(html).toContain("0811111111");
    expect(html).toMatch(/27.*07.*2569/);
  });

  test("defines the correct counting unit for every cash denomination", () => {
    expect(CASH_DENOMINATIONS.map(([key, , , unit]) => [key, unit])).toEqual([
      ["banknote1000", "ใบ"],
      ["banknote500", "ใบ"],
      ["banknote100", "ใบ"],
      ["banknote50", "ใบ"],
      ["banknote20", "ใบ"],
      ["coin10", "เหรียญ"],
      ["coin5", "เหรียญ"],
      ["coin2", "เหรียญ"],
      ["coin1", "เหรียญ"],
    ]);
  });

  test("keeps all three cash tables inside the 80mm receipt width", async ({ page }) => {
    await page.setContent(renderCashTransferReceiptHtml(transfer({
      status: "received",
      received: { ...sent, banknote20: 0, coin5: 2 },
      receivedTotal: 113,
      differenceTotal: -10,
    }), "สาขาต้นทางชื่อยาวสำหรับตรวจขอบกระดาษ"));

    const layout = await page.evaluate(() => ({
      bodyWidth: document.body.getBoundingClientRect().width,
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      tableCount: document.querySelectorAll("table").length,
      overflowingTables: Array.from(document.querySelectorAll("table"))
        .filter((table) => table.scrollWidth > table.clientWidth).length,
    }));
    expect(layout.bodyWidth).toBeCloseTo(80 * 96 / 25.4, 0);
    expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.bodyClientWidth);
    expect(layout.tableCount).toBe(3);
    expect(layout.overflowingTables).toBe(0);
  });
});
