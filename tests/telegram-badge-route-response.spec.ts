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

function configDependencies(rpc: (name: string, args?: unknown) => unknown) {
  return {
    "@/lib/telegram-badge": {
      isTelegramBadgeKey: (value: string) => value === "rubber_bill_approval_pending",
    },
    "@/lib/server/auth": {
      requireSystemManager: async () => ({
        ok: true,
        auth: { role: "super_admin" },
        supabase: { rpc },
      }),
    },
    "@/lib/server/weight-evidence": {
      UUID_PATTERN: /^[0-9a-f-]{36}$/i,
    },
    "@/lib/server/management-route-error": {
      isJsonObject: (value: unknown) => value !== null
        && typeof value === "object"
        && !Array.isArray(value),
    },
  };
}

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
