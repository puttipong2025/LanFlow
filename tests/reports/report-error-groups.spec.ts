import { expect, test } from "@playwright/test";
import {
  reportCreateErrorResponse,
  reportErrorGroups,
} from "../../src/lib/server/report-response";

test.use({ storageState: { cookies: [], origins: [] } });

test("classifies every related report group once and in report order", () => {
  expect(reportErrorGroups([
    "rubber_bills",
    "rubber_bill_items",
    "ocr_tickets",
    "income_expense",
    "stock_entries",
    "time_segments",
    "payroll_slips",
    "money_transfers",
  ].join(" "))).toEqual([
    "บิลยาง",
    "อ่านใบชั่ง",
    "รับ–จ่าย",
    "สต็อกสินค้า",
    "เวลาและเงินเดือน",
    "โอนเงิน",
  ]);
});

test("falls back to the report system when no group can be inferred", () => {
  expect(reportErrorGroups("unexpected database failure")).toEqual(["ระบบรายงาน"]);
});

test("keeps expected create errors unchanged", async () => {
  const emptyResponse = reportCreateErrorResponse("ไม่มีรายการที่พร้อมออกรายงาน");
  expect(emptyResponse.status).toBe(409);
  expect(await emptyResponse.json()).toEqual({
    error: "ไม่มีรายการที่พร้อมออกรายงาน",
  });

  const forbiddenResponse = reportCreateErrorResponse("ไม่มีสิทธิ์สร้างรายงานของสาขานี้");
  expect(forbiddenResponse.status).toBe(403);
  expect(await forbiddenResponse.json()).toEqual({
    error: "ไม่มีสิทธิ์สร้างรายงานของสาขานี้",
  });
});

test("preserves conflict status while hiding technical details", async () => {
  const response = reportCreateErrorResponse(
    "REPORT_LOCKED:RPT-20260727-001 money_transfers"
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "สร้างรายงานไม่สำเร็จ",
    errorGroups: ["โอนเงิน"],
  });
});

test("maps unfinished rubber-bill blockers to a conflict without leaking details", async () => {
  const response = reportCreateErrorResponse(
    "RUBBER_BILL_PENDING: ยังมีงานบิลยางที่ต้องจัดการก่อนสร้างรายงาน",
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "สร้างรายงานไม่สำเร็จ",
    errorGroups: ["บิลยาง"],
  });
});

test("shows every inferred group on its own line without technical details", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
  await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByText("ออกจากระบบ")).toBeVisible({ timeout: 30_000 });

  let createAttempts = 0;
  await page.route("**/api/lanflow/reports", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    createAttempts += 1;
    if (createAttempts > 1) {
      await route.abort("failed");
      return;
    }

    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: "สร้างรายงานไม่สำเร็จ",
        errorGroups: ["บิลยาง", "รับ–จ่าย", "โอนเงิน"],
      }),
    });
  });

  await page.getByRole("button", { name: "รายงาน", exact: true }).click();
  await expect(page.getByRole("heading", { name: /ชุดรายงาน/ })).toBeVisible();
  await page.getByRole("button", { name: "สร้างรายงาน", exact: true }).click();

  const toast = page.locator("[data-sonner-toast]").filter({
    hasText: "สร้างรายงานไม่สำเร็จ",
  }).last();
  await expect(toast).toBeVisible();
  const groups = toast.getByRole("list", {
    name: "กลุ่มที่คาดว่าเกิดข้อผิดพลาด",
  }).getByRole("listitem");
  await expect(groups).toHaveText(["บิลยาง", "รับ–จ่าย", "โอนเงิน"]);
  await expect(toast).not.toContainText("โมดูล");
  await expect(toast).not.toContainText("rubber_bills");

  await page.getByRole("button", { name: "สร้างรายงาน", exact: true }).click();
  const fallbackToast = page.locator("[data-sonner-toast]").filter({
    hasText: "ระบบรายงาน",
  }).last();
  await expect(fallbackToast).toBeVisible();
  await expect(fallbackToast.getByRole("listitem")).toHaveText(["ระบบรายงาน"]);
  await expect(fallbackToast).not.toContainText("Failed to fetch");
});
