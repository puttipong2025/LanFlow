import { expect, request as playwrightRequest, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const userId = "00000000-0000-4000-8000-000000000003";
const superAdminId = "00000000-0000-4000-8000-000000000001";

test("document API follows source-row RLS and excludes rejected, cancelled, and deleted rows", async () => {
  expect(serviceRoleKey).toBeTruthy();
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const pendingId = crypto.randomUUID();
  const rejectedId = crypto.randomUUID();
  const cancelledId = crypto.randomUUID();
  const payrollId = crypto.randomUUID();

  try {
    const transactions = await service.from("financial_transactions").insert([
      {
        id: pendingId,
        profile_id: userId,
        type: "WITHDRAWAL",
        amount: 7000,
        remaining_amount: 7000,
        status: "PENDING",
        effective_date: "2049-02-02",
        description: "ทดสอบเอกสาร",
      },
      {
        id: rejectedId,
        profile_id: userId,
        type: "WITHDRAWAL",
        amount: 500,
        remaining_amount: 500,
        status: "REJECTED",
        effective_date: "2049-02-02",
      },
      {
        id: cancelledId,
        profile_id: userId,
        type: "WITHDRAWAL",
        amount: 500,
        remaining_amount: 500,
        status: "PENDING",
        effective_date: "2049-02-02",
        cancelled_at: "2049-02-03T00:00:00.000Z",
        cancelled_by: superAdminId,
      },
    ]);
    expect(transactions.error).toBeNull();

    const payroll = await service.from("payroll_slips").insert({
      id: payrollId,
      profile_id: userId,
      month: "2049-02",
      gross_pay: 5000,
      total_deductions: 2000,
      net_pay: 3000,
      total_days: 10,
      daily_wage: 500,
      slip_data: { segments: [], transactions: [] },
      status: "PENDING",
      created_by: superAdminId,
    });
    expect(payroll.error).toBeNull();

    const request = await playwrightRequest.newContext({
      baseURL: "http://127.0.0.1:3000",
      storageState: "playwright/.auth/user.json",
    });
    try {
      const pending = await request.get(`/api/lanflow/time-tracking/documents/withdrawal/${pendingId}`);
      expect(pending.status(), await pending.text()).toBe(200);
      const pendingDocument = await pending.json();
      expect(pendingDocument).toMatchObject({
        kind: "withdrawal",
        sourceId: pendingId,
        status: "PENDING",
        title: "สลิปเบิกเงิน",
        amount: 7000,
        paymentLabel: null,
      });

      const managerRequest = await playwrightRequest.newContext({
        baseURL: "http://127.0.0.1:3000",
        storageState: "playwright/.auth/super_admin.json",
      });
      const outsideRequest = await playwrightRequest.newContext({
        baseURL: "http://127.0.0.1:3000",
        storageState: "playwright/.auth/admin.json",
      });
      try {
        expect((await managerRequest.get(`/api/lanflow/time-tracking/documents/withdrawal/${pendingId}`)).status()).toBe(200);
        expect((await outsideRequest.get(`/api/lanflow/time-tracking/documents/withdrawal/${pendingId}`)).status()).toBe(404);
      } finally {
        await managerRequest.dispose();
        await outsideRequest.dispose();
      }

      const payrollResponse = await request.get(`/api/lanflow/time-tracking/documents/payroll/${payrollId}`);
      expect(payrollResponse.status(), await payrollResponse.text()).toBe(200);
      expect(await payrollResponse.json()).toMatchObject({
        kind: "payroll",
        sourceId: payrollId,
        status: "PENDING",
        title: "สลิปเงินเดือน",
        paymentLabel: null,
      });

      for (const id of [rejectedId, cancelledId]) {
        const response = await request.get(`/api/lanflow/time-tracking/documents/withdrawal/${id}`);
        expect(response.status()).toBe(404);
      }

      expect((await service.from("financial_transactions").delete().eq("id", pendingId)).error).toBeNull();
      const deleted = await request.get(`/api/lanflow/time-tracking/documents/withdrawal/${pendingId}`);
      expect(deleted.status()).toBe(404);
    } finally {
      await request.dispose();
    }
  } finally {
    await service.from("payroll_slips").delete().eq("id", payrollId);
    await service.from("financial_transactions").delete().in("id", [pendingId, rejectedId, cancelledId]);
  }
});
