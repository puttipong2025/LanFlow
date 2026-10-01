import { expect, test, type Browser } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:55421";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const userId = "00000000-0000-4000-8000-000000000003";

async function userContext(browser: Browser) {
  return browser.newContext({ storageState: "playwright/.auth/user.json" });
}

async function deleteRowsByIds(
  db: SupabaseClient<any, "public", "public", any, any>,
  table: "financial_transactions" | "payroll_slips" | "profiles",
  ids: string[],
) {
  for (let from = 0; from < ids.length; from += 100) {
    const { error } = await db.from(table).delete().in("id", ids.slice(from, from + 100));
    if (error) throw new Error(`Failed to clean ${table} fixture: ${error.message}`);
  }
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
    await deleteRowsByIds(db, "financial_transactions", deductionIds);
    await deleteRowsByIds(db, "financial_transactions", debtIds);
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

test("manager summary remains complete beyond 1,000 rows in each list", async ({ browser }) => {
  test.setTimeout(60_000);
  const manager = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const marker = Date.now().toString().slice(-4);
  const profileIds = Array.from({ length: 1_001 }, () => crypto.randomUUID());
  const transactionIds = Array.from({ length: 1_001 }, () => crypto.randomUUID());
  const slipIds = Array.from({ length: 1_001 }, () => crypto.randomUUID());
  const targetProfileId = profileIds[0];

  try {
    for (let from = 0; from < profileIds.length; from += 250) {
      const profileRows = profileIds.slice(from, from + 250).map((id, offset) => ({
        id,
        name: `Manager row-cap fixture ${from + offset}`,
        phone: `07${marker}${String(from + offset).padStart(4, "0")}`,
        role: "user",
        is_active: true,
        daily_wage: 1,
      }));
      expect((await db.from("profiles").insert(profileRows)).error).toBeNull();
    }

    for (let from = 0; from < transactionIds.length; from += 250) {
      expect((await db.from("financial_transactions").insert(
        transactionIds.slice(from, from + 250).map((id) => ({
          id,
          profile_id: targetProfileId,
          type: "DEBT",
          amount: 1,
          remaining_amount: 1,
          effective_date: "2026-09-01",
          status: "PENDING",
        })),
      )).error).toBeNull();
      expect((await db.from("payroll_slips").insert(
        slipIds.slice(from, from + 250).map((id) => ({
          id,
          profile_id: targetProfileId,
          month: "2026-09",
          created_by: targetProfileId,
          status: "PENDING",
        })),
      )).error).toBeNull();
    }

    const response = await manager.request.get("/api/lanflow/time-tracking/admin");
    expect(response.ok(), await response.text()).toBe(true);
    const body = await response.json() as {
      users: Array<{ id: string; period_state?: { hasPeriodHistory?: boolean } }>;
      pendingTransactions: Array<{ profile_id: string }>;
      pendingSlips: Array<{ profile_id: string }>;
    };
    const returnedIds = new Set(body.users.map((user) => user.id));

    expect({
      profiles: profileIds.filter((id) => returnedIds.has(id)).length,
      pendingTransactions: body.pendingTransactions.filter((row) => row.profile_id === targetProfileId).length,
      pendingSlips: body.pendingSlips.filter((row) => row.profile_id === targetProfileId).length,
    }).toEqual({
      profiles: profileIds.length,
      pendingTransactions: transactionIds.length,
      pendingSlips: slipIds.length,
    });

    const slipsResponse = await manager.request.post("/api/lanflow/time-tracking/admin", { data: {
      action: "LIST_PAYROLL_SLIPS",
      payload: { user_id: targetProfileId },
    } });
    expect(slipsResponse.ok(), await slipsResponse.text()).toBe(true);
    const listedSlips = (await slipsResponse.json() as { slips: Array<{ id: string }> }).slips;
    expect(listedSlips.filter((slip) => slipIds.includes(slip.id))).toHaveLength(slipIds.length);
  } finally {
    await deleteRowsByIds(db, "payroll_slips", slipIds);
    await deleteRowsByIds(db, "financial_transactions", transactionIds);
    await deleteRowsByIds(db, "profiles", profileIds);
    await manager.close();
  }
});

test("employee detail loads every withdrawal source referenced by adjustment history", async ({ browser }) => {
  test.setTimeout(60_000);
  const manager = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const profileId = crypto.randomUUID();
  const sourceIds = Array.from({ length: 1_051 }, () => crypto.randomUUID());
  const adjustmentIds = Array.from({ length: 1_051 }, () => crypto.randomUUID());

  try {
    expect((await db.from("profiles").insert({
      id: profileId,
      name: "Adjustment source row-cap fixture",
      phone: `06${Date.now().toString().slice(-8)}`,
      role: "user",
      is_active: true,
      daily_wage: 1,
    })).error).toBeNull();

    for (let from = 0; from < sourceIds.length; from += 250) {
      expect((await db.from("financial_transactions").insert(
        sourceIds.slice(from, from + 250).map((id) => ({
          id,
          profile_id: profileId,
          type: "WITHDRAWAL",
          amount: 1,
          remaining_amount: 1,
          effective_date: "2026-08-01",
          status: "APPROVED",
          approved_at: "2026-08-01T00:00:00Z",
        })),
      )).error).toBeNull();
      expect((await db.from("financial_transactions").insert(
        adjustmentIds.slice(from, from + 250).map((id, offset) => ({
          id,
          profile_id: profileId,
          type: "ADJUSTMENT",
          amount: 2,
          adjustment_base_amount: 1,
          parent_debt_id: sourceIds[from + offset],
          effective_date: "2026-08-01",
          status: "PENDING",
        })),
      )).error).toBeNull();
    }

    const response = await manager.request.get(`/api/lanflow/time-tracking/user?userId=${profileId}&month=2026-08`);
    expect(response.ok(), await response.text()).toBe(true);
    const body = await response.json() as { transactions: Array<{ id: string }> };
    const returnedIds = new Set(body.transactions.map((row) => row.id));
    expect(sourceIds.filter((id) => returnedIds.has(id))).toHaveLength(sourceIds.length);
  } finally {
    await deleteRowsByIds(db, "financial_transactions", adjustmentIds);
    await deleteRowsByIds(db, "financial_transactions", sourceIds);
    await db.from("profiles").delete().eq("id", profileId);
    await manager.close();
  }
});

test("employee detail keeps actionable pending transactions beyond the recent-history window", async ({ browser }) => {
  const manager = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const profileId = crypto.randomUUID();
  const pendingId = crypto.randomUUID();
  const approvedIds = Array.from({ length: 50 }, () => crypto.randomUUID());

  try {
    expect((await db.from("profiles").insert({
      id: profileId,
      name: "Pending history-window fixture",
      phone: `05${Date.now().toString().slice(-8)}`,
      role: "user",
      is_active: true,
      daily_wage: 1,
    })).error).toBeNull();
    expect((await db.from("financial_transactions").insert([
      ...approvedIds.map((id) => ({
        id,
        profile_id: profileId,
        type: "DEBT",
        amount: 1,
        remaining_amount: 1,
        effective_date: "2026-09-30",
        status: "APPROVED",
      })),
      {
        id: pendingId,
        profile_id: profileId,
        type: "DEBT",
        amount: 1,
        remaining_amount: 1,
        effective_date: "2026-01-01",
        status: "PENDING",
      },
    ])).error).toBeNull();

    const response = await manager.request.get(`/api/lanflow/time-tracking/user?userId=${profileId}&month=2026-09`);
    expect(response.ok(), await response.text()).toBe(true);
    const body = await response.json() as { transactions: Array<{ id: string }> };
    expect(body.transactions.some((transaction) => transaction.id === pendingId)).toBe(true);
  } finally {
    await deleteRowsByIds(db, "financial_transactions", [...approvedIds, pendingId]);
    await db.from("profiles").delete().eq("id", profileId);
    await manager.close();
  }
});

test("employee detail does not revive cancelled transactions or deductions", async ({ browser }) => {
  const manager = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const profileId = crypto.randomUUID();
  const activeDebtId = crypto.randomUUID();
  const cancelledDebtId = crypto.randomUUID();
  const cancelledPendingId = crypto.randomUUID();
  const cancelledDeductionId = crypto.randomUUID();
  const recentIds = Array.from({ length: 50 }, () => crypto.randomUUID());

  try {
    expect((await db.from("profiles").insert({
      id: profileId,
      name: "Cancelled transaction fixture",
      phone: `04${Date.now().toString().slice(-8)}`,
      role: "user",
      is_active: true,
      daily_wage: 1,
    })).error).toBeNull();
    expect((await db.from("financial_transactions").insert([
      ...recentIds.map((id) => ({
        id,
        profile_id: profileId,
        type: "DEBT",
        amount: 1,
        remaining_amount: 1,
        effective_date: "2026-09-30",
        status: "APPROVED",
      })),
      {
        id: activeDebtId,
        profile_id: profileId,
        type: "DEBT",
        amount: 2,
        remaining_amount: 2,
        effective_date: "2026-01-03",
        status: "APPROVED",
      },
      {
        id: cancelledDebtId,
        profile_id: profileId,
        type: "DEBT",
        amount: 3,
        remaining_amount: 3,
        effective_date: "2026-01-02",
        status: "APPROVED",
        cancelled_at: "2026-09-30T12:00:00Z",
      },
      {
        id: cancelledPendingId,
        profile_id: profileId,
        type: "DEBT",
        amount: 4,
        remaining_amount: 4,
        effective_date: "2026-01-01",
        status: "PENDING",
        cancelled_at: "2026-09-30T12:00:00Z",
      },
      {
        id: cancelledDeductionId,
        profile_id: profileId,
        type: "DEBT_DEDUCTION",
        parent_debt_id: activeDebtId,
        amount: 1,
        remaining_amount: 0,
        effective_date: "2026-09-01",
        applied_month: "2026-09-01",
        status: "APPROVED",
        cancelled_at: "2026-09-30T12:00:00Z",
      },
    ])).error).toBeNull();

    const response = await manager.request.get(`/api/lanflow/time-tracking/user?userId=${profileId}&month=2026-09`);
    expect(response.ok(), await response.text()).toBe(true);
    const body = await response.json() as {
      debts: Array<{ id: string }>;
      transactions: Array<{ id: string }>;
      deductions: Array<{ id: string }>;
    };
    expect(body.debts.some((row) => row.id === activeDebtId)).toBe(true);
    expect(body.debts.some((row) => row.id === cancelledDebtId)).toBe(false);
    expect(body.transactions.some((row) => row.id === cancelledPendingId)).toBe(false);
    expect(body.deductions.some((row) => row.id === cancelledDeductionId)).toBe(false);
  } finally {
    await deleteRowsByIds(db, "financial_transactions", [
      ...recentIds,
      activeDebtId,
      cancelledDebtId,
      cancelledPendingId,
      cancelledDeductionId,
    ]);
    await db.from("profiles").delete().eq("id", profileId);
    await manager.close();
  }
});

test("employee detail ignores a cancelled pending withdrawal adjustment", async ({ browser }) => {
  const manager = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const profileId = crypto.randomUUID();
  const withdrawalId = crypto.randomUUID();
  const adjustmentId = crypto.randomUUID();

  try {
    expect((await db.from("profiles").insert({
      id: profileId,
      name: "Cancelled adjustment fixture",
      phone: `03${Date.now().toString().slice(-8)}`,
      role: "user",
      is_active: true,
      daily_wage: 1,
    })).error).toBeNull();
    expect((await db.from("financial_transactions").insert({
      id: withdrawalId,
      profile_id: profileId,
      type: "WITHDRAWAL",
      amount: 100,
      remaining_amount: 100,
      effective_date: "2026-09-01",
      status: "APPROVED",
      approved_at: "2026-09-01T01:00:00Z",
    })).error).toBeNull();
    expect((await db.from("financial_transactions").insert({
      id: adjustmentId,
      profile_id: profileId,
      type: "ADJUSTMENT",
      amount: 80,
      adjustment_base_amount: 100,
      remaining_amount: 0,
      parent_debt_id: withdrawalId,
      effective_date: "2026-09-01",
      status: "PENDING",
      cancelled_at: "2026-09-02T01:00:00Z",
    })).error).toBeNull();

    const response = await manager.request.get(`/api/lanflow/time-tracking/user?userId=${profileId}&month=2026-09`);
    expect(response.ok(), await response.text()).toBe(true);
    const body = await response.json() as {
      adjustments: Array<{ id: string }>;
      adjustmentSummaries: Array<{ withdrawalId: string; pendingAdjustmentId: string | null }>;
    };
    expect(body.adjustments.some((row) => row.id === adjustmentId)).toBe(false);
    expect(body.adjustmentSummaries.find((row) => row.withdrawalId === withdrawalId)?.pendingAdjustmentId)
      .toBeNull();
  } finally {
    await deleteRowsByIds(db, "financial_transactions", [adjustmentId, withdrawalId]);
    await db.from("profiles").delete().eq("id", profileId);
    await manager.close();
  }
});

test("manager pending counts ignore adjustments whose withdrawal was cancelled", async ({ browser }) => {
  const manager = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const activeProfileId = crypto.randomUUID();
  const cancelledProfileId = crypto.randomUUID();
  const activeWithdrawalId = crypto.randomUUID();
  const cancelledWithdrawalId = crypto.randomUUID();
  const activeAdjustmentId = crypto.randomUUID();
  const orphanAdjustmentId = crypto.randomUUID();

  try {
    const location = await db.from("locations").select("id").eq("is_active", true).limit(1).single();
    expect(location.error).toBeNull();
    expect((await db.from("profiles").insert([
      {
        id: activeProfileId, name: "Active adjustment route fixture",
        phone: `02${Date.now().toString().slice(-8)}`, role: "user", is_active: true, daily_wage: 1,
      },
      {
        id: cancelledProfileId, name: "Orphan adjustment route fixture",
        phone: `01${Date.now().toString().slice(-8)}`, role: "user", is_active: true, daily_wage: 1,
      },
    ])).error).toBeNull();
    expect((await db.from("financial_transactions").insert([
      {
        id: activeWithdrawalId, profile_id: activeProfileId, type: "WITHDRAWAL",
        amount: 100, remaining_amount: 100, effective_date: "2026-09-01", status: "APPROVED",
        expense_location_id: location.data!.id, approved_by: "00000000-0000-4000-8000-000000000001",
        approved_at: "2026-09-01T02:00:00Z",
      },
      {
        id: cancelledWithdrawalId, profile_id: cancelledProfileId, type: "WITHDRAWAL",
        amount: 100, remaining_amount: 100, effective_date: "2026-09-01", status: "APPROVED",
        expense_location_id: location.data!.id, approved_by: "00000000-0000-4000-8000-000000000001",
        approved_at: "2026-09-01T02:00:00Z", cancelled_at: "2026-09-02T02:00:00Z",
        cancelled_by: "00000000-0000-4000-8000-000000000001",
      },
      {
        id: activeAdjustmentId, profile_id: activeProfileId, type: "ADJUSTMENT",
        amount: 120, remaining_amount: 0, effective_date: "2026-09-01", status: "PENDING",
        parent_debt_id: activeWithdrawalId, adjustment_base_amount: 100,
      },
      {
        id: orphanAdjustmentId, profile_id: cancelledProfileId, type: "ADJUSTMENT",
        amount: 120, remaining_amount: 0, effective_date: "2026-09-01", status: "PENDING",
        parent_debt_id: cancelledWithdrawalId, adjustment_base_amount: 100,
      },
    ])).error).toBeNull();

    const response = await manager.request.get("/api/lanflow/time-tracking/admin");
    expect(response.ok(), await response.text()).toBe(true);
    const pendingTransactions = (await response.json()).pendingTransactions as Array<{ profile_id: string }>;
    expect(pendingTransactions.filter((row) => row.profile_id === activeProfileId)).toHaveLength(1);
    expect(pendingTransactions.filter((row) => row.profile_id === cancelledProfileId)).toHaveLength(0);
  } finally {
    await db.from("financial_transactions").delete().in("id", [activeAdjustmentId, orphanAdjustmentId]);
    await db.from("financial_transactions").delete().in("id", [activeWithdrawalId, cancelledWithdrawalId]);
    await db.from("profiles").delete().in("id", [activeProfileId, cancelledProfileId]);
    await manager.close();
  }
});
