import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { mapLocationRow } from "../src/hooks/useLocations";
import { parseRubberApprovalGroupBody } from "../src/lib/server/rubber-approval-groups";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || "";

async function authContext(browser: Browser, role: "user" | "super_admin") {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

async function profile(context: BrowserContext) {
  const response = await context.request.get("/api/auth/me");
  expect(response.ok()).toBeTruthy();
  return (await response.json() as { profile: { locationIds: string[] } }).profile;
}

function service() {
  expect(serviceRoleKey).toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function publicClient() {
  expect(publishableKey).toBeTruthy();
  return createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizeThaiPhone(rawPhone: string) {
  return rawPhone.startsWith("0") ? `+66${rawPhone.slice(1)}` : rawPhone;
}

test.describe.serial("Rubber approval groups API", () => {
  test("maps the persisted location active state", () => {
    expect(mapLocationRow({
      id: "branch-a",
      name: "สาขา A",
      code: null,
      is_active: true,
    })).toEqual({
      id: "branch-a",
      name: "สาขา A",
      code: "",
      active: true,
    });
  });

  test("configured price accepts normal two-decimal numbers only", () => {
    const validCases = [20, 20.1, 0.29, 999999.99];
    for (const configuredPrice of validCases) {
      expect(parseRubberApprovalGroupBody({
        locationIds: [crypto.randomUUID()],
        editWindowMinutes: 30,
        configuredPrice,
      })).toMatchObject({ value: { configuredPrice } });
    }

    const invalidCases = [0.291, 20.101, -0.01, Number.NaN, Number.POSITIVE_INFINITY];
    for (const configuredPrice of invalidCases) {
      expect(parseRubberApprovalGroupBody({
        locationIds: [crypto.randomUUID()],
        editWindowMinutes: 30,
        configuredPrice,
      })).toEqual({ errorMessage: "ราคายางต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง" });
    }
  });

  test("new branches are exempt until a manager assigns them to a group", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const db = service();
    const locationId = crypto.randomUUID();
    const code = `RG${locationId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const locationName = `สาขาทดสอบกลุ่มยาง ${code}`;
    let groupId: string | null = null;

    try {
      expect((await db.from("locations").insert({
        id: locationId,
        name: locationName,
        code,
        is_active: true,
      })).error).toBeNull();

      const exemptResponse = await manager.request.get(
        `/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`,
      );
      expect(exemptResponse.ok(), await exemptResponse.text()).toBeTruthy();
      expect(await exemptResponse.json()).toMatchObject({
        locationId,
        groupId: null,
        priceTimeExempt: true,
        editWindowMinutes: null,
        configuredPrice: null,
      });

      const listed = await manager.request.get("/api/lanflow/rubber-bills/approval-groups");
      expect(listed.ok(), await listed.text()).toBeTruthy();
      expect(await listed.json()).toMatchObject({
        availableLocationIds: expect.arrayContaining([locationId]),
      });

      const page = await manager.newPage();
      await page.goto("/");
      await page.getByRole("button", { name: "บิลยาง" }).click();
      await page.getByRole("button", { name: /ตั้งค่าและอนุมัติบิลยาง/ }).click();
      const approvalDialog = page.getByRole("dialog", { name: "ตั้งค่าและอนุมัติบิลยาง" });
      const groupList = approvalDialog.getByTestId("approval-group-list");
      await expect(groupList.locator(":scope > *").first()).toContainText("ยังไม่จัดกลุ่ม");
      await expect(groupList.locator(":scope > *").first()).toContainText(locationName);
      await expect(groupList.locator(":scope > *").first()).toContainText("ยกเว้นเกณฑ์ราคาและเวลา");
      const createGroupButton = approvalDialog.getByRole("button", { name: "สร้างกลุ่ม" });
      await createGroupButton.click();
      await expect(createGroupButton).toHaveCount(0);
      await approvalDialog.getByRole("button", { name: "ยกเลิก" }).click();

      const created = await manager.request.post("/api/lanflow/rubber-bills/approval-groups", {
        data: { locationIds: [locationId], editWindowMinutes: 0, configuredPrice: null },
      });
      expect(created.status(), await created.text()).toBe(201);
      const group = await created.json() as { id: string };
      groupId = group.id;
      expect(group).toMatchObject({
        locationIds: [locationId],
        editWindowMinutes: 0,
        configuredPrice: null,
      });

      const groupedResponse = await manager.request.get(
        `/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`,
      );
      expect(await groupedResponse.json()).toMatchObject({
        locationId,
        groupId,
        priceTimeExempt: false,
        editWindowMinutes: 0,
        configuredPrice: null,
      });

      const duplicate = await manager.request.post("/api/lanflow/rubber-bills/approval-groups", {
        data: { locationIds: [locationId], editWindowMinutes: 30, configuredPrice: 20 },
      });
      expect(duplicate.status()).toBe(409);

      const removed = await manager.request.delete(
        `/api/lanflow/rubber-bills/approval-groups/${groupId}`,
      );
      expect(removed.ok(), await removed.text()).toBeTruthy();
      expect(await removed.json()).toEqual({ success: true, releasedLocationIds: [locationId] });
      groupId = null;
    } finally {
      if (groupId) {
        await manager.request.delete(`/api/lanflow/rubber-bills/approval-groups/${groupId}`);
      }
      await db.from("locations").delete().eq("id", locationId);
      await manager.close();
    }
  });

  test("date rule stays disabled until authoritative settings finish loading", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    let releaseSettings = () => {};
    const settingsGate = new Promise<void>((resolve) => {
      releaseSettings = resolve;
    });

    try {
      const page = await manager.newPage();
      let delayed = false;
      await page.route(/\/api\/lanflow\/rubber-bills\/approval-settings\?/, async (route) => {
        if (!delayed) {
          delayed = true;
          await settingsGate;
        }
        await route.continue();
      });
      await page.goto("/");
      await page.getByRole("button", { name: "บิลยาง" }).click();
      await page.getByRole("button", { name: /ตั้งค่าและอนุมัติบิลยาง/ }).click();
      const approvalDialog = page.getByRole("dialog", { name: "ตั้งค่าและอนุมัติบิลยาง" });
      const dateRule = approvalDialog.getByRole("checkbox", {
        name: /ขออนุมัติเมื่อวันที่บิลไม่ใช่วันปัจจุบัน/,
      });
      const saveDateRule = approvalDialog.getByRole("button", { name: "บันทึกกฎวันที่" });
      await expect(dateRule).toBeDisabled();
      await expect(saveDateRule).toBeDisabled();

      releaseSettings();
      await expect(dateRule).toBeEnabled();
      await expect(saveDateRule).toBeEnabled();
    } finally {
      releaseSettings();
      await manager.close();
    }
  });

  test("global date rule is manager-only while effective settings stay location-scoped", async ({ browser }) => {
    const user = await authContext(browser, "user");
    const manager = await authContext(browser, "super_admin");
    const locationId = (await profile(user)).locationIds[0];

    try {
      expect((await user.request.get("/api/lanflow/rubber-bills/approval-groups")).status()).toBe(403);
      expect((await user.request.put(
        `/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`,
        { data: { nonCurrentDateRequiresApproval: true } },
      )).status()).toBe(403);

      const updated = await manager.request.put(
        `/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`,
        { data: { nonCurrentDateRequiresApproval: true } },
      );
      expect(updated.ok(), await updated.text()).toBeTruthy();
      expect(await updated.json()).toMatchObject({ locationId, nonCurrentDateRequiresApproval: true });
    } finally {
      await manager.request.put(
        `/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`,
        { data: { nonCurrentDateRequiresApproval: false } },
      );
      await Promise.all([user.close(), manager.close()]);
    }
  });

  test("group endpoints keep validation and missing-resource statuses stable", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    try {
      const empty = await manager.request.post("/api/lanflow/rubber-bills/approval-groups", {
        data: { locationIds: [], editWindowMinutes: 30, configuredPrice: null },
      });
      expect(empty.status()).toBe(400);
      expect(await empty.json()).toEqual({
        errorMessage: "ต้องเลือกสาขาอย่างน้อยหนึ่งสาขาและห้ามซ้ำ",
      });

      const wrongPriceType = await manager.request.post(
        "/api/lanflow/rubber-bills/approval-groups",
        { data: { locationIds: [crypto.randomUUID()], editWindowMinutes: 30, configuredPrice: false } },
      );
      expect(wrongPriceType.status()).toBe(400);

      const missing = await manager.request.delete(
        `/api/lanflow/rubber-bills/approval-groups/${crypto.randomUUID()}`,
      );
      expect(missing.status()).toBe(404);
      expect(await missing.json()).toEqual({ errorMessage: "ไม่พบกลุ่ม" });
    } finally {
      await manager.close();
    }
  });

  test("table grants and RLS keep group reads manager-only and audit rows service-only", async () => {
    const anonymous = publicClient();
    const ordinaryUser = publicClient();
    const manager = publicClient();
    const db = service();
    const locationId = crypto.randomUUID();
    const code = `RA${locationId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    let groupId: string | null = null;
    const password = process.env.TEST_PASSWORD ?? "password123";
    try {
      expect((await db.from("locations").insert({
        id: locationId,
        name: `สาขาทดสอบ RLS ${code}`,
        code,
        is_active: true,
      })).error).toBeNull();
      expect((await ordinaryUser.auth.signInWithPassword({
        phone: "+66820000001",
        password,
      })).error).toBeNull();
      expect((await manager.auth.signInWithPassword({
        phone: normalizeThaiPhone(process.env.TEST_PHONE ?? "0800000000"),
        password,
      })).error).toBeNull();
      const created = await manager.rpc("create_rubber_approval_group", {
        p_location_ids: [locationId],
        p_edit_window_minutes: 30,
        p_configured_price: 20,
      });
      expect(created.error).toBeNull();
      groupId = (created.data as { id: string }).id;

      const anonymousGroups = await anonymous.from("rubber_approval_groups").select("id");
      expect(anonymousGroups.error).not.toBeNull();
      const ordinaryGroups = await ordinaryUser.from("rubber_approval_groups").select("id");
      expect(ordinaryGroups.error).toBeNull();
      expect(ordinaryGroups.data).toEqual([]);
      const managerGroups = await manager.from("rubber_approval_groups").select("id").eq("id", groupId);
      expect(managerGroups.error).toBeNull();
      expect(managerGroups.data).toEqual([{ id: groupId }]);

      const forbiddenWrite = await ordinaryUser.from("rubber_approval_groups").insert({
        edit_window_minutes: 30,
        configured_price: 20,
      });
      expect(forbiddenWrite.error).not.toBeNull();
      const managerAuditRead = await manager.from("admin_account_audit_logs").select("id").limit(1);
      expect(managerAuditRead.error).not.toBeNull();
    } finally {
      if (groupId) {
        await manager.rpc("delete_rubber_approval_group", { p_group_id: groupId });
      }
      await db.from("locations").delete().eq("id", locationId);
    }
  });

  test("concurrent group creation has one winner for a branch", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const db = service();
    const locationId = crypto.randomUUID();
    const code = `RC${locationId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    let groupId: string | null = null;
    try {
      expect((await db.from("locations").insert({
        id: locationId,
        name: `สาขาทดสอบพร้อมกัน ${code}`,
        code,
        is_active: true,
      })).error).toBeNull();

      const responses = await Promise.all([20, 21].map((configuredPrice) => manager.request.post(
        "/api/lanflow/rubber-bills/approval-groups",
        { data: { locationIds: [locationId], editWindowMinutes: 30, configuredPrice } },
      )));
      expect(responses.map((response) => response.status()).sort()).toEqual([201, 409]);
      const winner = responses.find((response) => response.status() === 201)!;
      groupId = (await winner.json() as { id: string }).id;

      const membership = await db.from("rubber_approval_group_locations")
        .select("group_id", { count: "exact" })
        .eq("location_id", locationId);
      expect(membership.error).toBeNull();
      expect(membership.count).toBe(1);
      expect(membership.data).toEqual([{ group_id: groupId }]);
    } finally {
      if (groupId) await manager.request.delete(`/api/lanflow/rubber-bills/approval-groups/${groupId}`);
      await db.from("locations").delete().eq("id", locationId);
      await manager.close();
    }
  });

  test("conflicting updates and empty-group writes roll back atomically", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const db = service();
    const locationIds = [crypto.randomUUID(), crypto.randomUUID()];
    const groupIds: string[] = [];
    try {
      expect((await db.from("locations").insert(locationIds.map((id, index) => ({
        id,
        name: `สาขาทดสอบ rollback ${index + 1}`,
        code: `RR${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
        is_active: true,
      })))).error).toBeNull();

      for (const [index, locationId] of locationIds.entries()) {
        const created = await manager.request.post("/api/lanflow/rubber-bills/approval-groups", {
          data: { locationIds: [locationId], editWindowMinutes: 30 + index, configuredPrice: 20 + index },
        });
        expect(created.status(), await created.text()).toBe(201);
        groupIds.push((await created.json() as { id: string }).id);
      }

      const conflict = await manager.request.put(
        `/api/lanflow/rubber-bills/approval-groups/${groupIds[0]}`,
        { data: { locationIds, editWindowMinutes: 99, configuredPrice: 99 } },
      );
      expect(conflict.status()).toBe(409);
      const listed = await manager.request.get("/api/lanflow/rubber-bills/approval-groups");
      const listedBody = await listed.json() as {
        groups: Array<{ id: string; locationIds: string[]; editWindowMinutes: number; configuredPrice: number }>;
      };
      expect(listedBody.groups.find((group) => group.id === groupIds[0])).toMatchObject({
        locationIds: [locationIds[0]],
        editWindowMinutes: 30,
        configuredPrice: 20,
      });

      const emptyAttempt = await db.from("rubber_approval_group_locations")
        .delete()
        .eq("group_id", groupIds[0]);
      expect(emptyAttempt.error).not.toBeNull();
      const preserved = await db.from("rubber_approval_group_locations")
        .select("location_id")
        .eq("group_id", groupIds[0]);
      expect(preserved.error).toBeNull();
      expect(preserved.data).toEqual([{ location_id: locationIds[0] }]);
    } finally {
      for (const groupId of groupIds) {
        await manager.request.delete(`/api/lanflow/rubber-bills/approval-groups/${groupId}`);
      }
      await db.from("locations").delete().in("id", locationIds);
      await manager.close();
    }
  });
});
