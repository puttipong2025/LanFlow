import { expect, test } from "@playwright/test";

import { loadSourceModule } from "./helpers/load-source-module";

const diagnostic = 'relation "private.admin_users_secret" does not exist';

function failingProfilesQuery() {
  const query = {
    select: () => query,
    order: () => query,
    then: (resolve: (value: { data: null; error: Error }) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: null, error: new Error(diagnostic) }).then(resolve, reject),
  };
  return query;
}

function routeDependencies() {
  const supabase = { from: () => failingProfilesQuery() };
  return {
    "@/lib/server/auth": {
      requireRoleOrSystemManager: async () => ({
        ok: true,
        auth: { role: "super_admin" },
        supabase,
      }),
    },
    "@/lib/server/supabase-admin": {
      createSupabaseAdminClient: () => ({
        auth: {
          admin: {
            createUser: async () => ({ data: { user: null }, error: new Error(diagnostic) }),
            deleteUser: async () => ({ error: null }),
          },
        },
        from: () => ({ delete: () => ({ eq: async () => ({ error: null }) }) }),
      }),
    },
  };
}

function failingAdminMutationDependencies() {
  const query = {
    select: () => query,
    update: () => query,
    eq: () => query,
    in: () => query,
    maybeSingle: async () => ({ data: null, error: new Error(diagnostic) }),
  };
  const authorized = async () => ({
    ok: true,
    auth: { sub: "20000000-0000-4000-8000-000000000001", role: "super_admin" },
    supabase: {},
  });
  return {
    "@/lib/server/auth": {
      requireRole: authorized,
      requireSystemManager: authorized,
    },
    "@/lib/server/supabase-admin": {
      createSupabaseAdminClient: () => ({ from: () => query }),
    },
  };
}

test("admin employee feed redacts unexpected database diagnostics", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/users/route")>(
    "src/app/api/lanflow/admin/users/route.ts",
    routeDependencies(),
  );

  const response = await route.GET(new Request("http://local/api/lanflow/admin/users") as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "โหลดรายชื่อพนักงานไม่สำเร็จ" });
});

test("admin employee creation redacts unexpected auth diagnostics", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/users/route")>(
    "src/app/api/lanflow/admin/users/route.ts",
    routeDependencies(),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "พนักงานทดสอบ",
      phone: "0800000000",
      password: "password123",
      role: "user",
      locationIds: [],
    }),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "สร้างบัญชีไม่สำเร็จ" });
});

test("admin employee creation keeps admin-client construction failures inside its response boundary", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/users/route")>(
    "src/app/api/lanflow/admin/users/route.ts",
    {
      "@/lib/server/auth": {
        requireRoleOrSystemManager: async () => ({
          ok: true,
          auth: { role: "super_admin" },
          supabase: {},
        }),
      },
      "@/lib/server/supabase-admin": {
        createSupabaseAdminClient: () => { throw new Error(diagnostic); },
      },
    },
  );

  const response = await route.POST(new Request("http://local/api/lanflow/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "พนักงานทดสอบ",
      phone: "0800000000",
      password: "password123",
      role: "user",
      locationIds: [],
    }),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "สร้างบัญชีไม่สำเร็จ" });
});

test("admin employee creation rejects an out-of-scope branch before creating an auth user", async () => {
  const assignedLocationId = "10000000-0000-4000-8000-000000000001";
  const outsideLocationId = "10000000-0000-4000-8000-000000000002";
  let adminClientCalls = 0;
  const locationQuery = {
    select: () => locationQuery,
    in: async () => ({
      data: [{ id: outsideLocationId, is_active: true }],
      error: null,
    }),
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/users/route")>(
    "src/app/api/lanflow/admin/users/route.ts",
    {
      "@/lib/server/auth": {
        requireRoleOrSystemManager: async () => ({
          ok: true,
          auth: { role: "admin", locationIds: [assignedLocationId] },
          supabase: { from: () => locationQuery },
        }),
      },
      "@/lib/server/supabase-admin": {
        createSupabaseAdminClient: () => {
          adminClientCalls += 1;
          throw new Error(diagnostic);
        },
      },
    },
  );

  const response = await route.POST(new Request("http://local/api/lanflow/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "พนักงานนอกสาขา",
      phone: "0800000000",
      password: "password123",
      role: "user",
      locationIds: [outsideLocationId],
    }),
  }) as never);

  expect(response.status).toBe(403);
  expect(adminClientCalls).toBe(0);
});

test("ordinary Admin cannot create an employee without an assigned branch", async () => {
  let adminClientCalls = 0;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/users/route")>(
    "src/app/api/lanflow/admin/users/route.ts",
    {
      "@/lib/server/auth": {
        requireRoleOrSystemManager: async () => ({
          ok: true,
          auth: { role: "admin", canAccessSystemManager: false, locationIds: [] },
          supabase: {},
        }),
      },
      "@/lib/server/supabase-admin": {
        createSupabaseAdminClient: () => {
          adminClientCalls += 1;
          throw new Error(diagnostic);
        },
      },
    },
  );

  const response = await route.POST(new Request("http://local/api/lanflow/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "พนักงานไม่มีสาขา",
      phone: "0800000000",
      password: "password123",
      role: "user",
      locationIds: [],
    }),
  }) as never);

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Admin ต้องกำหนดสาขาเริ่มต้นให้พนักงาน" });
  expect(adminClientCalls).toBe(0);
});

test("admin employee creation rejects an overlong name before creating an auth user", async () => {
  let adminClientCalls = 0;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/users/route")>(
    "src/app/api/lanflow/admin/users/route.ts",
    {
      "@/lib/server/auth": {
        requireRoleOrSystemManager: async () => ({
          ok: true,
          auth: { role: "super_admin", locationIds: [] },
          supabase: {},
        }),
      },
      "@/lib/server/supabase-admin": {
        createSupabaseAdminClient: () => {
          adminClientCalls += 1;
          throw new Error(diagnostic);
        },
      },
    },
  );

  const response = await route.POST(new Request("http://local/api/lanflow/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "ก".repeat(101),
      phone: "0800000000",
      password: "password123",
      role: "user",
      locationIds: [],
    }),
  }) as never);

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "ชื่อต้องมีความยาว 1-100 ตัวอักษร" });
  expect(adminClientCalls).toBe(0);
});

test("admin employee creation returns the same normalized name stored by the profile RPC", async () => {
  const authUserId = "20000000-0000-4000-8000-000000000003";
  let profileName: unknown;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/users/route")>(
    "src/app/api/lanflow/admin/users/route.ts",
    {
      "@/lib/server/auth": {
        requireRoleOrSystemManager: async () => ({
          ok: true,
          auth: { role: "super_admin", locationIds: [] },
          supabase: {
            rpc: async (_name: string, args: Record<string, unknown>) => {
              profileName = args.p_name;
              return { data: null, error: null };
            },
          },
        }),
      },
      "@/lib/server/supabase-admin": {
        createSupabaseAdminClient: () => ({
          auth: {
            admin: {
              createUser: async () => ({
                data: { user: { id: authUserId, created_at: "2026-10-12T00:00:00.000Z" } },
                error: null,
              }),
              deleteUser: async () => ({ error: null }),
            },
          },
        }),
      },
    },
  );

  const response = await route.POST(new Request("http://local/api/lanflow/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "  ชื่อ   พนักงาน  ",
      phone: "0800000000",
      password: "password123",
      role: "user",
      locationIds: [],
    }),
  }) as never);

  expect(response.status).toBe(201);
  expect(profileName).toBe("ชื่อ พนักงาน");
  expect((await response.json()).user.name).toBe("ชื่อ พนักงาน");
});

test("admin employee creation preserves its JSON response when rollback operations reject", async () => {
  const authUserId = "20000000-0000-4000-8000-000000000002";
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/users/route")>(
    "src/app/api/lanflow/admin/users/route.ts",
    {
      "@/lib/server/auth": {
        requireRoleOrSystemManager: async () => ({
          ok: true,
          auth: { role: "super_admin", locationIds: [] },
          supabase: {
            rpc: async () => { throw new Error(diagnostic); },
          },
        }),
      },
      "@/lib/server/supabase-admin": {
        createSupabaseAdminClient: () => ({
          auth: {
            admin: {
              createUser: async () => ({
                data: { user: { id: authUserId, created_at: "2026-10-12T00:00:00.000Z" } },
                error: null,
              }),
              deleteUser: async () => { throw new Error("auth rollback failed"); },
            },
          },
          from: () => ({
            delete: () => ({
              eq: async () => { throw new Error("profile rollback failed"); },
            }),
          }),
        }),
      },
    },
  );

  const response = await route.POST(new Request("http://local/api/lanflow/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "พนักงานทดสอบ",
      phone: "0800000000",
      password: "password123",
      role: "user",
      locationIds: [],
    }),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "สร้างบัญชีไม่สำเร็จ" });
});

test("admin profile update distinguishes an upstream rejection from invalid JSON", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/users/[id]/profile/route")>(
    "src/app/api/lanflow/admin/users/[id]/profile/route.ts",
    {
      "@/lib/server/auth": {
        requireRoleOrSystemManager: async () => ({
          ok: true,
          auth: { role: "super_admin" },
          supabase: { rpc: async () => { throw new Error(diagnostic); } },
        }),
      },
    },
  );
  const response = await route.PUT(new Request("http://local/api/lanflow/admin/users/id/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "พนักงานทดสอบ",
      locationIds: [],
      primaryLocationId: null,
    }),
  }) as never, { params: Promise.resolve({ id: "20000000-0000-4000-8000-000000000002" }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "บันทึกข้อมูลพนักงานไม่สำเร็จ" });
});

test("admin profile update rejects a null JSON body as invalid input", async () => {
  let rpcCalls = 0;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/users/[id]/profile/route")>(
    "src/app/api/lanflow/admin/users/[id]/profile/route.ts",
    {
      "@/lib/server/auth": {
        requireRoleOrSystemManager: async () => ({
          ok: true,
          auth: { role: "super_admin" },
          supabase: {
            rpc: async () => {
              rpcCalls += 1;
              return { data: null, error: null };
            },
          },
        }),
      },
    },
  );
  const response = await route.PUT(new Request("http://local/api/lanflow/admin/users/id/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: "null",
  }) as never, { params: Promise.resolve({ id: "20000000-0000-4000-8000-000000000002" }) });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ errorMessage: "ข้อมูลพนักงานไม่ถูกต้อง" });
  expect(rpcCalls).toBe(0);
});

test("LanFlow bootstrap redacts unexpected location diagnostics", async () => {
  const locationQuery = {
    select: () => locationQuery,
    eq: () => locationQuery,
    order: async () => ({ data: null, error: new Error(diagnostic) }),
  };
  const supabase = {
    rpc: async (name: string) => name === "get_branch_create_confirmation_minutes"
      ? { data: 15, error: null }
      : { data: null, error: null },
    from: () => locationQuery,
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/route")>(
    "src/app/api/lanflow/route.ts",
    {
      "@/lib/server/auth": {
        requireAuth: async () => ({
          ok: true,
          auth: {
            sub: "20000000-0000-4000-8000-000000000001",
            name: "ผู้ดูแล",
            phone: "0800000000",
            role: "admin",
            locationIds: [],
            primaryLocationId: null,
            canAccessSystemManager: true,
            canAccessMoneyTransfer: true,
            canManageTimePayroll: true,
          },
          supabase,
        }),
      },
      "@/lib/lanflow/rubber-weight-alert": {
        parseRubberWeightAlertConfig: () => null,
      },
    },
  );

  const response = await route.GET(new Request("http://local/api/lanflow") as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "โหลดข้อมูลเริ่มต้นไม่สำเร็จ" });
});

test("LanFlow bootstrap keeps rejected setting lookups inside its JSON boundary", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/route")>(
    "src/app/api/lanflow/route.ts",
    {
      "@/lib/server/auth": {
        requireAuth: async () => ({
          ok: true,
          auth: {
            sub: "20000000-0000-4000-8000-000000000001",
            name: "ผู้ดูแล",
            phone: "0800000000",
            role: "admin",
            locationIds: [],
            primaryLocationId: null,
            canAccessSystemManager: true,
            canAccessMoneyTransfer: true,
            canManageTimePayroll: true,
          },
          supabase: {
            rpc: async () => { throw new Error(diagnostic); },
          },
        }),
      },
      "@/lib/lanflow/rubber-weight-alert": {
        parseRubberWeightAlertConfig: () => null,
      },
    },
  );

  const response = await route.GET(new Request("http://local/api/lanflow") as never);

  expect(response.status).toBe(500);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).toEqual({ error: "โหลดข้อมูลเริ่มต้นไม่สำเร็จ" });
});

test("profile routes preserve delegated rubber-export access", async () => {
  const auth = {
    sub: "20000000-0000-4000-8000-000000000001",
    name: "ผู้ดูแล",
    phone: "0800000000",
    role: "admin",
    locationIds: ["10000000-0000-4000-8000-000000000001"],
    primaryLocationId: "10000000-0000-4000-8000-000000000001",
    canAccessSystemManager: false,
    canAccessMoneyTransfer: false,
    canManageTimePayroll: false,
    canManageRubberExports: true,
  };
  const locationQuery = {
    select: () => locationQuery,
    eq: () => locationQuery,
    order: async () => ({ data: [], error: null }),
  };
  const supabase = {
    rpc: async (name: string) => name === "get_branch_create_confirmation_minutes"
      ? { data: 15, error: null }
      : { data: { enabled: false }, error: null },
    from: () => locationQuery,
  };
  const requireAuth = async () => ({ ok: true as const, auth, supabase });
  const lanflowRoute = loadSourceModule<typeof import("../src/app/api/lanflow/route")>(
    "src/app/api/lanflow/route.ts",
    {
      "@/lib/server/auth": { requireAuth },
      "@/lib/lanflow/rubber-weight-alert": {
        parseRubberWeightAlertConfig: () => ({ enabled: false }),
      },
    },
  );
  const meRoute = loadSourceModule<typeof import("../src/app/api/auth/me/route")>(
    "src/app/api/auth/me/route.ts",
    { "@/lib/server/auth": { requireAuth } },
  );

  for (const response of [
    await lanflowRoute.GET(new Request("http://local/api/lanflow") as never),
    await meRoute.GET(new Request("http://local/api/auth/me") as never),
  ]) {
    expect(response.status).toBe(200);
    const profile = (await response.json()).profile;
    expect(profile.canManageRubberExports).toBe(true);
    expect(profile.isActive).toBe(true);
  }
});

for (const mutation of [
  { path: "role", body: { role: "admin" }, message: "อัปเดตบทบาทไม่สำเร็จ" },
  { path: "status", body: { isActive: false }, message: "อัปเดตสถานะบัญชีไม่สำเร็จ" },
  { path: "system-manager-access", body: { canAccessSystemManager: true }, message: "อัปเดตสิทธิ์ผู้จัดการระบบไม่สำเร็จ" },
  { path: "money-transfer-access", body: { canAccessMoneyTransfer: true }, message: "อัปเดตสิทธิ์โอนเงินไม่สำเร็จ" },
  { path: "time-payroll-access", body: { canManageTimePayroll: true }, message: "อัปเดตสิทธิ์เวลาและเงินเดือนไม่สำเร็จ" },
  { path: "rubber-export-access", body: { canManageRubberExports: true }, message: "อัปเดตสิทธิ์จัดการส่งออกยางไม่สำเร็จ" },
] as const) {
  test(`admin ${mutation.path} mutation redacts unexpected database diagnostics`, async () => {
    const route = loadSourceModule<{ PATCH: typeof import("../src/app/api/lanflow/admin/users/[id]/role/route").PATCH }>(
      `src/app/api/lanflow/admin/users/[id]/${mutation.path}/route.ts`,
      failingAdminMutationDependencies(),
    );
    const response = await route.PATCH(new Request(`http://local/api/lanflow/admin/users/target/${mutation.path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mutation.body),
    }) as never, { params: Promise.resolve({ id: "20000000-0000-4000-8000-000000000002" }) });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ errorMessage: mutation.message });
  });
}

for (const mutation of [
  { path: "role", body: { role: "admin" } },
  { path: "status", body: { isActive: false } },
  { path: "system-manager-access", body: { canAccessSystemManager: true } },
  { path: "money-transfer-access", body: { canAccessMoneyTransfer: true } },
  { path: "time-payroll-access", body: { canManageTimePayroll: true } },
  { path: "rubber-export-access", body: { canManageRubberExports: true } },
] as const) {
  test(`admin ${mutation.path} mutation rejects a malformed path id before database access`, async () => {
    let adminClientCalls = 0;
    const authorized = async () => ({
      ok: true,
      auth: { sub: "20000000-0000-4000-8000-000000000001", role: "super_admin" },
      supabase: {},
    });
    const route = loadSourceModule<{ PATCH: typeof import("../src/app/api/lanflow/admin/users/[id]/role/route").PATCH }>(
      `src/app/api/lanflow/admin/users/[id]/${mutation.path}/route.ts`,
      {
        "@/lib/server/auth": {
          requireRole: authorized,
          requireSystemManager: authorized,
        },
        "@/lib/server/supabase-admin": {
          createSupabaseAdminClient: () => {
            adminClientCalls += 1;
            throw new Error(diagnostic);
          },
        },
      },
    );
    const response = await route.PATCH(new Request(`http://local/api/lanflow/admin/users/not-a-uuid/${mutation.path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mutation.body),
    }) as never, { params: Promise.resolve({ id: "not-a-uuid" }) });

    expect(response.status).toBe(400);
    expect(adminClientCalls).toBe(0);
  });
}
