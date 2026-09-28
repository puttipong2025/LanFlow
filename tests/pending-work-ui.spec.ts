import { expect, test } from "@playwright/test";

test("reports and cash count show compact blocker counts while actions remain retryable", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
  await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByText("ออกจากระบบ")).toBeVisible({ timeout: 30_000 });

  await page.route("**/api/lanflow/reports", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "ยังมีงานค้างที่ต้องจัดการก่อนดำเนินการ",
        blockers: [
          { key: "rubber_bill_pending", label: "บิลยางที่ยังไม่พร้อม", count: 2 },
          { key: "stock_entry_delete_pending", label: "คำขอลบรายการสต็อก", count: 1 },
        ],
      }),
    });
  });

  await page.getByRole("button", { name: "รายงาน", exact: true }).click();
  await expect(page.getByRole("heading", { name: /ชุดรายงาน/ })).toBeVisible();
  const createButton = page.getByRole("button", { name: "สร้างรายงาน", exact: true });
  await createButton.click();

  const reportToast = page.locator("[data-sonner-toast]").filter({
    hasText: "ยังสร้างรายงานไม่ได้",
  }).last();
  await expect(reportToast).toBeVisible();
  await expect(reportToast.getByRole("list", { name: "งานค้างที่ต้องจัดการ" }).getByRole("listitem"))
    .toHaveText(["บิลยางที่ยังไม่พร้อม2 รายการ", "คำขอลบรายการสต็อก1 รายการ"]);
  await expect(reportToast).not.toContainText("rubber_bill_pending");
  await expect(createButton).toBeEnabled();

  await page.route("**/api/lanflow/cash-counts/session?*", (route) => route.fulfill({
    json: { session: null },
  }));
  await page.route("**/api/lanflow/cash-counts/session", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "ยังมีงานค้างที่ต้องจัดการก่อนดำเนินการ",
        blockers: [
          {
            key: "rubber_bill_pending",
            label: "บิลยางที่ยังไม่พร้อม",
            count: 1,
          },
          {
            key: "cash_transfer_receipt_pending",
            label: "เงินสดโอนเข้าสาขาที่ยังไม่รับ",
            count: 3,
          },
        ],
      }),
    });
  });
  await page.route(/\/api\/lanflow\/cash-counts\?.*$/, (route) => route.fulfill({
    json: { counts: [], hasMore: false, nextCursor: null },
  }));

  await page.getByRole("button", { name: "นับเงิน", exact: true }).click();
  await expect(page.getByText("พร้อมเริ่มตรวจนับเงินสด", { exact: true })).toBeVisible();
  const startButton = page.getByRole("button", { name: "เริ่มนับเงิน", exact: true });
  await startButton.click();

  const cashToast = page.locator("[data-sonner-toast]").filter({
    hasText: "ยังเริ่มตรวจนับเงินไม่ได้",
  }).last();
  await expect(cashToast).toBeVisible();
  await expect(cashToast.getByRole("listitem"))
    .toHaveText(["บิลยางที่ยังไม่พร้อม1 รายการ", "เงินสดโอนเข้าสาขาที่ยังไม่รับ3 รายการ"]);
  await expect(cashToast).not.toContainText("cash_transfer_receipt_pending");
  await expect(startButton).toBeEnabled();
});

test("cash count submit keeps the active session retryable when new pending work appears", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
  await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByText("ออกจากระบบ")).toBeVisible({ timeout: 30_000 });

  const now = Date.now();
  await page.route("**/api/lanflow/cash-counts/session?*", (route) => route.fulfill({
    json: {
      session: {
        id: "71000000-0000-4000-8000-000000000001",
        locationId: "72000000-0000-4000-8000-000000000001",
        cutoffAt: new Date(now - 60_000).toISOString(),
        expiresAt: new Date(now + 20 * 60_000).toISOString(),
        startedAt: new Date(now - 60_000).toISOString(),
        startedByName: "Pending Work Manager",
        isOwner: true,
      },
    },
  }));
  await page.route(/\/api\/lanflow\/cash-counts\?.*$/, (route) => route.fulfill({
    json: { counts: [], hasMore: false, nextCursor: null },
  }));
  await page.route("**/api/lanflow/cash-counts", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "ยังมีงานค้างที่ต้องจัดการก่อนดำเนินการ",
        blockers: [{
          key: "income_expense_approval_pending",
          label: "คำขอรับ–จ่ายรออนุมัติ",
          count: 1,
        }],
      }),
    });
  });

  await page.getByRole("button", { name: "นับเงิน", exact: true }).click();
  await expect(page.getByRole("button", { name: "ยืนยันและส่งผล", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ยืนยันและส่งผล", exact: true }).click();
  await page.getByRole("button", { name: "ส่งผลตรวจนับ", exact: true }).click();

  const submitToast = page.locator("[data-sonner-toast]").filter({
    hasText: "ยังส่งผลตรวจนับไม่ได้",
  }).last();
  await expect(submitToast).toBeVisible();
  await expect(submitToast.getByRole("listitem"))
    .toHaveText(["คำขอรับ–จ่ายรออนุมัติ1 รายการ"]);
  await expect(page.getByRole("button", { name: "ยืนยันและส่งผล", exact: true })).toBeEnabled();
  await expect(page.getByText("พร้อมเริ่มตรวจนับเงินสด", { exact: true })).toHaveCount(0);
});
