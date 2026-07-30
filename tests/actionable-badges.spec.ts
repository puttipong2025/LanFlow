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
    .select("location_id, locations!inner(is_active)")
    .eq("user_id", signIn.data.user!.id)
    .eq("locations.is_active", true)
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
    .select("location_id, locations!inner(is_active)")
    .eq("user_id", adminId)
    .eq("locations.is_active", true)
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

test("hides rubber approval entry point while income approval counts follow the selected branch", async ({ browser }) => {
  test.skip(!serviceRoleKey, "Supabase service role key is required");
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const context = await browser.newContext({
    storageState: "playwright/.auth/super_admin.json",
  });
  const locationIds = [crypto.randomUUID(), crypto.randomUUID()];
  const incomeRequestIds = Array.from({ length: 101 }, () => crypto.randomUUID());
  const rubberRequestIds = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];

  try {
    const meResponse = await context.request.get("/api/auth/me");
    expect(meResponse.ok()).toBeTruthy();
    const me = (await meResponse.json() as {
      profile: { id: string; name: string; phone: string };
    }).profile;
    const { data: requester, error: requesterError } = await service
      .from("profiles")
      .select("id, name, phone")
      .neq("id", me.id)
      .limit(1)
      .single();
    expect(requesterError).toBeNull();

    expect((await service.from("locations").insert(locationIds.map((id, index) => ({
      id,
      name: `สาขา Badge ${index + 1} ${id.slice(0, 6)}`,
      code: `BG${id.slice(0, 6)}`,
      is_active: true,
    })))).error).toBeNull();
    expect((await service.from("user_locations").insert(
      locationIds.map((locationId) => ({ user_id: me.id, location_id: locationId })),
    )).error).toBeNull();

    expect((await service.from("income_expense_approval_requests").insert(
      incomeRequestIds.map((id, index) => {
        const locationId = index === 0 ? locationIds[0] : locationIds[1];
        return {
          id,
          request_status: "pending",
          requested_operation: "create",
          request_idempotency_key: `approval-button:${id}`,
          requested_payload: {
            operation: "create",
            expectedRevisionNo: 0,
            clientTempId: id,
            idempotencyKey: `approval-button:${id}`,
            locationId,
          },
          matched_reason: "amount_threshold",
          location_id: locationId,
          tx_type: "expense",
          title: `คำขอรับจ่าย Badge ${index + 1}`,
          cost: 100 + index,
          requested_by_user_id: requester!.id,
          requested_by_name: requester!.name,
          requested_by_phone: requester!.phone,
        };
      }),
    )).error).toBeNull();

    expect((await service.from("rubber_bill_approval_requests").insert(
      rubberRequestIds.map((id, index) => {
        const locationId = index === 0 ? locationIds[0] : locationIds[1];
        return {
          id,
          operation: "create",
          request_status: "pending",
          location_id: locationId,
          client_temp_id: id,
          idempotency_key: `rubber-approval-button:${id}`,
          base_revision_no: 0,
          matched_reasons: ["price"],
          configured_price_snapshot: 20,
          edit_window_minutes_snapshot: 30,
          proposed_payload: {
            customerName: `คำขอบิลยาง Badge ${index + 1}`,
            billDate: "2026-07-29",
            netTotal: 100 + index,
            items: [],
          },
          requested_by_user_id: requester!.id,
          requested_by_name: requester!.name,
          requested_by_phone: requester!.phone,
        };
      }),
    )).error).toBeNull();
    const [incomePending, cashDeletePending] = await Promise.all([
      service
        .from("income_expense_approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("request_status", "pending"),
      service
        .from("cash_transfer_delete_requests")
        .select("id", { count: "exact", head: true })
        .eq("request_status", "pending"),
    ]);
    expect(incomePending.error).toBeNull();
    expect(cashDeletePending.error).toBeNull();
    const allIncomePendingCount = (incomePending.count ?? 0) + (cashDeletePending.count ?? 0);

    const page = await context.newPage();
    await page.goto("/");
    await selectAppLocation(page, locationIds[0]);

    await page.getByRole("button", { name: /^บิลยาง/ }).click();
    const rubberApprovalButton = page.getByRole("button", {
      name: /^ตั้งค่าและอนุมัติบิลยาง/,
    });
    await expect(rubberApprovalButton).toHaveCount(0);

    await selectAppLocation(page, locationIds[1]);
    await expect(rubberApprovalButton).toHaveCount(0);
    await selectAppLocation(page, locationIds[0]);

    await page.getByRole("button", { name: /^รับ-จ่าย/ }).click();
    let approvalButton = page.getByRole("button", {
      name: "ตั้งค่าและอนุมัติรับ-จ่าย รออนุมัติ 1 รายการ",
    });
    await expect(approvalButton).toBeVisible({ timeout: 15_000 });
    await approvalButton.click();
    let approvalModal = page.locator(".fixed.inset-0").last();
    let locationFilter = approvalModal.getByRole("combobox", { name: "สาขา", exact: true });
    await expect(locationFilter).toHaveValue(locationIds[0]);
    await expect(approvalModal.getByText("คำขอรออนุมัติ 1 รายการ", { exact: true })).toBeVisible();
    await locationFilter.selectOption("all");
    await expect(approvalModal.getByText(
      `คำขอรออนุมัติ ${allIncomePendingCount} รายการ`,
      { exact: true },
    )).toBeVisible();
    await locationFilter.selectOption(locationIds[0]);
    const incomeRequest = approvalModal.locator("tbody tr", {
      hasText: "คำขอรับจ่าย Badge 1",
    });
    await incomeRequest.getByRole("button", { name: "ปฏิเสธ" }).click();
    const rejectDialog = page.getByRole("heading", { name: "ปฏิเสธรายการ" }).locator("..");
    await rejectDialog.getByLabel("เหตุผลที่ปฏิเสธ (ไม่บังคับ)").fill("ทดสอบลด Badge");
    await rejectDialog.getByRole("button", { name: "ยืนยัน" }).click();
    await expect(page.getByText("ปฏิเสธรายการแล้ว")).toBeVisible({ timeout: 15_000 });
    await expect(approvalModal.getByText("คำขอรออนุมัติ 0 รายการ", { exact: true })).toBeVisible();
    await approvalModal.getByLabel("ปิด", { exact: true }).click();
    await expect(page.getByRole("button", {
      name: "ตั้งค่าและอนุมัติรับ-จ่าย",
      exact: true,
    })).toBeVisible();

    await selectAppLocation(page, locationIds[1]);
    const cappedApprovalButton = page.getByRole("button", {
      name: "ตั้งค่าและอนุมัติรับ-จ่าย รออนุมัติ 100 รายการ",
    });
    await expect(cappedApprovalButton).toBeVisible();
    await expect(cappedApprovalButton.locator("span")).toHaveText("99+");
    await page.setViewportSize({ width: 390, height: 844 });
    const incomeButtonBox = await cappedApprovalButton.boundingBox();
    expect(incomeButtonBox).not.toBeNull();
    expect(incomeButtonBox!.x).toBeGreaterThanOrEqual(0);
    expect(incomeButtonBox!.x + incomeButtonBox!.width).toBeLessThanOrEqual(390);
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page.getByRole("button", {
      name: "ตั้งค่าและอนุมัติรับ-จ่าย",
      exact: true,
    })).toBeVisible();
    await page.context().setOffline(false);
  } finally {
    await service.from("rubber_bill_approval_requests").delete().in("id", rubberRequestIds);
    await service.from("income_expense_approval_requests").delete().in("id", incomeRequestIds);
    await service.from("user_locations").delete().in("location_id", locationIds);
    await service.from("locations").delete().in("id", locationIds);
    await context.close();
  }
});
