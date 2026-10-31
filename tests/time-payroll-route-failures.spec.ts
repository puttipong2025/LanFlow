import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";
import { loadSourceModule } from "./helpers/load-source-module";

const id = "a7310000-0000-4000-8000-000000000004";
const dependencies = (rpc: () => Promise<unknown>) => ({
  "@/lib/server/auth": {
    requireAuth: async () => ({ ok: true, auth: { sub: id, canManageTimePayroll: true }, supabase: { rpc } }),
  },
});

for (const [action, payload] of [
  ["REQUEST_WITHDRAWAL", { amount: 1200 }],
  ["REQUEST_WITHDRAWAL_ADJUSTMENT", { withdrawal_id: id, target_amount: 1200 }],
  ["WITHDRAW_WITHDRAWAL_ADJUSTMENT", { adjustment_id: id }],
  ["DELETE_TRANSACTION", { transaction_id: id }],
] as const) test(`employee ${action} converts an unexpected RPC exception into redacted JSON`, async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/time-tracking/user/route")>(
    "src/app/api/lanflow/time-tracking/user/route.ts",
    dependencies(async () => { throw new Error("private time tracking transport failure"); }),
  );
  const response = await route.POST(new NextRequest("http://localhost/api/lanflow/time-tracking/user", {
    method: "POST", body: JSON.stringify({ action, payload }),
  }));
  expect(response.status).toBe(500);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toMatchObject({ error: "ดำเนินการข้อมูลเวลาและเงินเดือนไม่สำเร็จ" });
});

test("returned business errors retain their status and validation stops before the RPC", async () => {
  let calls = 0;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/time-tracking/user/route")>(
    "src/app/api/lanflow/time-tracking/user/route.ts",
    dependencies(async () => { calls++; return { data: null, error: { message: "ADJUSTMENT_PENDING_EXISTS" } }; }),
  );
  const invalid = await route.POST(new NextRequest("http://localhost/api/lanflow/time-tracking/user", {
    method: "POST", body: JSON.stringify({ action: "REQUEST_WITHDRAWAL_ADJUSTMENT", payload: { withdrawal_id: id, target_amount: "1200" } }),
  }));
  expect(invalid.status).toBe(400);
  expect(calls).toBe(0);
  const conflict = await route.POST(new NextRequest("http://localhost/api/lanflow/time-tracking/user", {
    method: "POST", body: JSON.stringify({ action: "REQUEST_WITHDRAWAL_ADJUSTMENT", payload: { withdrawal_id: id, target_amount: 1200 } }),
  }));
  expect(conflict.status).toBe(409);
  expect((await conflict.json()).error).toContain("รออนุมัติ");
  expect(calls).toBe(1);
});

test("employee route preserves an authentication failure returned after waiting in an RPC", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/time-tracking/user/route")>(
    "src/app/api/lanflow/time-tracking/user/route.ts",
    dependencies(async () => ({ data: null, error: { message: "Authentication required" } })),
  );
  const response = await route.POST(new NextRequest("http://localhost/api/lanflow/time-tracking/user", {
    method: "POST", body: JSON.stringify({ action: "REQUEST_WITHDRAWAL_ADJUSTMENT", payload: { withdrawal_id: id, target_amount: 1200 } }),
  }));
  expect(response.status).toBe(401);
  expect((await response.json()).error).toContain("เข้าสู่ระบบ");
});

for (const endpoint of ["user", "admin"] as const) for (const [message, status] of [
  ["Authentication required", 401], ["Forbidden", 403], ["private database transport failure", 500],
] as const) test(`${endpoint} GET preserves the ${status} result after route authentication`, async () => {
  const empty = { data: [], error: null };
  const query = {
    select: () => query, eq: () => query, in: () => query, is: () => query,
    gt: () => query, order: () => query, limit: () => Promise.resolve(empty), range: () => Promise.resolve(empty),
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/time-tracking/user/route")>(
    `src/app/api/lanflow/time-tracking/${endpoint}/route.ts`,
    { "@/lib/server/auth": { requireAuth: async () => ({
      ok: true, auth: { sub: id, canManageTimePayroll: true },
      supabase: { from: () => query, rpc: async (name: string) => ({ data: null, error:
        name === (endpoint === "user" ? "get_withdrawal_adjustment_summaries" : "get_time_payroll_manager_overview")
          ? { message } : null }), },
    }) } },
  );
  const response = await route.GET(new NextRequest(`http://localhost/api/lanflow/time-tracking/${endpoint}`));
  expect(response.status).toBe(status);
  const body = await response.json();
  expect(body.error).toEqual(expect.any(String));
  expect(body.error).not.toContain("private database");
  if (status === 401) expect(body.error).toContain("เข้าสู่ระบบ");
  if (status === 403) expect(body.error).toContain("สิทธิ์");
});
