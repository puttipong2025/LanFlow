import { expect, test } from "@playwright/test";

import { loadSourceModule } from "./helpers/load-source-module";

const diagnostic = 'relation "private.telegram_secret" does not exist';

function validConfigBody() {
  return {
    enabled: false,
    chatId: "-1001234567890",
    startTime: "08:00",
    endTime: "20:00",
    intervalMinutes: 60,
    evidenceEnabled: false,
    evidenceIntervalMinutes: 60,
    evidenceAllLocations: true,
    evidenceLocationIds: [],
    enabledBadgeKeys: ["rubber_bill_approval_pending"],
    botToken: "",
  };
}

function validConfigResponse(enabledBadgeKeys = ["rubber_bill_approval_pending"]) {
  return {
    enabled: false,
    chatId: "-1001234567890",
    startTime: "08:00",
    endTime: "20:00",
    intervalMinutes: 60,
    enabledBadgeKeys,
    evidenceEnabled: false,
    evidenceIntervalMinutes: 60,
    evidenceAllLocations: true,
    evidenceLocationIds: [],
    evidenceLocations: [],
    tokenConfigured: true,
    catalog: enabledBadgeKeys.map((key, index) => ({
      key,
      moduleLabel: "ทดสอบ",
      statusLabel: "รอดำเนินการ",
      sortOrder: index + 1,
    })),
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    updatedAt: "2026-10-12T00:00:00.000Z",
    updatedByName: "ผู้ดูแลระบบ",
  };
}

function configDependencies(rpc: (name: string, args?: unknown) => unknown) {
  return {
    "@/lib/server/auth": {
      requireSystemManager: async () => ({
        ok: true,
        auth: { role: "super_admin" },
        supabase: { rpc },
      }),
    },
    "@/lib/server/management-route-error": {
      isIsoTimestamp: (value: unknown) => typeof value === "string"
        && Number.isFinite(Date.parse(value)),
      isJsonObject: (value: unknown) => value !== null
        && typeof value === "object"
        && !Array.isArray(value),
      isUuid: (value: unknown) => typeof value === "string"
        && /^[0-9a-f-]{36}$/i.test(value),
    },
  };
}

test("Telegram config accepts the branch-transfer badge returned by the database catalog", async () => {
  let saved = false;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/telegram-badge/config/route")>(
    "src/app/api/lanflow/telegram-badge/config/route.ts",
    configDependencies(async () => {
      saved = true;
      return {
        data: validConfigResponse(["branch_transfer_pending_receipt"]),
        error: null,
      };
    }),
  );

  const response = await route.PUT(new Request("http://local/api/lanflow/telegram-badge/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...validConfigBody(),
      enabledBadgeKeys: ["branch_transfer_pending_receipt"],
    }),
  }) as never);

  expect(response.status).toBe(200);
  expect(saved).toBe(true);
});

test("Telegram config delegates catalog membership to the database source of truth", async () => {
  let saved = false;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/telegram-badge/config/route")>(
    "src/app/api/lanflow/telegram-badge/config/route.ts",
    configDependencies(async () => {
      saved = true;
      return {
        data: validConfigResponse(["future_catalog_badge"]),
        error: null,
      };
    }),
  );

  const response = await route.PUT(new Request("http://local/api/lanflow/telegram-badge/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...validConfigBody(),
      enabledBadgeKeys: ["future_catalog_badge"],
    }),
  }) as never);

  expect(response.status).toBe(200);
  expect(saved).toBe(true);
});

test("Telegram config rejects malformed badge keys before calling the database", async () => {
  let called = false;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/telegram-badge/config/route")>(
    "src/app/api/lanflow/telegram-badge/config/route.ts",
    configDependencies(async () => {
      called = true;
      return { data: null, error: null };
    }),
  );

  const response = await route.PUT(new Request("http://local/api/lanflow/telegram-badge/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...validConfigBody(),
      enabledBadgeKeys: ["invalid-badge-key"],
    }),
  }) as never);

  expect(response.status).toBe(400);
  expect(called).toBe(false);
});

test("Telegram config rejects a non-string Chat ID instead of clearing it", async () => {
  let called = false;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/telegram-badge/config/route")>(
    "src/app/api/lanflow/telegram-badge/config/route.ts",
    configDependencies(async () => {
      called = true;
      return { data: null, error: null };
    }),
  );

  const response = await route.PUT(new Request("http://local/api/lanflow/telegram-badge/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...validConfigBody(),
      enabled: false,
      chatId: 123456789,
    }),
  }) as never);

  expect(response.status).toBe(400);
  expect(called).toBe(false);
});

test("Telegram config rejects a non-string Bot Token instead of ignoring it", async () => {
  let called = false;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/telegram-badge/config/route")>(
    "src/app/api/lanflow/telegram-badge/config/route.ts",
    configDependencies(async () => {
      called = true;
      return { data: null, error: null };
    }),
  );

  const response = await route.PUT(new Request("http://local/api/lanflow/telegram-badge/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...validConfigBody(),
      botToken: { value: "not-a-token" },
    }),
  }) as never);

  expect(response.status).toBe(400);
  expect(called).toBe(false);
});

test("Telegram config update rejects a malformed successful RPC payload", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/telegram-badge/config/route")>(
    "src/app/api/lanflow/telegram-badge/config/route.ts",
    configDependencies(async () => ({ data: null, error: null })),
  );

  const response = await route.PUT(new Request("http://local/api/lanflow/telegram-badge/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validConfigBody()),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    errorMessage: "บันทึกการตั้งค่า Telegram ไม่สำเร็จ",
  });
});

test("Telegram config update never echoes a Bot Token returned by the RPC", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/telegram-badge/config/route")>(
    "src/app/api/lanflow/telegram-badge/config/route.ts",
    configDependencies(async () => ({
      data: { ...validConfigResponse(), botToken: "must-not-leak" },
      error: null,
    })),
  );

  const response = await route.PUT(new Request("http://local/api/lanflow/telegram-badge/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validConfigBody()),
  }) as never);

  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain("must-not-leak");
});

test("Telegram config update redacts unexpected database diagnostics", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/telegram-badge/config/route")>(
    "src/app/api/lanflow/telegram-badge/config/route.ts",
    configDependencies(async () => ({
      data: null,
      error: { code: "XX000", message: diagnostic },
    })),
  );

  const response = await route.PUT(new Request("http://local/api/lanflow/telegram-badge/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validConfigBody()),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    errorMessage: "บันทึกการตั้งค่า Telegram ไม่สำเร็จ",
  });
});

test("Telegram config read contains thrown RPC failures inside the route boundary", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/telegram-badge/config/route")>(
    "src/app/api/lanflow/telegram-badge/config/route.ts",
    configDependencies(async () => {
      throw new Error(diagnostic);
    }),
  );

  const response = await route.GET(
    new Request("http://local/api/lanflow/telegram-badge/config") as never,
  );

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    errorMessage: "โหลดการตั้งค่า Telegram ไม่สำเร็จ",
  });
});

test("Telegram config read rejects a malformed successful RPC payload", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/telegram-badge/config/route")>(
    "src/app/api/lanflow/telegram-badge/config/route.ts",
    configDependencies(async (name) => ({
      data: name === "get_telegram_badge_config"
        ? null
        : { allLocations: true, locationIds: [], locations: [] },
      error: null,
    })),
  );

  const response = await route.GET(
    new Request("http://local/api/lanflow/telegram-badge/config") as never,
  );

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    errorMessage: "โหลดการตั้งค่า Telegram ไม่สำเร็จ",
  });
});

test("Telegram test contains credential RPC failures inside the route boundary", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/telegram-badge/test/route")>(
    "src/app/api/lanflow/telegram-badge/test/route.ts",
    {
      "@/lib/server/auth": {
        requireSystemManager: async () => ({
          ok: true,
          auth: { role: "super_admin" },
          supabase: {},
        }),
      },
      "@/lib/server/supabase-admin": {
        createSupabaseAdminClient: () => ({
          rpc: async () => {
            throw new Error(diagnostic);
          },
        }),
      },
    },
  );

  const response = await route.POST(
    new Request("http://local/api/lanflow/telegram-badge/test", { method: "POST" }) as never,
  );

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    errorMessage: "โหลดข้อมูลเชื่อมต่อ Telegram ไม่สำเร็จ",
  });
});
