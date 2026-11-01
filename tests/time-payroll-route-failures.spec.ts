import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";
import { loadSourceModule } from "./helpers/load-source-module";

const id = "a7310000-0000-4000-8000-000000000004";

for (const sourceType of ["payroll", "withdrawal"]) for (const [message, status] of [
  ["Authentication required", 401], ["Forbidden", 403], ["private document database transport failure", 500],
] as const) test(`document ${sourceType} preserves post-authentication ${status} failures`, async () => {
  const query = {
    select: () => query, eq: () => query,
    maybeSingle: async () => ({ data: null, error: { message } }),
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/time-tracking/documents/[sourceType]/[id]/route")>(
    "src/app/api/lanflow/time-tracking/documents/[sourceType]/[id]/route.ts",
    { "@/lib/server/auth": { requireAuth: async () => ({ ok: true, supabase: { from: () => query } }) } },
  );
  const response = await route.GET(new NextRequest(`http://localhost/api/lanflow/time-tracking/documents/${sourceType}/${id}`), {
    params: Promise.resolve({ sourceType, id }),
  });
  expect(response.status).toBe(status);
  const body = await response.json();
  expect(body.error).not.toContain("private document");
  if (status === 401) expect(body.error).toContain("เข้าสู่ระบบ");
  if (status === 403) expect(body.error).toContain("สิทธิ์");
});

const dependencies = (rpc: () => Promise<unknown>) => ({
  "@/lib/server/auth": {
    requireAuth: async () => ({ ok: true, auth: { sub: id, canManageTimePayroll: true }, supabase: { rpc } }),
  },
});

test("document Route renders saved details when optional source metadata is malformed", async () => {
  const source = {
    id, profile_id: id, month: "2026-10", status: "APPROVED", cancelled_at: null,
    created_at: "2026-11-01T00:00:00Z", total_days: 10, daily_wage: 500,
    gross_pay: 5000, total_deductions: 1000, net_pay: 4000, approved_by: null,
    slip_data: { outstandingSources: {}, transactions: [
      { id: "legacy", type: "DEBT", status: "APPROVED", amount: 1000,
        effective_date: "2026-10-05", description: "ค่าซ่อมรถ" },
    ] },
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/time-tracking/documents/[sourceType]/[id]/route")>(
    "src/app/api/lanflow/time-tracking/documents/[sourceType]/[id]/route.ts",
    { "@/lib/server/auth": { requireAuth: async () => ({ ok: true, supabase: { from: (table: string) => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({
        data: table === "payroll_slips" ? source : { name: "พนักงาน", daily_wage: 500 }, error: null,
      }) };
      return query;
    } } }) } },
  );
  const response = await route.GET(new NextRequest(`http://localhost/api/lanflow/time-tracking/documents/payroll/${id}`), {
    params: Promise.resolve({ sourceType: "payroll", id }),
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.sourceRows).toEqual([{
    id: "legacy", label: "หนี้", dateLabel: "5 ต.ค. 2569", description: "ค่าซ่อมรถ", amount: 1000,
  }]);
  expect(body).not.toHaveProperty("deductionRows");
});

test("document Route keeps cancelled legacy debt out of an otherwise normal slip", async () => {
  const source = {
    id, profile_id: id, month: "2026-10", status: "APPROVED", cancelled_at: null,
    created_at: "2026-11-01T00:00:00Z", total_days: 20, daily_wage: 500,
    gross_pay: 10_000, total_deductions: 0, net_pay: 10_000, approved_by: null,
    slip_data: { transactions: [
      { id: "cancelled-debt", type: "DEBT", status: "APPROVED", amount: 1000,
        effective_date: "2026-10-05", cancelled_at: "2026-10-10T00:00:00Z" },
    ], outstandingAdjustments: { beforeDeductions: 0, deductedThisSlip: 0, remainingAfterDeductions: 0 } },
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/time-tracking/documents/[sourceType]/[id]/route")>(
    "src/app/api/lanflow/time-tracking/documents/[sourceType]/[id]/route.ts",
    { "@/lib/server/auth": { requireAuth: async () => ({ ok: true, supabase: { from: (table: string) => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({
        data: table === "payroll_slips" ? source : { name: "พนักงาน", daily_wage: 500 }, error: null,
      }) };
      return query;
    } } }) } },
  );
  const response = await route.GET(new NextRequest(`http://localhost/api/lanflow/time-tracking/documents/payroll/${id}`), {
    params: Promise.resolve({ sourceType: "payroll", id }),
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.sourceRows).toEqual([]);
  expect(body.summary).toEqual([
    { label: "ค่าแรงรวม", value: "10,000.00 บาท" },
    { label: "เงินเดือนสุทธิที่ต้องจ่าย", value: "10,000.00 บาท" },
  ]);
});

for (const rpcName of ["get_time_payroll_user_totals", "get_time_payroll_attendance_month"]) {
  test(`withdrawal document preserves authentication failures in ${rpcName}`, async () => {
    const source = { id, profile_id: id, type: "WITHDRAWAL", status: "APPROVED", cancelled_at: null,
      effective_date: "2026-10-05", created_at: "2026-10-05T00:00:00Z", approved_by: null,
      amount: 1000, remaining_amount: 0 };
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/time-tracking/documents/[sourceType]/[id]/route")>(
      "src/app/api/lanflow/time-tracking/documents/[sourceType]/[id]/route.ts",
      { "@/lib/server/auth": { requireAuth: async () => ({ ok: true, supabase: {
        from: (table: string) => {
          const query = { select: () => query, eq: () => query, maybeSingle: async () => ({
            data: table === "financial_transactions" ? source : { name: "พนักงาน", daily_wage: 500 }, error: null,
          }) };
          return query;
        },
        rpc: async (name: string) => ({ data: { mode: "EXCEPTIONS" },
          error: name === rpcName ? { message: "Authentication required" } : null }),
      } }) } },
    );
    const response = await route.GET(new NextRequest(`http://localhost/api/lanflow/time-tracking/documents/withdrawal/${id}`), {
      params: Promise.resolve({ sourceType: "withdrawal", id }),
    });
    expect(response.status).toBe(401);
    expect((await response.json()).error).toContain("เข้าสู่ระบบ");
  });
}

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
