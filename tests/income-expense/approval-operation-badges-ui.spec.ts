import { expect, test } from "@playwright/test";

test.use({ storageState: "playwright/.auth/super_admin.json" });

const locationId = "00000000-0000-4000-8000-000000000001";

const requestRows = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    request_status: "pending",
    requested_operation: "create",
    matched_keyword: "น้ำกรด",
    matched_reasons: ["keyword"],
    location_id: locationId,
    tx_type: "income",
    title: "บิลขาย — 1 รายการ",
    cost: 1100,
    requested_payload: {
      saleLines: [{
        incomeSaleItemId: "20000000-0000-4000-8000-000000000001",
        stockProductId: "30000000-0000-4000-8000-000000000001",
        title: "น้ำกรดตราเสือไฟท์",
        quantity: 10,
        unitPrice: 110,
        lineTotal: 1100,
        sequenceNo: 1,
      }],
    },
    requested_by_name: "ผู้ขอทดสอบ",
    requested_by_phone: "0800000001",
    decided_by_name: null,
    decided_by_phone: null,
    created_at: "2026-09-30T01:00:00.000Z",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    request_status: "approved",
    requested_operation: "update",
    matched_keyword: null,
    matched_reasons: ["amount_threshold"],
    location_id: locationId,
    tx_type: "expense",
    title: "รายการเดิมที่ขอแก้ไข",
    cost: 500,
    requested_payload: {},
    requested_by_name: "ผู้ขอทดสอบ",
    requested_by_phone: "0800000001",
    decided_by_name: "ผู้อนุมัติทดสอบ",
    decided_by_phone: "0800000002",
    created_at: "2026-09-30T00:59:00.000Z",
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    request_status: "rejected",
    requested_operation: "delete",
    matched_keyword: null,
    matched_reasons: ["non_current_date"],
    location_id: locationId,
    tx_type: "income",
    title: "รายการเดิมที่ขอลบ",
    cost: 250,
    requested_payload: {},
    requested_by_name: "ผู้ขอทดสอบ",
    requested_by_phone: "0800000001",
    decided_by_name: "ผู้อนุมัติทดสอบ",
    decided_by_phone: "0800000002",
    created_at: "2026-09-30T00:58:00.000Z",
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    request_status: "cancelled",
    requested_operation: "delete",
    matched_keyword: null,
    matched_reasons: ["keyword"],
    location_id: locationId,
    tx_type: "expense",
    title: "คำขอลบที่ยกเลิกแล้ว",
    cost: 125,
    requested_payload: {},
    requested_by_name: "ผู้ขอทดสอบ",
    requested_by_phone: "0800000001",
    decided_by_name: "ผู้อนุมัติทดสอบ",
    decided_by_phone: "0800000002",
    created_at: "2026-09-30T00:57:00.000Z",
  },
];

const cashDeleteRow = {
  id: "40000000-0000-4000-8000-000000000001",
  source_location_id: locationId,
  source_location_name: "ภูด่านกอย",
  target_location_name: "สาขาปลายทาง",
  transfer_display_no: "CT-TEST-001",
  sent_total: 1000,
  received_total: 1000,
  difference_total: 0,
  request_status: "approved",
  requested_by_name: "ผู้ขอทดสอบ",
  requested_by_phone: "0800000001",
  decided_by_name: "ผู้อนุมัติทดสอบ",
  decided_by_phone: "0800000002",
  created_at: "2026-09-30T00:56:00.000Z",
};

test("approval history identifies create, update, and delete without duplicate sale-line numbering", async ({ page }) => {
  const incomeExpenseProjections: string[] = [];

  await page.setViewportSize({ width: 768, height: 900 });

  await page.route("**/rest/v1/income_expense_approval_requests?*", async (route) => {
    const url = new URL(route.request().url());
    const select = url.searchParams.get("select") ?? "";

    if (select === "id") {
      await route.fulfill({ status: 200, headers: { "content-range": "0-0/1" }, body: "" });
      return;
    }

    incomeExpenseProjections.push(select);
    const statusFilter = url.searchParams.get("request_status") ?? "";
    const rows = statusFilter.startsWith("eq.")
      ? requestRows.filter((row) => row.request_status === "pending")
      : requestRows.filter((row) => row.request_status !== "pending");

    await route.fulfill({ status: 200, contentType: "application/json", json: rows });
  });

  await page.route("**/rest/v1/cash_transfer_delete_requests?*", async (route) => {
    const url = new URL(route.request().url());
    if ((url.searchParams.get("select") ?? "") === "id") {
      await route.fulfill({ status: 200, headers: { "content-range": "0-0/1" }, body: "" });
      return;
    }

    const statusFilter = url.searchParams.get("request_status") ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: statusFilter.startsWith("eq.") ? [] : [cashDeleteRow],
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^รับ-จ่าย(?: |$)/ }).click();
  await page.getByRole("button", { name: /^ตั้งค่าและอนุมัติรับ-จ่าย/ }).click();

  const approvalModal = page.locator(".fixed.inset-0").last();
  await approvalModal.getByRole("combobox", { name: "สาขา", exact: true }).selectOption("all");
  const createRow = approvalModal.locator("tbody tr", { hasText: "น้ำกรดตราเสือไฟท์" });
  const updateRow = approvalModal.locator("tbody tr", { hasText: "รายการเดิมที่ขอแก้ไข" });
  const deleteRow = approvalModal.locator("tbody tr", { hasText: "รายการเดิมที่ขอลบ" });
  const cancelledRow = approvalModal.locator("tbody tr", { hasText: "คำขอลบที่ยกเลิกแล้ว" });
  const cashDeleteRequestRow = approvalModal.locator("tbody tr", { hasText: "CT-TEST-001" });

  await expect(createRow.getByText("เพิ่มใหม่", { exact: true })).toHaveClass(/bg-success\/10/);
  await expect(createRow.getByText("เพิ่มใหม่", { exact: true })).toHaveClass(/text-success/);
  await expect(createRow.getByText("รออนุมัติ", { exact: true })).toBeVisible();
  await expect(createRow.getByRole("list")).toHaveCSS("list-style-type", "decimal");
  await expect(createRow.getByRole("listitem")).not.toHaveText(/^\s*1\./);
  const createItemText = await createRow.locator("td").nth(1).innerText();
  expect(createItemText.indexOf("เพิ่มใหม่")).toBeLessThan(createItemText.indexOf("บิลขาย — 1 รายการ"));

  await expect(updateRow.getByText("แก้ไข", { exact: true })).toHaveClass(/bg-amber\/15/);
  await expect(updateRow.getByText("แก้ไข", { exact: true })).toHaveClass(/text-amber-800/);
  await expect(updateRow.getByText("อนุมัติแล้ว", { exact: true })).toBeVisible();
  await expect(updateRow.locator("td").nth(7)).toHaveText("รายจ่าย");

  await expect(deleteRow.getByText("ลบ", { exact: true })).toHaveClass(/bg-danger\/10/);
  await expect(deleteRow.getByText("ลบ", { exact: true })).toHaveClass(/text-danger/);
  await expect(deleteRow.getByText("ปฏิเสธแล้ว", { exact: true })).toBeVisible();
  await expect(deleteRow.locator("td").nth(7)).toHaveText("รายรับ");

  await expect(cancelledRow.getByText("ลบ", { exact: true })).toBeVisible();
  await expect(cancelledRow.getByText("ยกเลิกแล้ว", { exact: true })).toBeVisible();
  await expect(cashDeleteRequestRow.getByText("ลบ", { exact: true })).toBeVisible();
  await expect(cashDeleteRequestRow.getByText("อนุมัติแล้ว", { exact: true })).toBeVisible();
  const cashDeleteItemText = await cashDeleteRequestRow.locator("td").nth(1).innerText();
  expect(cashDeleteItemText.indexOf("ลบ")).toBeLessThan(cashDeleteItemText.indexOf("CT-TEST-001"));

  expect(incomeExpenseProjections.length).toBeGreaterThanOrEqual(2);
  expect(incomeExpenseProjections.every((projection) => projection.split(",").includes("requested_operation"))).toBe(true);
});
