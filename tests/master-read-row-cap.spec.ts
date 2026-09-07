import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test.use({ storageState: "playwright/.auth/super_admin.json" });

test("customer and transport searches include records beyond the first 1,000 rows", async ({ page }) => {
  test.setTimeout(60_000);
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ids = Array.from({ length: 1_001 }, () => crypto.randomUUID());
  const marker = `Cap-${crypto.randomUUID()}`;
  const targetName = `${marker}-1000`;
  try {
    for (let from = 0; from < ids.length; from += 250) {
      const rows = ids.slice(from, from + 250).map((id, index) => ({
        id, main_name: `${marker}-${from + index}`, sync_status: "synced", record_status: "active",
        created_by_name: "Row cap fixture", created_by_phone: "",
        created_at: new Date(Date.UTC(2020, 0, 1) - (from + index) * 1000).toISOString(),
      }));
      expect((await db.from("customers").insert(rows.map((row) => ({ ...row, class: "สาขานี้จ่าย" })))).error).toBeNull();
      expect((await db.from("transport_staffs").insert(rows)).error).toBeNull();
    }
    await page.goto("/");
    await page.getByRole("button", { name: "ลูกค้า", exact: true }).click();
    await page.getByPlaceholder("ค้นหาชื่อ, รหัส, เบอร์โทร, บัตร...").fill(targetName);
    await expect(page.getByRole("row").filter({ hasText: targetName })).toBeVisible();
    await page.getByRole("button", { name: "ขนส่งและพนักงาน", exact: true }).click();
    await page.getByPlaceholder("ค้นหาชื่อ, รหัส, ทะเบียน, เบอร์โทร...").fill(targetName);
    await expect(page.getByRole("row").filter({ hasText: targetName })).toBeVisible();
  } finally {
    const [customerCleanup, transportCleanup] = await Promise.all([
      db.from("customers").delete().like("main_name", `${marker}-%`),
      db.from("transport_staffs").delete().like("main_name", `${marker}-%`),
    ]);
    if (customerCleanup.error) throw customerCleanup.error;
    if (transportCleanup.error) throw transportCleanup.error;
  }
});
