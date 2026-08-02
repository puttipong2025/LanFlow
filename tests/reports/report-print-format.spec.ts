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
      status: "active",
      createdByName: "ผู้ทดสอบ",
      createdAt: "2026-07-27T00:00:00.000Z",
      deletedAt: null,
      itemCount: 1,
      isLatestActive: true,
      hasCashCount: true,
      cashCountCheckerName: "ผู้ตรวจนับทดสอบ",
      cashCountSubmittedAt: "2026-07-27T00:01:00.000Z",
    },
    rubberBills: [{
      date: "2026-07-27",
      number: "RB-FORMAT-TEST",
      customer: "ลูกค้าทดสอบ",
      customerGroup: "farmer",
      billType: "ชั่ง",
      netWeight: 90.12,
      averagePrice: 28.55,
      rubberValue: 2_572.11,
      deduction: 0,
      net: 2_572,
    }],
    ocrTickets: [],
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

    const rubberSection = page.locator("section").filter({
      has: page.getByRole("heading", { name: "1. บิลยาง" }),
    });
    const traderGroup = rubberSection.locator(".rubber-group").filter({
      has: page.getByRole("heading", { name: "1.1 ผู้ค้าขาย" }),
    });
    const farmerGroup = rubberSection.locator(".rubber-group").filter({
      has: page.getByRole("heading", { name: "1.2 ชาวสวน" }),
    });
    await expect(traderGroup).toContainText("ไม่มีรายการ");
    await expect(farmerGroup).toContainText("90.12");
    await expect(farmerGroup).toContainText("28.55");
    await expect(farmerGroup).toContainText("2,572.11");
    await expect(farmerGroup.getByRole("row").nth(1)).toContainText("2,572");
    await expect(farmerGroup.getByRole("row").nth(1)).not.toContainText("2,572.00");
    await expect(farmerGroup.getByRole("row").last()).not.toContainText("2,572.00");
  } finally {
    await context.close();
  }
});
