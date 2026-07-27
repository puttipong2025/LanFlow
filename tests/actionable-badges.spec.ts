import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { selectAppLocation } from "./helpers/select-app-location";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

test("actionable badges are authenticated, branch-scoped, and exclude finished work", async () => {
  test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const user = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anonymous = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rawPhone = process.env.TEST_PHONE ?? "0800000000";
  const phone = rawPhone.startsWith("0") ? `+66${rawPhone.slice(1)}` : rawPhone;
  const signIn = await user.auth.signInWithPassword({
    phone,
    password: process.env.TEST_PASSWORD ?? "password123",
  });
  expect(signIn.error).toBeNull();

  const { data: assignment, error: assignmentError } = await service
    .from("user_locations")
    .select("location_id")
    .eq("user_id", signIn.data.user!.id)
    .limit(1)
    .single();
  expect(assignmentError).toBeNull();

  const locationId = assignment!.location_id;
  const transferId = crypto.randomUUID();
  const readMoneyCount = async () => {
    const { data, error } = await user.rpc("get_actionable_badge_counts");
    expect(error).toBeNull();
    const row = data?.find(
      (item: { location_id: string; module_id: string }) =>
        item.location_id === locationId && item.module_id === "money-transfer",
    );
    return Number(row?.item_count ?? 0);
  };

  const unauthenticated = await anonymous.rpc("get_actionable_badge_counts");
  expect(unauthenticated.error).not.toBeNull();
  const baseline = await readMoneyCount();

  const inserted = await service.from("money_transfers").insert({
    id: transferId,
    client_temp_id: transferId,
    idempotency_key: `actionable-badge:${transferId}`,
    location_id: locationId,
    customer_name: "ทดสอบ Badge งานจ่ายล่วงหน้า",
    net_amount_to_pay: 0,
    transfer_method: "bank",
    transfer_type: "customer",
    transfer_status: "advance_payment",
    created_by_user_id: signIn.data.user!.id,
    created_by_name: "LanFlow super_admin",
    created_by_phone: rawPhone,
  });
  expect(inserted.error).toBeNull();

  try {
    expect(await readMoneyCount()).toBe(baseline + 1);

    expect(
      (await service
        .from("money_transfers")
        .update({ transfer_status: "paid" })
        .eq("id", transferId)).error,
    ).toBeNull();
    expect(await readMoneyCount()).toBe(baseline);
  } finally {
    await service.from("money_transfers").delete().eq("id", transferId);
  }
});

test("admin badge counts only time-tracking work the admin can approve", async () => {
  test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await admin.auth.signInWithPassword({
    phone: "+66810000001",
    password: process.env.TEST_PASSWORD ?? "password123",
  });
  expect(signIn.error).toBeNull();

  const adminId = signIn.data.user!.id;
  const userId = "00000000-0000-4000-8000-000000000003";
  const { data: assignment, error: assignmentError } = await service
    .from("user_locations")
    .select("location_id")
    .eq("user_id", adminId)
    .limit(1)
    .single();
  expect(assignmentError).toBeNull();

  const locationId = assignment!.location_id;
  const readTimeCount = async () => {
    const { data, error } = await admin.rpc("get_actionable_badge_counts");
    expect(error).toBeNull();
    const row = data?.find(
      (item: { location_id: string; module_id: string }) =>
        item.location_id === locationId && item.module_id === "time-tracking",
    );
    return Number(row?.item_count ?? 0);
  };
  const baseline = await readTimeCount();
  const ownRequestId = crypto.randomUUID();
  const userRequestId = crypto.randomUUID();

  const inserted = await admin.from("financial_transactions").insert([
    {
      id: ownRequestId,
      profile_id: adminId,
      type: "WITHDRAWAL",
      amount: 100,
      description: "รายการ admin ที่อนุมัติเองไม่ได้",
    },
    {
      id: userRequestId,
      profile_id: userId,
      type: "WITHDRAWAL",
      amount: 100,
      description: "รายการ user ที่ admin อนุมัติได้",
    },
  ]);
  expect(inserted.error).toBeNull();

  try {
    expect(await readTimeCount()).toBe(baseline + 1);
  } finally {
    await admin
      .from("financial_transactions")
      .delete()
      .in("id", [ownRequestId, userRequestId]);
  }
});

test("module nav and branch selector show the same actionable branch work", async ({
  browser,
}) => {
  test.skip(!serviceRoleKey, "Supabase service role key is required");
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const transferId = crypto.randomUUID();
  const { data: location, error: locationError } = await service
    .from("locations")
    .select("id")
    .eq("is_active", true)
    .limit(1)
    .single();
  expect(locationError).toBeNull();

  const inserted = await service.from("money_transfers").insert({
    id: transferId,
    client_temp_id: transferId,
    idempotency_key: `actionable-badge-ui:${transferId}`,
    location_id: location!.id,
    customer_name: "ทดสอบ Badge บนเมนู",
    net_amount_to_pay: 100,
    transfer_method: "bank",
    transfer_type: "customer",
    transfer_status: "pending",
    created_by_user_id:
      process.env.TEST_USER_ID ?? "00000000-0000-4000-8000-000000000001",
    created_by_name: "LanFlow super_admin",
    created_by_phone: process.env.TEST_PHONE ?? "0800000000",
  });
  expect(inserted.error).toBeNull();

  const context = await browser.newContext({
    storageState: "playwright/.auth/super_admin.json",
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await selectAppLocation(page, location!.id);

    await expect(
      page.getByRole("button", {
        name: /^โอนเงิน มีงานที่จัดการได้ [1-9]\d* รายการ$/,
      }),
    ).toBeVisible({ timeout: 15_000 });
    const branchButton = page.getByLabel(/^เลือกสาขา มีงาน [1-9]\d* รายการ$/);
    await expect(branchButton).toBeVisible();
    await branchButton.click();
    await expect(page.getByRole("listbox", { name: "สาขาที่เข้าถึงได้" }))
      .toBeVisible();
    await expect(
      page.locator(`[role="option"][data-location-id="${location!.id}"] span`)
        .last(),
    ).toHaveText(/^[1-9]\d*$|^99\+$/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox", { name: "สาขาที่เข้าถึงได้" }))
      .toHaveCount(0);
    await branchButton.press("ArrowDown");
    await expect(page.getByRole("option").first()).toBeFocused();
  } finally {
    await context.close();
    await service.from("money_transfers").delete().eq("id", transferId);
  }
});

test("branch selector stays usable inside a mobile viewport", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: "playwright/.auth/super_admin.json",
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    const branchButton = page.getByRole("button", { name: /^เลือกสาขา/ });
    await expect(branchButton).toBeVisible({ timeout: 15_000 });
    await branchButton.click();

    const listbox = page.getByRole("listbox", { name: "สาขาที่เข้าถึงได้" });
    await expect(listbox).toBeVisible();
    const box = await listbox.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);

    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(listbox).toHaveCount(0);
    await expect(branchButton).toBeFocused();
  } finally {
    await context.close();
  }
});
