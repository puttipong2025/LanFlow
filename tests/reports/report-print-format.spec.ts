import { expect, test } from "@playwright/test";
import type { ReportDetails } from "@/types/reports";

test("prints rubber payable as whole baht while preserving two-decimal money fields", async ({ browser }) => {
  const details: ReportDetails = {
    report: {
      id: "report-format-test",
      reportNo: "RPT-FORMAT-TEST",
      locationId: "location-format-test",
      locationName: "สาขาทดสอบ",
      cutoffAt: "2026-07-27T00:00:00.000Z",
      createdByName: "ผู้ทดสอบ",
      createdAt: "2026-07-27T00:00:00.000Z",
      itemCount: 3,
      hasCashCount: true,
      cashCountCheckerName: "ผู้ตรวจนับทดสอบ",
      cashCountSubmittedAt: "2026-07-27T00:01:00.000Z",
    },
    rubberBills: [
      {
        date: "2026-07-27",
        number: "RB-10",
        customer: "ลูกค้าทดสอบสิบ",
        customerGroup: "farmer",
        billType: "ชั่ง",
        netWeight: 90.12,
        averagePrice: 28.55,
        rubberValue: 2_572.11,
        deduction: 0,
        net: 2_572,
      },
      {
        date: "2026-07-27",
        number: "RB-2",
        customer: "ลูกค้าทดสอบสอง",
        customerGroup: "farmer",
        billType: "ชั่ง",
        netWeight: 10,
        averagePrice: 30,
        rubberValue: 300,
        deduction: 0,
        net: 300,
      },
      {
        date: "2026-07-26",
        number: "RB-BRANCH-1",
        customer: "รับยางจากสาขาต้นทาง",
        customerGroup: "branch_receipt",
        billType: "ชั่ง",
        netWeight: 20,
        averagePrice: 29,
        rubberValue: 580,
        deduction: 580,
        net: 0,
      },
    ],
    incomeExpense: [],
    stock: [],
    stockBalances: [],
    timePayroll: [],
    bankTransfers: [],
  };

  const context = await browser.newContext({
    storageState: "playwright/.auth/super_admin.json",
  });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.print = () => undefined;
    });
    await page.route("**/api/lanflow/reports/report-format-test", (route) =>
      route.fulfill({ json: details })
    );

    await page.goto("/reports/report-format-test/print");
    await expect(page.getByText(/ผลตรวจนับ: มีผลตรวจนับเงินสด/)).toBeVisible();
    await expect(page.getByText(/ผู้ตรวจนับ: ผู้ตรวจนับทดสอบ/)).toBeVisible();
    await expect(page.getByText("คะแนนพิรุธ")).toHaveCount(0);
    await expect(page.getByText(/รวมรายการ \(ไม่รวมยอดยกมา\): 3/)).toBeVisible();
    await expect(page.locator("body")).toContainText("รวม 0 รายการ (ไม่รวมยอดยกมา)");
    await expect(page.getByText(/ช่วงวันที่ข้อมูล: .*26 ก.ค. 2569.*27 ก.ค. 2569/)).toBeVisible();
    await expect(page.getByText("จำนวน source")).toHaveCount(0);

    const rubberSection = page.locator("section").filter({
      has: page.getByRole("heading", { name: "1. บิลยาง" }),
    });
    const traderGroup = rubberSection.locator(".rubber-group").filter({
      has: page.getByRole("heading", { name: "1.1 ผู้ค้าขาย" }),
    });
    const farmerGroup = rubberSection.locator(".rubber-group").filter({
      has: page.getByRole("heading", { name: "1.2 ชาวสวน" }),
    });
    const branchReceiptGroup = rubberSection.locator(".rubber-group").filter({
      has: page.getByRole("heading", { name: "1.3 ยางรับเข้าและยางคงเหลือภายในสาขา" }),
    });
    await expect(traderGroup).toContainText("ไม่มีรายการ");
    await expect(traderGroup).toContainText("รวม 0 รายการ");
    await expect(farmerGroup).toContainText("รวม 2 รายการ");
    await expect(branchReceiptGroup).toContainText("รวม 1 รายการ");
    await expect(farmerGroup.getByRole("row").nth(1)).toContainText("RB-2");
    await expect(farmerGroup.getByRole("row").nth(2)).toContainText("RB-10");
    await expect(farmerGroup).toContainText("90.12");
    await expect(farmerGroup).toContainText("28.55");
    await expect(farmerGroup).toContainText("2,572.11");
    await expect(farmerGroup.getByRole("row").nth(2)).toContainText("2,572");
    await expect(farmerGroup.getByRole("row").nth(2)).not.toContainText("2,572.00");
    await expect(farmerGroup.getByRole("row").last()).not.toContainText("2,572.00");
  } finally {
    await context.close();
  }
});
