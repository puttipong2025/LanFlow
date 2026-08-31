import { expect, request as playwrightRequest, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const userId = "00000000-0000-4000-8000-000000000003";
const superAdminId = "00000000-0000-4000-8000-000000000001";

test("withdrawal documents use one attendance snapshot for the total and calendar", () => {
  const routeSource = readFileSync(
    resolve("src/app/api/lanflow/time-tracking/documents/[sourceType]/[id]/route.ts"),
    "utf8",
  );

  expect(routeSource).not.toContain('rpc("calculate_paid_work_days"');
  expect(routeSource).toContain("totalPaidDays: Number(attendanceResponse.data?.summary?.paidDays) || 0");
});

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
      gross_pay: 1250,
      total_deductions: 250,
      net_pay: 1000,
      total_days: 2.5,
      daily_wage: 500,
      slip_data: {
        attendance: {
          month: "2049-02",
          mode: "EXCEPTIONS",
          workdayEndTime: "16:00",
          eligibleThrough: "2049-02-04",
          periods: [{ id: crypto.randomUUID(), startOn: "2049-02-01", endOn: null }],
          exceptions: [
            { date: "2049-02-02", status: "HALF_DAY" },
            { date: "2049-02-03", status: "OFF" },
          ],
          summary: { fullDays: 2, halfDays: 1, offDays: 1, paidDays: 2.5, grossPay: 1250 },
        },
        segments: [],
        transactions: [],
      },
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
      const payrollDocument = await payrollResponse.json();
      expect(payrollDocument).toMatchObject({
        kind: "payroll",
        sourceId: payrollId,
        status: "PENDING",
        title: "สลิปเงินเดือน",
        paymentLabel: null,
      });
      expect(payrollDocument.calendar).toHaveLength(28);
      expect(payrollDocument.calendar.slice(0, 4)).toEqual([
        { date: "2049-02-01", day: 1, paidDays: 1 },
        { date: "2049-02-02", day: 2, paidDays: 0.5 },
        { date: "2049-02-03", day: 3, paidDays: 0 },
        { date: "2049-02-04", day: 4, paidDays: 1 },
      ]);
      expect(payrollDocument.calendar.reduce(
        (sum: number, day: { paidDays: number }) => sum + day.paidDays,
        0,
      )).toBe(2.5);

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
