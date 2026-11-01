import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";
import { loadSourceModule } from "./helpers/load-source-module";
import type { AttendanceMonthDto } from "../src/lib/time-tracking/attendance-contract";
const id = "7ef10000-0000-4000-8000-000000000041";

for (const action of ["replace", "correct"] as const) for (const [status, body] of [
  [400, "invalid JSON"], [200, "invalid JSON"], [200, "null"],
] as const) test(`${action} attendance keeps HTTP ${status} result when response is ${body}`, async () => {
  let reads = 0;
  const locks: boolean[] = [];
  const notices: string[] = [];
  const { createEmployeeAttendanceActions } = loadSourceModule<typeof import("../src/components/time-tracking/employee/employee-attendance-actions")>(
    "src/components/time-tracking/employee/employee-attendance-actions.ts", {
      "@/lib/auth-fetch": { authFetch: async () => new Response(body, { status }) },
      sonner: { toast: { success: (message: string) => notices.push(message) } },
    },
  );
  const attendance: AttendanceMonthDto = { month: "2026-10", revision: "b".repeat(32), mode: "EXCEPTIONS",
    workdayEndTime: "16:00", eligibleThrough: "2026-10-31", periods: [], exceptions: [],
    summary: { fullDays: 0, halfDays: 0, offDays: 0, paidDays: 0, grossPay: 0 } };
  const actions = createEmployeeAttendanceActions({ online: true, canConfigure: true, attendance,
    managedUserId: id, setMutation: next => { locks.push(next); return true; },
    loadData: async () => { reads++; } });
  const result = await (action === "replace" ? actions.replaceAttendanceExceptions([], attendance.revision)
    : actions.correctPayrollPeriodStart(id, "2026-10-01"));
  expect(locks).toEqual([true, false]);
  if (status === 200) {
    expect(result).toBeNull();
    expect(reads).toBe(1);
    expect(notices).toHaveLength(1);
  } else {
    expect(result).toEqual(expect.any(String));
    expect(reads).toBe(0);
    expect(notices).toHaveLength(0);
  }
});

for (const expected of [undefined,"invalid","b".repeat(32)]) test(`attendance route checks and forwards revision ${expected ?? "missing"}`, async () => {
  let called = false;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/time-tracking/admin/route")>(
    "src/app/api/lanflow/time-tracking/admin/route.ts", { "@/lib/server/auth": {
      requireAuth: async () => ({ ok: true, auth: { sub: id, canManageTimePayroll: true }, supabase: {
        rpc: async (name: string, args: Record<string, unknown>) => {
          called = true;
          expect(name).toBe("replace_time_payroll_attendance_exceptions");
          expect(args.p_expected_revision).toBe(expected);
          return { data: null, error: { message: "ATTENDANCE_STALE" } };
        },
      } }),
    } },
  );
  const response = await route.POST(new NextRequest("http://localhost/api/lanflow/time-tracking/admin", {
    method: "POST", body: JSON.stringify({ action: "REPLACE_ATTENDANCE_EXCEPTIONS",
      payload: { user_id: id, month: "2026-10", selections: [], expected_revision: expected } }),
  }));
  expect(response.status).toBe(expected?.length === 32 ? 409 : 400);
  expect(called).toBe(expected?.length === 32);
  if (called) expect(await response.json()).toMatchObject({ code: "ATTENDANCE_STALE", error: "ข้อมูลเปลี่ยน กรุณาโหลดใหม่" });
});
