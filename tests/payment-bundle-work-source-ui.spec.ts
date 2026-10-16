import { expect, test } from "@playwright/test";

test("work bundle source opens read-only above the bundle and Escape returns to it", async ({ page }) => {
  test.setTimeout(60_000);
  const id = "e4000000-0000-4000-8000-000000000001";
  const exportId = "e6000000-0000-4000-8000-000000000001";
  const bundle = {
    id, is_payment_bundle: true, transfer_type: "rubber_export_work", transfer_status: "pending",
    net_amount_to_pay: 100, revision_no: 0, created_at: "2026-10-01T00:00:00Z",
    money_transfer_slips: [], bundle_summary: { childCount: 1, amountDue: 100 },
    children: [{ id: "e5000000-0000-4000-8000-000000000001", transfer_type: "rubber_export_work",
      rubber_export_id: exportId, rubber_export_no: "REX-OVERLAY", net_amount_to_pay: 100,
      created_at: "2026-10-01T00:00:00Z", money_transfer_slips: [] }], has_more_children: false,
  };
  await page.route("**/rest/v1/rpc/get_money_transfer_list", (route) => route.fulfill({ json: {
    rows: [bundle], statusCounts: { all: 1, pending: 1 }, hasMore: false,
  } }));
  await page.route("**/rest/v1/rpc/get_payment_bundle_detail", (route) => route.fulfill({ json: bundle }));
  await page.route(`**/api/lanflow/rubber-exports/${exportId}`, (route) => route.fulfill({ json: {
    id: exportId, exportNo: "REX-OVERLAY", locationName: "สาขาทดสอบ", status: "verified",
    workRate: 1, workTotal: 100, otherOperatingCost: 0,
    items: [{ id: "bill-row", billNo: "REX-CHILD-BILL", customerName: "ลูกค้าทดสอบ", netWeight: 100, rubberValueAmount: 1000 }],
  } }));
  await page.goto("/login");
  await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
  await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByText("ออกจากระบบ")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^โอนเงิน/ }).click();
  await page.getByRole("button", { name: "ดูชุด", exact: true }).click();
  const parent = page.getByRole("dialog", { name: "รายละเอียดชุดจ่ายรวม" });
  await expect(parent).toBeVisible();
  const url = page.url();
  const trigger = parent.getByRole("button", { name: "ดูบิลรายการลูก 1" });
  await trigger.click();
  const child = page.getByRole("dialog", { name: "รายละเอียดบิลค่าทำงาน" });
  await expect(child).toBeVisible();
  await expect(child).toContainText("REX-CHILD-BILL");
  await expect(child.getByRole("button", { name: /บันทึก|ตรวจสอบ|แก้ไข/ })).toHaveCount(0);
  expect(page.url()).toBe(url);
  await page.keyboard.press("Escape");
  await expect(child).toBeHidden();
  await expect(parent).toBeVisible();
  await expect(trigger).toBeFocused();
});
