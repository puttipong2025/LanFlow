import { expect, test } from "@playwright/test";

import { loadSourceModule } from "./helpers/load-source-module";

const diagnostic = 'relation "private.time_payroll_secret" does not exist';
const profileId = "00000000-0000-4000-8000-000000000003";

function resolvedQuery(error: { message: string } | null = null) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    gt: () => query,
    order: () => query,
    limit: () => query,
    range: () => query,
    then: (resolve: (value: { data: unknown[]; error: { message: string } | null }) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: [], error }).then(resolve, reject),
  };
  return query;
}

function routeDependencies({
  queryError = null,
  pageRows,
}: {
  queryError?: { message: string } | null;
  pageRows?: unknown[][];
} = {}) {
  let pageRead = 0;
  const supabase = {
    from: () => resolvedQuery(queryError),
    rpc: async () => ({ data: [], error: null }),
  };
  return {
    "@/lib/server/auth": {
      requireAuth: async () => ({
        ok: true,
        auth: {
          sub: profileId,
          role: "super_admin",
          locationIds: [],
          canManageTimePayroll: true,
          canAccessSystemManager: true,
        },
        supabase,
      }),
    },
    "@/lib/supabase-pages": {
      readAllSupabaseRows: async () => {
        if (pageRows) return pageRows[pageRead++] ?? [];
        throw new Error(diagnostic);
      },
    },
  };
}

test("time/payroll summary keeps inactive branch admins available for retained audit history", async () => {
  const historicalActor = {
    id: "b4fe8fc2-d74b-45a7-9bb5-1dac3058f839",
    name: "อดีตผู้จัดการเงินเดือน",
    phone: "0800000000",
    daily_wage: 500,
    role: "admin",
    is_active: false,
    can_access_super_admin_features: false,
    user_locations: [],
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/time-tracking/admin/route")>(
    "src/app/api/lanflow/time-tracking/admin/route.ts",
    routeDependencies({ pageRows: [[historicalActor], [], [], []] }),
  );

  const response = await route.GET(new Request("http://local/api/lanflow/time-tracking/admin") as never);

  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload.users).toEqual([]);
  expect(payload.admins).toEqual([{
    id: historicalActor.id,
    name: historicalActor.name,
  }]);
});

test("time/payroll admin route redacts unexpected database diagnostics", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/time-tracking/admin/route")>(
    "src/app/api/lanflow/time-tracking/admin/route.ts",
    routeDependencies(),
  );

  const response = await route.GET(new Request("http://local/api/lanflow/time-tracking/admin") as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "โหลดข้อมูลจัดการเงินเดือนไม่สำเร็จ" });
});

test("time/payroll employee route redacts unexpected database diagnostics", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/time-tracking/user/route")>(
    "src/app/api/lanflow/time-tracking/user/route.ts",
    routeDependencies(),
  );

  const response = await route.GET(new Request("http://local/api/lanflow/time-tracking/user?month=2026-09") as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "โหลดข้อมูลเวลาและเงินเดือนไม่สำเร็จ" });
});

test("time/payroll admin mutation route redacts unexpected database diagnostics", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/time-tracking/admin/route")>(
    "src/app/api/lanflow/time-tracking/admin/route.ts",
    routeDependencies({ queryError: { message: diagnostic } }),
  );
  const request = new Request("http://local/api/lanflow/time-tracking/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "GET_AUDIT_LOGS", payload: {} }),
  });

  const response = await route.POST(request as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "ดำเนินการข้อมูลเวลาและเงินเดือนไม่สำเร็จ" });
});
