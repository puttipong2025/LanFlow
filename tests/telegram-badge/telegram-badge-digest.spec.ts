import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import {
  formatTelegramBadgeDigest,
  TELEGRAM_BADGE_KEYS,
  type TelegramBadgeCount,
} from "../../src/lib/telegram-badge";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const superAdminId =
  process.env.TEST_USER_ID || "00000000-0000-4000-8000-000000000001";

function service() {
  expect(serviceRoleKey).toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authContext(
  browser: Browser,
  role: "user" | "admin" | "super_admin",
) {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

async function saveConfig(
  context: BrowserContext,
  overrides: Record<string, unknown> = {},
) {
  return context.request.put("/api/lanflow/telegram-badge/config", {
    data: {
      enabled: false,
      chatId: "-1001234567890",
      startTime: "00:01",
      endTime: "23:59",
      intervalMinutes: 60,
      enabledBadgeKeys: TELEGRAM_BADGE_KEYS,
      ...overrides,
    },
  });
}

test.describe.serial("Telegram badge digest @telegram-badge", () => {
  test("formatter sends count-only groups, omits zero, and puts central last", () => {
    const counts: TelegramBadgeCount[] = [
      {
        key: "time_tracking_approval_pending",
        locationId: null,
        locationName: null,
        moduleLabel: "ลงเวลางาน",
        statusLabel: "รออนุมัติ",
        count: 3,
        sortOrder: 90,
      },
      {
        key: "rubber_bill_approval_pending",
        locationId: "branch-a",
        locationName: "สาขา ก",
        moduleLabel: "บิลยาง",
        statusLabel: "รออนุมัติ",
        count: 2,
        sortOrder: 10,
      },
      {
        key: "rubber_export_draft",
        locationId: "branch-a",
        locationName: "สาขา ก",
        moduleLabel: "ส่งออกยาง",
        statusLabel: "ฉบับร่าง",
        count: 0,
        sortOrder: 100,
      },
    ];

    const messages = formatTelegramBadgeDigest(
      counts,
      new Date("2026-07-24T03:00:00.000Z"),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("📍 สาขา ก");
    expect(messages[0]).toContain("• บิลยาง — รออนุมัติ: 2");
    expect(messages[0]).toContain("📍 ส่วนกลาง");
    expect(messages[0]).toContain("• ลงเวลางาน — รออนุมัติ: 3");
    expect(messages[0]).not.toContain("ส่งออกยาง");
    expect(messages[0].indexOf("สาขา ก")).toBeLessThan(
      messages[0].indexOf("ส่วนกลาง"),
    );
    expect(messages[0].length).toBeLessThanOrEqual(4096);
    expect(formatTelegramBadgeDigest([])).toEqual([]);
  });

  test("config API is manager-only and never returns the Bot Token", async ({
    browser,
  }) => {
    const user = await authContext(browser, "user");
    const admin = await authContext(browser, "admin");
    const manager = await authContext(browser, "super_admin");

    try {
      expect(
        (await user.request.get("/api/lanflow/telegram-badge/config")).status(),
      ).toBe(403);
      expect(
        (await admin.request.get("/api/lanflow/telegram-badge/config")).status(),
      ).toBe(403);

      const invalidInterval = await saveConfig(manager, {
        intervalMinutes: 9,
      });
      expect(invalidInterval.status()).toBe(400);

      const invalidWindow = await saveConfig(manager, {
        startTime: "20:00",
        endTime: "08:00",
      });
      expect(invalidWindow.status()).toBe(400);

      const saved = await saveConfig(manager, {
        botToken: "test-token-never-returned",
      });
      const savedBody = await saved.json();
      expect(saved.ok(), JSON.stringify(savedBody)).toBeTruthy();
      expect(savedBody.tokenConfigured).toBe(true);
      expect(savedBody.enabledBadgeKeys).toEqual(
        expect.arrayContaining([...TELEGRAM_BADGE_KEYS]),
      );
      expect(JSON.stringify(savedBody)).not.toContain(
        "test-token-never-returned",
      );

      const loaded = await manager.request.get(
        "/api/lanflow/telegram-badge/config",
      );
      const loadedBody = await loaded.json();
      expect(loaded.ok(), JSON.stringify(loadedBody)).toBeTruthy();
      expect(loadedBody.catalog).toHaveLength(10);
      expect(JSON.stringify(loadedBody)).not.toContain(
        "test-token-never-returned",
      );

      const db = service();
      const { data: credentials, error } = await db.rpc(
        "get_telegram_badge_delivery_credentials",
      );
      expect(error).toBeNull();
      expect(credentials).toEqual({
        botToken: "test-token-never-returned",
        chatId: "-1001234567890",
      });

      const configured = await db.rpc("configure_telegram_badge_dispatcher", {
        p_edge_url:
          "http://kong:8000/functions/v1/telegram-badge-dispatch",
      });
      expect(configured.error).toBeNull();
      const { data: dispatcherState, error: dispatcherStateError } = await db
        .from("telegram_badge_settings")
        .select("dispatch_secret_id, edge_url_secret_id")
        .eq("id", true)
        .single();
      expect(dispatcherStateError).toBeNull();
      expect(dispatcherState?.dispatch_secret_id).toBeTruthy();
      expect(dispatcherState?.edge_url_secret_id).toBeTruthy();

      const publishableKey =
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        "";
      const publicClient = createClient(supabaseUrl, publishableKey);
      const unauthorizedConfigure = await publicClient.rpc(
        "configure_telegram_badge_dispatcher",
        {
          p_edge_url:
            "http://kong:8000/functions/v1/telegram-badge-dispatch",
        },
      );
      expect(unauthorizedConfigure.error).not.toBeNull();
    } finally {
      await Promise.all([user.close(), admin.close(), manager.close()]);
    }
  });

  test("manager sees the config button beside branch controls; regular user does not", async ({
    browser,
  }) => {
    const user = await authContext(browser, "user");
    const manager = await authContext(browser, "super_admin");

    try {
      const userPage = await user.newPage();
      await userPage.goto("/");
      await expect(
        userPage.getByRole("button", {
          name: "ตั้งค่าการแจ้งเตือน Telegram",
        }),
      ).toHaveCount(0);

      const managerPage = await manager.newPage();
      await managerPage.goto("/");
      const configButton = managerPage.getByRole("button", {
        name: "ตั้งค่าการแจ้งเตือน Telegram",
      });
      await expect(configButton).toBeVisible();
      await expect(managerPage.getByLabel("เลือกสาขา")).toBeVisible();
      await configButton.click();

      await expect(
        managerPage.getByRole("heading", {
          name: "ตั้งค่าการแจ้งเตือน Telegram",
        }),
      ).toBeVisible();
      await expect(managerPage.getByText("ระยะห่าง (นาที)")).toBeVisible();
      await expect(
        managerPage.getByRole("button", { name: "ทดสอบการส่ง" }),
      ).toBeVisible();
      await expect(
        managerPage.getByText("Badge ที่ต้องการส่ง"),
      ).toBeVisible();
    } finally {
      await Promise.all([user.close(), manager.close()]);
    }
  });

  test("aggregation includes pending rows and excludes completed rows", async () => {
    const db = service();
    const marker = crypto.randomUUID();
    const pendingId = crypto.randomUUID();
    const approvedId = crypto.randomUUID();

    const { error: insertError } = await db
      .from("stock_product_approval_requests")
      .insert([
        {
          id: pendingId,
          request_status: "pending",
          request_type: "create_product",
          request_idempotency_key: `telegram-pending-${marker}`,
          requested_payload: {},
          product_name: `Telegram pending ${marker}`,
          requested_by_user_id: superAdminId,
          requested_by_name: "LanFlow super_admin",
          requested_by_phone: "0800000000",
        },
        {
          id: approvedId,
          request_status: "approved",
          request_type: "create_product",
          request_idempotency_key: `telegram-approved-${marker}`,
          requested_payload: {},
          product_name: `Telegram approved ${marker}`,
          requested_by_user_id: superAdminId,
          requested_by_name: "LanFlow super_admin",
          requested_by_phone: "0800000000",
        },
      ]);
    expect(insertError).toBeNull();

    try {
      const { data, error } = await db.rpc("get_telegram_badge_counts");
      expect(error).toBeNull();
      const stockCentral = data?.find(
        (row: { badge_key: string; location_id: string | null }) =>
          row.badge_key === "stock_approval_pending" &&
          row.location_id === null,
      );
      expect(Number(stockCentral?.item_count)).toBe(1);
    } finally {
      await db
        .from("stock_product_approval_requests")
        .delete()
        .in("id", [pendingId, approvedId]);
    }
  });

  test("enable waits ten minutes, claims once, and retries after ten minutes", async ({
    browser,
  }) => {
    const manager = await authContext(browser, "super_admin");
    const db = service();

    try {
      const beforeEnable = Date.now();
      const enabled = await saveConfig(manager, {
        enabled: true,
        intervalMinutes: 10,
      });
      expect(enabled.ok(), await enabled.text()).toBeTruthy();

      const { data: afterEnable } = await db
        .from("telegram_badge_settings")
        .select("initial_attempt_at")
        .eq("id", true)
        .single();
      const initialAttemptAt = Date.parse(afterEnable!.initial_attempt_at);
      expect(initialAttemptAt).toBeGreaterThanOrEqual(
        beforeEnable + 9 * 60 * 1000,
      );
      expect(initialAttemptAt).toBeLessThanOrEqual(
        beforeEnable + 11 * 60 * 1000,
      );

      const earlyClaim = await db.rpc("claim_telegram_badge_dispatch");
      expect(earlyClaim.error).toBeNull();
      expect(earlyClaim.data).toMatchObject({
        claimed: false,
        reason: "not_due",
      });

      await db
        .from("telegram_badge_settings")
        .update({ initial_attempt_at: new Date(Date.now() - 1000).toISOString() })
        .eq("id", true);

      const firstClaim = await db.rpc("claim_telegram_badge_dispatch");
      expect(firstClaim.error).toBeNull();
      expect(firstClaim.data.claimed).toBe(true);

      const duplicateClaim = await db.rpc("claim_telegram_badge_dispatch");
      expect(duplicateClaim.error).toBeNull();
      expect(duplicateClaim.data).toMatchObject({
        claimed: false,
        reason: "already_claimed",
      });

      const failedAt = Date.now();
      const failed = await db.rpc("complete_telegram_badge_dispatch", {
        p_claim_token: firstClaim.data.claimToken,
        p_outcome: "failed",
        p_error: "test_failure",
      });
      expect(failed.error).toBeNull();

      const { data: retryState } = await db
        .from("telegram_badge_settings")
        .select("retry_at, pending_slot_at, last_error")
        .eq("id", true)
        .single();
      expect(Date.parse(retryState!.retry_at)).toBeGreaterThanOrEqual(
        failedAt + 9 * 60 * 1000,
      );
      expect(retryState!.pending_slot_at).toBeTruthy();
      expect(retryState!.last_error).toBe("test_failure");

      await db
        .from("telegram_badge_settings")
        .update({ retry_at: new Date(Date.now() - 1000).toISOString() })
        .eq("id", true);
      const retryClaim = await db.rpc("claim_telegram_badge_dispatch");
      expect(retryClaim.error).toBeNull();
      expect(retryClaim.data.claimed).toBe(true);

      const completed = await db.rpc("complete_telegram_badge_dispatch", {
        p_claim_token: retryClaim.data.claimToken,
        p_outcome: "no_items",
        p_error: null,
      });
      expect(completed.error).toBeNull();

      await db
        .from("telegram_badge_settings")
        .update({
          pending_slot_at: new Date().toISOString(),
          retry_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          claim_token: crypto.randomUUID(),
          claimed_at: new Date().toISOString(),
        })
        .eq("id", true);
      const rescheduled = await saveConfig(manager, {
        enabled: true,
        intervalMinutes: 20,
      });
      expect(rescheduled.ok(), await rescheduled.text()).toBeTruthy();
      const { data: rescheduledState } = await db
        .from("telegram_badge_settings")
        .select(
          "interval_minutes, retry_at, pending_slot_at, claim_token, last_completed_slot_at",
        )
        .eq("id", true)
        .single();
      expect(rescheduledState).toMatchObject({
        interval_minutes: 20,
        retry_at: null,
        pending_slot_at: null,
        claim_token: null,
      });
      expect(rescheduledState?.last_completed_slot_at).toBeTruthy();

      const disabled = await saveConfig(manager, {
        enabled: false,
        intervalMinutes: 20,
      });
      expect(disabled.ok(), await disabled.text()).toBeTruthy();
      const { data: finalState } = await db
        .from("telegram_badge_settings")
        .select("enabled, retry_at, pending_slot_at, claim_token")
        .eq("id", true)
        .single();
      expect(finalState).toMatchObject({
        enabled: false,
        retry_at: null,
        pending_slot_at: null,
        claim_token: null,
      });
    } finally {
      await manager.close();
    }
  });

  test("live Telegram test uses saved Vault credentials when explicitly enabled", async ({
    browser,
  }) => {
    const botToken = process.env.TELEGRAM_BADGE_TEST_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_BADGE_TEST_CHAT_ID;
    test.skip(
      !botToken || !chatId,
      "Set Telegram test credentials only for an explicit live-send check",
    );

    const manager = await authContext(browser, "super_admin");
    try {
      const saved = await saveConfig(manager, {
        enabled: false,
        botToken,
        chatId,
      });
      expect(saved.ok(), await saved.text()).toBeTruthy();

      const sent = await manager.request.post(
        "/api/lanflow/telegram-badge/test",
      );
      expect(sent.ok(), await sent.text()).toBeTruthy();
    } finally {
      await manager.close();
    }
  });
});
