import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { mapLocationRow } from "../src/hooks/useLocations";
import { parseRubberApprovalGroupBody } from "../src/lib/server/rubber-approval-groups";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || "";

async function authContext(browser: Browser, role: "user" | "admin" | "super_admin") {
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
  let originalMaxPriceAllowance = 0;

  test.beforeAll(async () => {
    const db = service();
    const current = await db.from("rubber_bill_approval_settings")
      .select("max_price_allowance")
      .eq("id", true)
      .single();
    expect(current.error).toBeNull();
    originalMaxPriceAllowance = Number(current.data!.max_price_allowance);
    expect((await db.from("rubber_bill_approval_settings")
      .update({ max_price_allowance: 100 })
      .eq("id", true)).error).toBeNull();
  });

  test.afterAll(async () => {
    const db = service();
    expect((await db.from("rubber_bill_approval_settings")
      .update({ max_price_allowance: originalMaxPriceAllowance })
      .eq("id", true)).error).toBeNull();
  });

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

  test("price allowance accepts normal two-decimal numbers only", () => {
    const validCases = [20, 20.1, 0.29, 999999.99];
    for (const priceAllowance of validCases) {
      expect(parseRubberApprovalGroupBody({
        locationIds: [crypto.randomUUID()],
        editWindowMinutes: 30,
        priceAllowance,
      })).toMatchObject({ value: { priceAllowance } });
    }

    const invalidCases = [0.291, 20.101, -0.01, Number.NaN, Number.POSITIVE_INFINITY];
    for (const priceAllowance of invalidCases) {
      expect(parseRubberApprovalGroupBody({
        locationIds: [crypto.randomUUID()],
        editWindowMinutes: 30,
        priceAllowance,
      })).toEqual({ errorMessage: "ส่วนต่างราคาต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง" });
    }
  });

  test("new branches use shared ungrouped rules until assigned to a group", async ({ browser }) => {
    test.setTimeout(60_000);
    const manager = await authContext(browser, "super_admin");
    const db = service();
    const locationId = crypto.randomUUID();
    const code = `RG${locationId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const locationName = `สาขาทดสอบกลุ่มยาง ${code}`;
    let createdGroup: { id: string; revisionNo: number } | null = null;

    try {
      expect((await db.from("locations").insert({
        id: locationId,
        name: locationName,
        code,
        is_active: true,
      })).error).toBeNull();

      const ungroupedResponse = await manager.request.get(
        `/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`,
      );
      expect(ungroupedResponse.ok(), await ungroupedResponse.text()).toBeTruthy();
      expect(await ungroupedResponse.json()).toMatchObject({
        locationId,
        groupId: null,
        ruleSource: "ungrouped",
        centralPrice: 42,
        priceAllowance: 0,
        effectivePriceCap: 42,
        editWindowMinutes: 30,
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
      await expect(groupList).toBeVisible({ timeout: 15_000 });
      await expect(groupList.locator(":scope > *").first()).toContainText("สาขาที่ยังไม่จัดกลุ่ม");
      await expect(groupList.locator(":scope > *").first()).toContainText(locationName);
      await expect(groupList.locator(":scope > *").first()).toContainText("ราคายางที่กำหนด");
      const createGroupButton = approvalDialog.getByRole("button", { name: "สร้างกลุ่ม" });
      await createGroupButton.click();
      await expect(createGroupButton).toHaveCount(0);
      await approvalDialog.getByRole("button", { name: "ยกเลิก" }).click();

      const created = await manager.request.post("/api/lanflow/rubber-bills/approval-groups", {
        data: { locationIds: [locationId], editWindowMinutes: 0, priceAllowance: 3 },
      });
      expect(created.status(), await created.text()).toBe(201);
      const createdBody = await created.json() as { group: { id: string; revisionNo: number } };
      createdGroup = createdBody.group;
      expect(createdBody.group).toMatchObject({
        locationIds: [locationId], editWindowMinutes: 0, priceAllowance: 3,
      });

      const groupedResponse = await manager.request.get(
        `/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`,
      );
      expect(await groupedResponse.json()).toMatchObject({
        locationId,
        groupId: createdGroup.id,
        ruleSource: "group",
        centralPrice: 42,
        priceAllowance: 3,
        effectivePriceCap: 45,
        editWindowMinutes: 0,
      });

      const duplicate = await manager.request.post("/api/lanflow/rubber-bills/approval-groups", {
        data: { locationIds: [locationId], editWindowMinutes: 30, priceAllowance: 1 },
      });
      expect(duplicate.status()).toBe(409);

      const removed = await manager.request.delete(
        `/api/lanflow/rubber-bills/approval-groups/${createdGroup.id}?revision=${createdGroup.revisionNo}`,
      );
      expect(removed.ok(), await removed.text()).toBeTruthy();
      expect(await removed.json()).toEqual({ success: true, releasedLocationIds: [locationId] });
      createdGroup = null;
    } finally {
      if (createdGroup) {
        await manager.request.delete(`/api/lanflow/rubber-bills/approval-groups/${createdGroup.id}?revision=${createdGroup.revisionNo}`);
      }
      await db.from("locations").delete().eq("id", locationId);
      await manager.close();
    }
  });

  test("date rule stays disabled until authoritative settings finish loading", async ({ browser }) => {
    test.setTimeout(60_000);
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

      const settingsResponse = page.waitForResponse((response) => (
        response.request().method() === "GET"
        && response.url().includes("/api/lanflow/rubber-bills/approval-settings?")
      ));
      releaseSettings();
      const response = await settingsResponse;
      expect(response.ok(), await response.text()).toBeTruthy();
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

  test("invalid date-rule response location cannot partially save the global setting", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const locationId = (await profile(manager)).locationIds[0];
    const currentResponse = await manager.request.get(
      `/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`,
    );
    expect(currentResponse.ok(), await currentResponse.text()).toBeTruthy();
    const current = (await currentResponse.json() as { nonCurrentDateRequiresApproval: boolean })
      .nonCurrentDateRequiresApproval;

    try {
      const invalid = await manager.request.put(
        `/api/lanflow/rubber-bills/approval-settings?locationId=${crypto.randomUUID()}`,
        { data: { nonCurrentDateRequiresApproval: !current } },
      );
      expect(invalid.status()).toBe(404);

      const unchanged = await manager.request.get(
        `/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`,
      );
      expect(unchanged.ok(), await unchanged.text()).toBeTruthy();
      expect(await unchanged.json()).toMatchObject({ nonCurrentDateRequiresApproval: current });
    } finally {
      await manager.request.put(
        `/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`,
        { data: { nonCurrentDateRequiresApproval: current } },
      );
      await manager.close();
    }
  });

  test("group endpoints keep validation and missing-resource statuses stable", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    try {
      const empty = await manager.request.post("/api/lanflow/rubber-bills/approval-groups", {
        data: { locationIds: [], editWindowMinutes: 30, priceAllowance: 0 },
      });
      expect(empty.status()).toBe(400);
      expect(await empty.json()).toEqual({
        errorMessage: "ต้องเลือกสาขาอย่างน้อยหนึ่งสาขาและห้ามซ้ำ",
      });

      const wrongPriceType = await manager.request.post(
        "/api/lanflow/rubber-bills/approval-groups",
        { data: { locationIds: [crypto.randomUUID()], editWindowMinutes: 30, priceAllowance: false } },
      );
      expect(wrongPriceType.status()).toBe(400);

      const unknownLocation = await manager.request.post(
        "/api/lanflow/rubber-bills/approval-groups",
        { data: { locationIds: [crypto.randomUUID()], editWindowMinutes: 30, priceAllowance: 0 } },
      );
      expect(unknownLocation.status()).toBe(400);
      expect(await unknownLocation.json()).toEqual({ errorMessage: "พบสาขาที่ไม่พร้อมใช้งาน" });

      const missing = await manager.request.delete(
        `/api/lanflow/rubber-bills/approval-groups/${crypto.randomUUID()}?revision=1`,
      );
      expect(missing.status()).toBe(404);
      expect(await missing.json()).toEqual({ errorMessage: "ไม่พบกลุ่ม" });
    } finally {
      await manager.close();
    }
  });

  test("approval setting routes reject values outside database column ranges", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    try {
      const listed = await manager.request.get("/api/lanflow/rubber-bills/approval-groups");
      expect(listed.ok(), await listed.text()).toBeTruthy();
      const settings = await listed.json() as {
        centralPrice: { revision: number };
        quota: { roundId: string };
        ungroupedDefaults: { revision: number };
      };

      const cases = [
        manager.request.put("/api/lanflow/rubber-bills/approval-settings/central", {
          data: { centralPrice: 10_000_000_000, expectedRevision: settings.centralPrice.revision },
        }),
        manager.request.put("/api/lanflow/rubber-bills/approval-settings/quota", {
          data: {
            quotaLimit: 2_147_483_648,
            maxPriceAllowance: 100,
            expectedRoundId: settings.quota.roundId,
          },
        }),
        manager.request.put("/api/lanflow/rubber-bills/approval-settings/quota", {
          data: {
            quotaLimit: 1,
            maxPriceAllowance: -0.01,
            expectedRoundId: settings.quota.roundId,
          },
        }),
        manager.request.put("/api/lanflow/rubber-bills/approval-settings/quota", {
          data: {
            quotaLimit: 1,
            maxPriceAllowance: 0.001,
            expectedRoundId: settings.quota.roundId,
          },
        }),
        manager.request.put("/api/lanflow/rubber-bills/approval-settings/quota", {
          data: "{",
          headers: { "content-type": "application/json" },
        }),
        manager.request.put("/api/lanflow/rubber-bills/approval-settings/ungrouped", {
          data: {
            editWindowMinutes: 2_147_483_648,
            priceAllowance: 0,
            expectedRevision: settings.ungroupedDefaults.revision,
          },
        }),
        manager.request.post("/api/lanflow/rubber-bills/approval-groups", {
          data: {
            locationIds: [crypto.randomUUID()],
            editWindowMinutes: 2_147_483_648,
            priceAllowance: 0,
          },
        }),
        manager.request.post("/api/lanflow/rubber-bills/approval-groups", {
          data: {
            locationIds: [crypto.randomUUID()],
            editWindowMinutes: 30,
            priceAllowance: 10_000_000_000,
          },
        }),
      ];

      const responses = await Promise.all(cases);
      expect(responses.map((response) => response.status())).toEqual([
        400, 400, 400, 400, 400, 400, 400, 400,
      ]);
    } finally {
      await manager.close();
    }
  });

  test("quota and price allowance limit save atomically and reject a stale round", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const competingManager = await authContext(browser, "super_admin");
    try {
      const listed = await manager.request.get("/api/lanflow/rubber-bills/approval-groups");
      expect(listed.ok(), await listed.text()).toBeTruthy();
      const settings = await listed.json() as {
        quota: { limitPerAdmin: number; maxPriceAllowance: number; roundId: string };
      };
      const previous = settings.quota;

      const candidates = [
        { quotaLimit: previous.limitPerAdmin + 1, maxPriceAllowance: 90 },
        { quotaLimit: previous.limitPerAdmin + 2, maxPriceAllowance: 80 },
      ];
      const responses = await Promise.all([
        manager.request.put("/api/lanflow/rubber-bills/approval-settings/quota", {
          data: { ...candidates[0], expectedRoundId: previous.roundId },
        }),
        competingManager.request.put("/api/lanflow/rubber-bills/approval-settings/quota", {
          data: { ...candidates[1], expectedRoundId: previous.roundId },
        }),
      ]);
      expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
      const winnerIndex = responses.findIndex((response) => response.ok());
      const savedBody = await responses[winnerIndex].json() as {
        quota: { limitPerAdmin: number; maxPriceAllowance: number; roundId: string };
      };
      const winningSettings = {
        limitPerAdmin: candidates[winnerIndex].quotaLimit,
        maxPriceAllowance: candidates[winnerIndex].maxPriceAllowance,
      };
      expect(savedBody.quota).toMatchObject(winningSettings);
      expect(savedBody.quota.roundId).not.toBe(previous.roundId);

      const afterRace = await manager.request.get("/api/lanflow/rubber-bills/approval-groups");
      expect(afterRace.ok(), await afterRace.text()).toBeTruthy();
      expect((await afterRace.json() as { quota: unknown }).quota).toMatchObject(winningSettings);

      const restored = await manager.request.put("/api/lanflow/rubber-bills/approval-settings/quota", {
        data: {
          quotaLimit: previous.limitPerAdmin,
          maxPriceAllowance: previous.maxPriceAllowance,
          expectedRoundId: savedBody.quota.roundId,
        },
      });
      expect(restored.ok(), await restored.text()).toBeTruthy();
    } finally {
      await manager.close();
      await competingManager.close();
    }
  });

  test("quota form shows the limit, snapshots confirmation values, and stays read-only for a system manager", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const systemManager = await authContext(browser, "admin");
    const db = service();
    const systemManagerId = "00000000-0000-4000-8000-000000000002";
    try {
      const superAdminPage = await superAdmin.newPage();
      await superAdminPage.goto("/");
      await superAdminPage.getByRole("button", { name: "บิลยาง" }).click();
      await superAdminPage.getByRole("button", { name: /ตั้งค่าและอนุมัติบิลยาง/ }).click();
      const approvalDialog = superAdminPage.getByRole("dialog", { name: "ตั้งค่าและอนุมัติบิลยาง" });
      await expect(approvalDialog.getByText(/ราคายางที่กำหนดสูงสุด 100\.00 บาท\/กก\./)).toBeVisible();
      await approvalDialog.getByLabel("จำนวนโควต้าต่อ Admin").fill("7");
      await approvalDialog.getByLabel("ราคายางที่กำหนดสูงสุด").fill("11");
      await approvalDialog.getByRole("button", { name: "ตั้งค่าและรีเซ็ตโควต้า" }).click();
      const confirmation = superAdminPage.getByRole("alertdialog", { name: "ตั้งค่าและรีเซ็ตโควต้า?" });
      await expect(confirmation).toContainText("ราคายางที่กำหนดสูงสุด 100.00 → 11.00 บาท/กก.");
      await expect(confirmation).toContainText("รีเซ็ตยอดใช้ของ Admin ทุกบัญชีทันที");
      const current = await superAdmin.request.get("/api/lanflow/rubber-bills/approval-groups");
      expect(current.ok(), await current.text()).toBeTruthy();
      const currentBody = await current.json() as {
        quota: { limitPerAdmin: number; maxPriceAllowance: number; roundId: string };
      };
      const competingSave = await superAdmin.request.put(
        "/api/lanflow/rubber-bills/approval-settings/quota",
        { data: {
          quotaLimit: currentBody.quota.limitPerAdmin,
          maxPriceAllowance: currentBody.quota.maxPriceAllowance,
          expectedRoundId: currentBody.quota.roundId,
        } },
      );
      expect(competingSave.ok(), await competingSave.text()).toBeTruthy();
      await confirmation.getByRole("button", { name: "ยืนยันการตั้งค่า" }).click();
      await expect(approvalDialog.getByText("การตั้งค่าโควต้าถูกแก้ไขโดยผู้ใช้อื่น")).toBeVisible();
      await expect(approvalDialog.getByLabel("จำนวนโควต้าต่อ Admin")).toHaveValue("7");
      await expect(approvalDialog.getByLabel("ราคายางที่กำหนดสูงสุด")).toHaveValue("11");

      expect((await db.from("profiles")
        .update({ can_access_super_admin_features: true })
        .eq("id", systemManagerId)).error).toBeNull();
      const managerPage = await systemManager.newPage();
      await managerPage.goto("/");
      await managerPage.getByRole("button", { name: "บิลยาง" }).click();
      await managerPage.getByRole("button", { name: /ตั้งค่าและอนุมัติบิลยาง/ }).click();
      const managerDialog = managerPage.getByRole("dialog", { name: "ตั้งค่าและอนุมัติบิลยาง" });
      await expect(managerDialog.getByText("เฉพาะ Superadmin เท่านั้นที่ตั้งและรีเซ็ตโควต้าได้")).toBeVisible();
      await expect(managerDialog.getByLabel("ราคายางที่กำหนดสูงสุด")).toHaveCount(0);
    } finally {
      await db.from("profiles")
        .update({ can_access_super_admin_features: false })
        .eq("id", systemManagerId);
      await superAdmin.close();
      await systemManager.close();
    }
  });

  test("approval setting routes reject effective price caps outside database column ranges", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const db = service();
    const groupedLocationId = crypto.randomUUID();
    const ungroupedLocationId = crypto.randomUUID();
    let groupId: string | null = null;
    let ungroupedRestore: { editWindowMinutes: number; priceAllowance: number; revision: number } | null = null;
    try {
      expect((await db.from("locations").insert([
        {
          id: groupedLocationId,
          name: `สาขาทดสอบเพดานกลุ่ม ${groupedLocationId.slice(0, 6)}`,
          code: `CG${groupedLocationId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
          is_active: true,
        },
        {
          id: ungroupedLocationId,
          name: `สาขาทดสอบเพดานเริ่มต้น ${ungroupedLocationId.slice(0, 6)}`,
          code: `CU${ungroupedLocationId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
          is_active: true,
        },
      ])).error).toBeNull();

      const created = await manager.request.post("/api/lanflow/rubber-bills/approval-groups", {
        data: { locationIds: [groupedLocationId], editWindowMinutes: 30, priceAllowance: 1 },
      });
      expect(created.status(), await created.text()).toBe(201);
      groupId = (await created.json() as { group: { id: string } }).group.id;

      const listed = await manager.request.get("/api/lanflow/rubber-bills/approval-groups");
      expect(listed.ok(), await listed.text()).toBeTruthy();
      const settings = await listed.json() as {
        centralPrice: { revision: number };
        ungroupedDefaults: { editWindowMinutes: number; priceAllowance: number; revision: number };
      };
      ungroupedRestore = settings.ungroupedDefaults;

      const centralOverflow = await manager.request.put(
        "/api/lanflow/rubber-bills/approval-settings/central",
        { data: { centralPrice: 9_999_999_999.99, expectedRevision: settings.centralPrice.revision } },
      );
      const centralOverflowText = await centralOverflow.text();

      const groupOverflow = await manager.request.post(
        "/api/lanflow/rubber-bills/approval-groups",
        {
          data: {
            locationIds: [ungroupedLocationId],
            editWindowMinutes: 30,
            priceAllowance: 9_999_999_999.99,
          },
        },
      );
      const groupOverflowText = await groupOverflow.text();

      const ungroupedOverflow = await manager.request.put(
        "/api/lanflow/rubber-bills/approval-settings/ungrouped",
        {
          data: {
            editWindowMinutes: settings.ungroupedDefaults.editWindowMinutes,
            priceAllowance: 9_999_999_999.99,
            expectedRevision: settings.ungroupedDefaults.revision,
          },
        },
      );
      const ungroupedOverflowText = await ungroupedOverflow.text();
      if (ungroupedOverflow.ok()) {
        const body = JSON.parse(ungroupedOverflowText) as { ungroupedDefaults: { revision: number } };
        ungroupedRestore = { ...ungroupedRestore, revision: body.ungroupedDefaults.revision };
      }
      expect(
        [centralOverflow.status(), groupOverflow.status(), ungroupedOverflow.status()],
        JSON.stringify([centralOverflowText, groupOverflowText, ungroupedOverflowText]),
      ).toEqual([400, 400, 400]);
    } finally {
      if (ungroupedRestore) {
        const current = await manager.request.get("/api/lanflow/rubber-bills/approval-groups");
        if (current.ok()) {
          const body = await current.json() as { ungroupedDefaults: { revision: number } };
          if (body.ungroupedDefaults.revision !== ungroupedRestore.revision) {
            ungroupedRestore.revision = body.ungroupedDefaults.revision;
          }
        }
        await manager.request.put("/api/lanflow/rubber-bills/approval-settings/ungrouped", {
          data: {
            editWindowMinutes: ungroupedRestore.editWindowMinutes,
            priceAllowance: ungroupedRestore.priceAllowance,
            expectedRevision: ungroupedRestore.revision,
          },
        });
      }
      if (groupId) await db.from("rubber_approval_groups").delete().eq("id", groupId);
      await db.from("locations").delete().in("id", [groupedLocationId, ungroupedLocationId]);
      await manager.close();
    }
  });

  test("Rubber Bill preview and sync do not expose database cast errors", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const locationId = (await profile(manager)).locationIds[0];
    const clientTempId = crypto.randomUUID();
    const payload = {
      operation: "create",
      expectedRevisionNo: 0,
      clientTempId,
      idempotencyKey: `create:${clientTempId}:0`,
      locationId,
      billDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date()),
      deductWeight: 0,
      items: [{
        itemType: "weigh",
        sequenceNo: 1,
        netWeight: 10,
        unitPrice: "not-a-number",
      }],
    };

    try {
      const responses = await Promise.all(
        ["/api/lanflow/rubber-bills/preview", "/api/lanflow/rubber-bills"]
          .map((path) => manager.request.post(path, { data: payload })),
      );
      for (const response of responses) {
        expect(response.status()).toBe(400);
        expect(await response.json()).toMatchObject({
          errorMessage: "ข้อมูลตัวเลขในบิลยางไม่ถูกต้อง",
        });
      }
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
      const created = await manager.rpc("create_rubber_approval_group_v2", {
        p_location_ids: [locationId],
        p_edit_window_minutes: 30,
        p_price_allowance: 2,
      });
      expect(created.error).toBeNull();
      groupId = (created.data as { group: { id: string } }).group.id;

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
        configured_price: 44,
        price_allowance: 2,
      });
      expect(forbiddenWrite.error).not.toBeNull();
      const managerAuditRead = await manager.from("admin_account_audit_logs").select("id").limit(1);
      expect(managerAuditRead.error).not.toBeNull();
    } finally {
      if (groupId) {
        const row = await db.from("rubber_approval_groups").select("revision_no").eq("id", groupId).single();
        await manager.rpc("delete_rubber_approval_group_v2", { p_group_id: groupId, p_expected_revision: row.data?.revision_no });
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

      const responses = await Promise.all([2, 3].map((priceAllowance) => manager.request.post(
        "/api/lanflow/rubber-bills/approval-groups",
        { data: { locationIds: [locationId], editWindowMinutes: 30, priceAllowance } },
      )));
      expect(responses.map((response) => response.status()).sort()).toEqual([201, 409]);
      const winner = responses.find((response) => response.status() === 201)!;
      groupId = (await winner.json() as { group: { id: string } }).group.id;

      const membership = await db.from("rubber_approval_group_locations")
        .select("group_id", { count: "exact" })
        .eq("location_id", locationId);
      expect(membership.error).toBeNull();
      expect(membership.count).toBe(1);
      expect(membership.data).toEqual([{ group_id: groupId }]);
    } finally {
      if (groupId) {
        const row = await db.from("rubber_approval_groups").select("revision_no").eq("id", groupId).single();
        await manager.request.delete(`/api/lanflow/rubber-bills/approval-groups/${groupId}?revision=${row.data?.revision_no}`);
      }
      await db.from("locations").delete().eq("id", locationId);
      await manager.close();
    }
  });

  test("lowering the limit and raising a group allowance cannot violate the global ceiling", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const db = service();
    const locationId = crypto.randomUUID();
    const code = `RL${locationId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    let groupId: string | null = null;
    try {
      expect((await db.from("locations").insert({
        id: locationId,
        name: `สาขาทดสอบเพดานพร้อมกัน ${code}`,
        code,
        is_active: true,
      })).error).toBeNull();

      let listed = await manager.request.get("/api/lanflow/rubber-bills/approval-groups");
      expect(listed.ok(), await listed.text()).toBeTruthy();
      let settings = await listed.json() as {
        quota: { limitPerAdmin: number; roundId: string };
      };
      const raisedLimit = await manager.request.put("/api/lanflow/rubber-bills/approval-settings/quota", {
        data: {
          quotaLimit: settings.quota.limitPerAdmin,
          maxPriceAllowance: 10,
          expectedRoundId: settings.quota.roundId,
        },
      });
      expect(raisedLimit.ok(), await raisedLimit.text()).toBeTruthy();

      const created = await manager.request.post("/api/lanflow/rubber-bills/approval-groups", {
        data: { locationIds: [locationId], editWindowMinutes: 30, priceAllowance: 5 },
      });
      expect(created.status(), await created.text()).toBe(201);
      const createdGroup = (await created.json() as { group: { id: string; revisionNo: number } }).group;
      groupId = createdGroup.id;

      listed = await manager.request.get("/api/lanflow/rubber-bills/approval-groups");
      expect(listed.ok(), await listed.text()).toBeTruthy();
      settings = await listed.json() as { quota: { limitPerAdmin: number; roundId: string } };
      const [lowerLimit, raiseGroup] = await Promise.all([
        manager.request.put("/api/lanflow/rubber-bills/approval-settings/quota", {
          data: {
            quotaLimit: settings.quota.limitPerAdmin,
            maxPriceAllowance: 6,
            expectedRoundId: settings.quota.roundId,
          },
        }),
        manager.request.put(`/api/lanflow/rubber-bills/approval-groups/${groupId}`, {
          data: {
            locationIds: [locationId],
            editWindowMinutes: 30,
            priceAllowance: 8,
            revisionNo: createdGroup.revisionNo,
            sourceGroupRevisions: {},
          },
        }),
      ]);
      expect([lowerLimit.status(), raiseGroup.status()].sort()).toEqual([200, 400]);

      const invariant = await manager.request.get("/api/lanflow/rubber-bills/approval-groups");
      expect(invariant.ok(), await invariant.text()).toBeTruthy();
      const invariantBody = await invariant.json() as {
        quota: { maxPriceAllowance: number };
        groups: Array<{ id: string; priceAllowance: number }>;
      };
      const group = invariantBody.groups.find((item) => item.id === groupId);
      expect(group).toBeDefined();
      expect(group!.priceAllowance).toBeLessThanOrEqual(invariantBody.quota.maxPriceAllowance);
    } finally {
      if (groupId) {
        const row = await db.from("rubber_approval_groups").select("revision_no").eq("id", groupId).maybeSingle();
        if (row.data) {
          await manager.request.delete(
            `/api/lanflow/rubber-bills/approval-groups/${groupId}?revision=${row.data.revision_no}`,
          );
        }
      }
      await db.from("locations").delete().eq("id", locationId);
      const current = await manager.request.get("/api/lanflow/rubber-bills/approval-groups");
      if (current.ok()) {
        const body = await current.json() as { quota: { limitPerAdmin: number; roundId: string } };
        await manager.request.put("/api/lanflow/rubber-bills/approval-settings/quota", {
          data: {
            quotaLimit: body.quota.limitPerAdmin,
            maxPriceAllowance: 100,
            expectedRoundId: body.quota.roundId,
          },
        });
      }
      await manager.close();
    }
  });

  test("cross-group moves are atomic and cannot empty the source group", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const db = service();
    const locationIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const groups: Array<{ id: string; revisionNo: number }> = [];
    try {
      expect((await db.from("locations").insert(locationIds.map((id, index) => ({
        id,
        name: `สาขาทดสอบ rollback ${index + 1}`,
        code: `RR${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
        is_active: true,
      })))).error).toBeNull();

      for (const [index, groupLocationIds] of [[locationIds[0]], [locationIds[1], locationIds[2]]].entries()) {
        const created = await manager.request.post("/api/lanflow/rubber-bills/approval-groups", { data: {
          locationIds: groupLocationIds, editWindowMinutes: 30 + index, priceAllowance: 2 + index,
        } });
        expect(created.status(), await created.text()).toBe(201);
        groups.push((await created.json() as { group: { id: string; revisionNo: number } }).group);
      }

      const sourceEdited = await manager.request.put(
        `/api/lanflow/rubber-bills/approval-groups/${groups[1].id}`,
        { data: {
          locationIds: [locationIds[1], locationIds[2]],
          editWindowMinutes: 40,
          priceAllowance: 5,
          revisionNo: groups[1].revisionNo,
          sourceGroupRevisions: {},
        } },
      );
      expect(sourceEdited.ok(), await sourceEdited.text()).toBeTruthy();
      const sourceRevision = (await sourceEdited.json() as { group: { revisionNo: number } }).group.revisionNo;

      const staleMove = await manager.request.put(
        `/api/lanflow/rubber-bills/approval-groups/${groups[0].id}`,
        { data: {
          locationIds: [locationIds[0], locationIds[1]],
          editWindowMinutes: 35,
          priceAllowance: 4,
          revisionNo: groups[0].revisionNo,
          sourceGroupRevisions: { [groups[1].id]: groups[1].revisionNo },
        } },
      );
      expect(staleMove.status()).toBe(409);

      const moved = await manager.request.put(
        `/api/lanflow/rubber-bills/approval-groups/${groups[0].id}`,
        { data: {
          locationIds: [locationIds[0], locationIds[1]],
          editWindowMinutes: 35,
          priceAllowance: 4,
          revisionNo: groups[0].revisionNo,
          sourceGroupRevisions: { [groups[1].id]: sourceRevision },
        } },
      );
      expect(moved.ok(), await moved.text()).toBeTruthy();
      const movedGroup = (await moved.json() as { group: { revisionNo: number } }).group;
      const sourceAfterMove = await db.from("rubber_approval_groups")
        .select("revision_no")
        .eq("id", groups[1].id)
        .single();
      expect(sourceAfterMove.error).toBeNull();

      const emptySource = await manager.request.put(
        `/api/lanflow/rubber-bills/approval-groups/${groups[0].id}`,
        { data: {
          locationIds,
          editWindowMinutes: 99,
          priceAllowance: 9,
          revisionNo: movedGroup.revisionNo,
          sourceGroupRevisions: { [groups[1].id]: sourceAfterMove.data!.revision_no },
        } },
      );
      expect(emptySource.status()).toBe(400);
      const listed = await manager.request.get("/api/lanflow/rubber-bills/approval-groups");
      const listedBody = await listed.json() as {
        groups: Array<{ id: string; locationIds: string[]; editWindowMinutes: number; priceAllowance: number; revisionNo: number }>;
      };
      expect(listedBody.groups.find((group) => group.id === groups[0].id)).toMatchObject({
        locationIds: expect.arrayContaining([locationIds[0], locationIds[1]]),
        editWindowMinutes: 35,
        priceAllowance: 4,
      });
      expect(listedBody.groups.find((group) => group.id === groups[1].id)?.locationIds).toEqual([locationIds[2]]);
    } finally {
      for (const group of groups) {
        const row = await db.from("rubber_approval_groups").select("revision_no").eq("id", group.id).maybeSingle();
        if (row.data) await manager.request.delete(`/api/lanflow/rubber-bills/approval-groups/${group.id}?revision=${row.data.revision_no}`);
      }
      await db.from("locations").delete().in("id", locationIds);
      await manager.close();
    }
  });
});
