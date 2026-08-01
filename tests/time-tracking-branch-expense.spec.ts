import { expect, request as playwrightRequest, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const password = process.env.TEST_PASSWORD || "password123";
const adminId = "00000000-0000-4000-8000-000000000002";

function serviceClient() {
  expect(serviceRoleKey).toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bangkokDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function createEmployee(suffix: string) {
  const service = serviceClient();
  const phone = `+669${String(Date.now()).slice(-7)}${suffix}`.slice(0, 12);
  const created = await service.auth.admin.createUser({
    phone,
    password,
    phone_confirm: true,
    user_metadata: { name: `ทดสอบค่าใช้จ่าย ${suffix}` },
  });
  expect(created.error).toBeNull();
  const profileId = created.data.user!.id;
  const profile = await service.from("profiles").upsert({
    id: profileId,
    phone,
    name: `ทดสอบค่าใช้จ่าย ${suffix}`,
    role: "user",
    is_active: true,
    daily_wage: 500,
    can_access_super_admin_features: false,
  });
  expect(profile.error).toBeNull();
  return profileId;
}

async function deleteEmployee(profileId: string) {
  const service = serviceClient();
  await service.from("time_tracking_audit_logs").delete().eq("record_id", profileId);
  await service.from("financial_transactions").delete().eq("profile_id", profileId);
  await service.from("time_segments").delete().eq("profile_id", profileId);
  await service.from("payroll_slips").delete().eq("profile_id", profileId);
  await service.auth.admin.deleteUser(profileId);
}

test.describe("Time Tracking branch expense @time-tracking", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("approved withdrawal derives one expense and permanent deletion removes both source and expense", async ({ request }) => {
    const employeeId = await createEmployee("3");
    try {
      const me = await (await request.get("/api/auth/me")).json() as {
        profile: { locationIds: string[] };
      };
      const locationId = me.profile.locationIds[0];
      expect(locationId).toBeTruthy();
      const amount = 10_000 + (Date.now() % 1_000);

      const created = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "ADMIN_REQUEST_WITHDRAWAL",
        payload: {
          user_id: employeeId,
          amount,
          effective_date: bangkokDate(),
        },
      } });
      expect(created.ok()).toBeTruthy();
      const sourceId = ((await created.json()).result as { id: string }).id;

      const approved = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "APPROVE_TRANSACTION",
        payload: {
          transaction_id: sourceId,
          status: "APPROVED",
          expense_location_id: locationId,
          admin_comment: "ทดสอบเชื่อมค่าใช้จ่าย",
        },
      } });
      expect(approved.ok()).toBeTruthy();

      const retry = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "APPROVE_TRANSACTION",
        payload: {
          transaction_id: sourceId,
          status: "APPROVED",
          expense_location_id: locationId,
          admin_comment: "ทดสอบเชื่อมค่าใช้จ่าย",
        },
      } });
      expect(retry.ok()).toBeTruthy();
      expect((await retry.json()).result).toMatchObject({ idempotent: true });

      const feed = await request.get(
        `/api/lanflow/income-expense/feed?locationId=${locationId}&from=${bangkokDate()}&to=${bangkokDate()}`,
      );
      expect(feed.ok()).toBeTruthy();
      const rows = (await feed.json()).rows as Array<{
        relationSourceId?: string;
        relationSourceType?: string;
        cost?: number;
      }>;
      expect(rows).toContainEqual(expect.objectContaining({
        relationSourceType: "time_tracking_withdrawal",
        relationSourceId: sourceId,
        cost: amount,
      }));

      const changedToCentral = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "CHANGE_EXPENSE_LOCATION",
        payload: {
          source_type: "transaction",
          source_id: sourceId,
          expense_location_id: null,
          admin_comment: "",
        },
      } });
      expect(changedToCentral.ok(), await changedToCentral.text()).toBeTruthy();
      const centralFeed = await request.get(
        `/api/lanflow/income-expense/feed?locationId=${locationId}&from=${bangkokDate()}&to=${bangkokDate()}`,
      );
      const centralRows = (await centralFeed.json()).rows as Array<{ relationSourceId?: string }>;
      expect(centralRows.some((row) => row.relationSourceId === sourceId)).toBeFalsy();

      const changedBackToBranch = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "CHANGE_EXPENSE_LOCATION",
        payload: {
          source_type: "transaction",
          source_id: sourceId,
          expense_location_id: locationId,
        },
      } });
      expect(changedBackToBranch.ok(), await changedBackToBranch.text()).toBeTruthy();

      const deleted = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "DELETE_TRANSACTION",
        payload: { transaction_id: sourceId },
      } });
      expect(deleted.ok()).toBeTruthy();

      const afterDelete = await request.get(
        `/api/lanflow/income-expense/feed?locationId=${locationId}&from=${bangkokDate()}&to=${bangkokDate()}`,
      );
      const afterRows = (await afterDelete.json()).rows as Array<{ relationSourceId?: string }>;
      expect(afterRows.some((row) => row.relationSourceId === sourceId)).toBeFalsy();
    } finally {
      await deleteEmployee(employeeId);
    }
  });

  test("approves a zero-net current-month slip without creating an expense", async ({ request }) => {
    const employeeId = await createEmployee("4");
    try {
      const month = bangkokDate().slice(0, 7);
      const created = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "CREATE_PAYROLL_SLIP",
        payload: {
          user_id: employeeId,
          month,
          auto_start_next_month: false,
        },
      } });
      expect(created.ok()).toBeTruthy();
      const slip = (await created.json()).slip as { id: string; net_pay: number };
      expect(Number(slip.net_pay)).toBe(0);

      const approved = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "APPROVE_PAYROLL_SLIP",
        payload: {
          slip_id: slip.id,
          status: "APPROVED",
          admin_comment: "อนุมัติสลิปตนเองได้",
        },
      } });
      expect(approved.ok()).toBeTruthy();

      const service = serviceClient();
      const approvedSlip = await service
        .from("payroll_slips")
        .select("status, expense_location_id")
        .eq("id", slip.id)
        .single();
      expect(approvedSlip.error).toBeNull();
      expect(approvedSlip.data).toMatchObject({
        status: "APPROVED",
        expense_location_id: null,
      });

      const deleted = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "DELETE_PAYROLL_SLIP",
        payload: { slip_id: slip.id },
      } });
      expect(deleted.ok()).toBeTruthy();
    } finally {
      await deleteEmployee(employeeId);
    }
  });

  test("positive payroll can move between central outside payment and a branch expense", async ({ request }) => {
    const employeeId = await createEmployee("7");
    try {
      const workDate = bangkokDate();
      const month = workDate.slice(0, 7);
      const work = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "ADD_BULK_SEGMENTS",
        payload: {
          user_id: employeeId,
          selections: [{ date: workDate, work_type: "FULL_DAY" }],
          full_snapshot: { [workDate]: "FULL_DAY" },
          admin_comment: "ทดสอบเงินเดือนยอดบวก",
        },
      } });
      expect(work.ok(), await work.text()).toBeTruthy();

      const created = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "CREATE_PAYROLL_SLIP",
        payload: { user_id: employeeId, month, auto_start_next_month: false },
      } });
      expect(created.ok(), await created.text()).toBeTruthy();
      const slip = (await created.json()).slip as { id: string; net_pay: number };
      expect(Number(slip.net_pay)).toBeGreaterThan(0);

      const approved = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "APPROVE_PAYROLL_SLIP",
        payload: {
          slip_id: slip.id,
          status: "APPROVED",
          expense_location_id: null,
          admin_comment: "",
        },
      } });
      expect(approved.ok(), await approved.text()).toBeTruthy();

      const me = await (await request.get("/api/auth/me")).json() as {
        profile: { locationIds: string[] };
      };
      for (const locationId of me.profile.locationIds) {
        const feed = await request.get(
          `/api/lanflow/income-expense/feed?locationId=${locationId}&from=${workDate}&to=${workDate}`,
        );
        expect(feed.ok()).toBeTruthy();
        const rows = (await feed.json()).rows as Array<{ relationSourceId?: string }>;
        expect(rows.some((row) => row.relationSourceId === slip.id)).toBeFalsy();
      }

      const branchId = me.profile.locationIds[0];
      expect(branchId).toBeTruthy();
      const changedToBranch = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "CHANGE_EXPENSE_LOCATION",
        payload: {
          source_type: "payroll_slip",
          source_id: slip.id,
          expense_location_id: branchId,
          admin_comment: "",
        },
      } });
      expect(changedToBranch.ok(), await changedToBranch.text()).toBeTruthy();
      const branchFeed = await request.get(
        `/api/lanflow/income-expense/feed?locationId=${branchId}&from=${workDate}&to=${workDate}`,
      );
      const branchRows = (await branchFeed.json()).rows as Array<{ relationSourceId?: string; relationSourceType?: string }>;
      expect(branchRows).toContainEqual(expect.objectContaining({
        relationSourceId: slip.id,
        relationSourceType: "payroll_slip",
      }));

      const changedBackToCentral = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "CHANGE_EXPENSE_LOCATION",
        payload: {
          source_type: "payroll_slip",
          source_id: slip.id,
          expense_location_id: null,
        },
      } });
      expect(changedBackToCentral.ok(), await changedBackToCentral.text()).toBeTruthy();
    } finally {
      await deleteEmployee(employeeId);
    }
  });

  test("approves a withdrawal as an outside-system central payment without deriving an expense", async ({ request }) => {
    const employeeId = await createEmployee("6");
    try {
      const created = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "ADMIN_REQUEST_WITHDRAWAL",
        payload: {
          user_id: employeeId,
          amount: 321,
          effective_date: bangkokDate(),
        },
      } });
      expect(created.ok()).toBeTruthy();
      const sourceId = ((await created.json()).result as { id: string }).id;

      const approved = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "APPROVE_TRANSACTION",
        payload: {
          transaction_id: sourceId,
          status: "APPROVED",
          expense_location_id: null,
          admin_comment: "",
        },
      } });
      expect(approved.ok(), await approved.text()).toBeTruthy();

      const service = serviceClient();
      const stored = await service
        .from("financial_transactions")
        .select("status, expense_location_id")
        .eq("id", sourceId)
        .single();
      expect(stored.error).toBeNull();
      expect(stored.data).toEqual({ status: "APPROVED", expense_location_id: null });

      const me = await (await request.get("/api/auth/me")).json() as {
        profile: { locationIds: string[] };
      };
      for (const locationId of me.profile.locationIds) {
        const feed = await request.get(
          `/api/lanflow/income-expense/feed?locationId=${locationId}&from=${bangkokDate()}&to=${bangkokDate()}`,
        );
        expect(feed.ok()).toBeTruthy();
        const rows = (await feed.json()).rows as Array<{ relationSourceId?: string }>;
        expect(rows.some((row) => row.relationSourceId === sourceId)).toBeFalsy();
      }
    } finally {
      await deleteEmployee(employeeId);
    }
  });
});

test.describe("Time Tracking permission matrix @time-tracking", () => {
  test("normal admin has user-level access and cannot call manager API", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: "playwright/.auth/admin.json",
    });
    const page = await context.newPage();
    try {
      const response = await page.request.get("/api/lanflow/time-tracking/admin");
      expect(response.status()).toBe(403);

      await page.goto("/");
      await page.getByRole("button", { name: "เวลาและเงินเดือน" }).click();
      await expect(page.getByRole("heading", { name: "ระบบเวลาและเงินเดือน (ของตนเอง)" })).toBeVisible();
      await expect(page.getByRole("button", { name: "เริ่มนับเวลา" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "หยุดงาน" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "ขอเบิกเงินล่วงหน้า" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("system-manager capability gets the same module and active-location rights as super admin", async () => {
    const service = serviceClient();
    const profileUpdate = await service
      .from("profiles")
      .update({ can_access_super_admin_features: true })
      .eq("id", adminId);
    expect(profileUpdate.error).toBeNull();

    const employeeId = await createEmployee("5");
    const managerRequest = await playwrightRequest.newContext({
      baseURL: "http://127.0.0.1:3000",
      storageState: "playwright/.auth/admin.json",
    });
    try {
      const dashboard = await managerRequest.get("/api/lanflow/time-tracking/admin");
      expect(dashboard.ok(), await dashboard.text()).toBeTruthy();

      const allLocations = await service
        .from("locations")
        .select("id")
        .eq("is_active", true)
        .order("id");
      expect(allLocations.error).toBeNull();
      const locationId = allLocations.data?.at(-1)?.id;
      expect(locationId).toBeTruthy();

      const created = await managerRequest.post("/api/lanflow/time-tracking/admin", { data: {
        action: "ADMIN_REQUEST_WITHDRAWAL",
        payload: {
          user_id: employeeId,
          amount: 99,
          effective_date: bangkokDate(),
        },
      } });
      expect(created.ok()).toBeTruthy();
      const sourceId = ((await created.json()).result as { id: string }).id;

      const approved = await managerRequest.post("/api/lanflow/time-tracking/admin", { data: {
        action: "APPROVE_TRANSACTION",
        payload: {
          transaction_id: sourceId,
          status: "APPROVED",
          expense_location_id: locationId,
        },
      } });
      expect(approved.ok()).toBeTruthy();

      const deleted = await managerRequest.post("/api/lanflow/time-tracking/admin", { data: {
        action: "DELETE_TRANSACTION",
        payload: { transaction_id: sourceId },
      } });
      expect(deleted.ok()).toBeTruthy();
    } finally {
      await managerRequest.dispose();
      await service
        .from("profiles")
        .update({ can_access_super_admin_features: false })
        .eq("id", adminId);
      await deleteEmployee(employeeId);
    }
  });
});
