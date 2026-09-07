import { expect, test, type Browser } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:55421";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const userId = "00000000-0000-4000-8000-000000000003";

async function userContext(browser: Browser) {
  return browser.newContext({ storageState: "playwright/.auth/user.json" });
}

test("user payroll totals and histories remain complete beyond 1,000 rows", async ({ browser }) => {
  const user = await userContext(browser);
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const debtIds = Array.from({ length: 1_001 }, () => crypto.randomUUID());
  const deductionIds = Array.from({ length: 1_001 }, () => crypto.randomUUID());

  try {
    for (let from = 0; from < debtIds.length; from += 250) {
      expect((await db.from("financial_transactions").insert(
        debtIds.slice(from, from + 250).map((id) => ({
          id,
          profile_id: userId,
          type: "DEBT",
          amount: 1,
          remaining_amount: 1,
          effective_date: "2026-09-01",
          status: "APPROVED",
        })),
      )).error).toBeNull();
      expect((await db.from("financial_transactions").insert(
        deductionIds.slice(from, from + 250).map((id) => ({
          id,
          profile_id: userId,
          type: "DEBT_DEDUCTION",
          amount: 1,
          remaining_amount: 0,
          applied_month: "2026-09-01",
          status: "APPROVED",
        })),
      )).error).toBeNull();
    }

    const response = await user.request.get("/api/lanflow/time-tracking/user?month=2026-09");
    expect(response.ok(), await response.text()).toBeTruthy();
    const body = await response.json() as {
      wageInfo: { totalDebt: number };
      debts: Array<{ id: string }>;
      deductions: Array<{ id: string }>;
    };
    expect(body.wageInfo.totalDebt).toBeGreaterThanOrEqual(1_001);
    expect(debtIds.every((id) => body.debts.some((row) => row.id === id))).toBe(true);
    expect(deductionIds.every((id) => body.deductions.some((row) => row.id === id))).toBe(true);
  } finally {
    for (const ids of [deductionIds, debtIds]) {
      for (let from = 0; from < ids.length; from += 250) {
        await db.from("financial_transactions").delete().in("id", ids.slice(from, from + 250));
      }
    }
    await user.close();
  }
});

test("manager summary and historical withdrawal document use all deductions", async ({ browser }) => {
  const manager = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const profileId = crypto.randomUUID();
  const withdrawalId = crypto.randomUUID();
  const ids = Array.from({ length: 1_001 }, () => crypto.randomUUID());
  try {
    expect((await db.from("profiles").insert({
      id: profileId, name: "Historical totals fixture", phone: `09${Date.now().toString().slice(-8)}`,
      role: "user", is_active: true, daily_wage: 1_000,
    })).error).toBeNull();
    const enable = await manager.request.post("/api/lanflow/time-tracking/admin", { data: {
      action: "SET_PAYROLL_ACTIVE_PERIOD", payload: { user_id: profileId, action: "ENABLE", effective_date: "2026-08-01" },
    } });
    expect(enable.ok(), await enable.text()).toBe(true);
    expect((await db.from("financial_transactions").insert({
      id: withdrawalId, profile_id: profileId, type: "WITHDRAWAL", amount: 100,
      remaining_amount: 100, effective_date: "2026-08-31", status: "PENDING",
    })).error).toBeNull();
    for (let from = 0; from < ids.length; from += 250) {
      expect((await db.from("financial_transactions").insert(ids.slice(from, from + 250).flatMap((id) => [
        { id, profile_id: profileId, type: "DEBT", amount: 1, remaining_amount: 1, effective_date: "2026-08-01", status: "APPROVED" },
        { id: crypto.randomUUID(), profile_id: profileId, type: "DEBT_DEDUCTION", amount: 1, remaining_amount: 0, applied_month: "2026-08-01", status: "APPROVED" },
      ]))).error).toBeNull();
    }
    const summary = await manager.request.get("/api/lanflow/time-tracking/admin");
    expect(summary.ok(), await summary.text()).toBe(true);
    expect((await summary.json()).users.find((row: { id: string }) => row.id === profileId))
      .toMatchObject({ debt_remaining_amount: 1_001 });
    const user = await manager.request.get(`/api/lanflow/time-tracking/user?userId=${profileId}&month=2026-08`);
    expect(user.ok(), await user.text()).toBe(true);
    expect((await user.json()).wageInfo).toMatchObject({
      grossPay: 31_000, totalDebt: 1_001, remainingBalance: 29_999,
    });
    const document = await manager.request.get(`/api/lanflow/time-tracking/documents/withdrawal/${withdrawalId}`);
    expect(document.ok(), await document.text()).toBe(true);
    expect((await document.json()).summary).toContainEqual({
      label: "ค่าแรงคงเหลือหลังเบิก", value: "29,899 บาท",
    });
  } finally {
    await db.from("financial_transactions").delete().eq("profile_id", profileId);
    await db.from("time_tracking_audit_logs").delete().eq("record_id", profileId);
    await db.from("profiles").delete().eq("id", profileId);
    await manager.close();
  }
});
