import { expect, test } from "@playwright/test";
import { rpcErrorMessage, rpcErrorStatus } from "@/lib/server/time-payroll-rpc-errors";
import { cashCountLockResponse } from "@/lib/server/cash-count-lock-response";

test("adjustment conflicts explain the actual document, pending work or stale target", () => {
  const cases = [
    ["REPORT_LOCKED:RPT-20261031-007", "RPT-20261031-007"],
    ["MONTH_CLOSED:2026-10:PAYROLL_SLIP:PENDING:a7310000-0000-4000-8000-000000000006", "a7310000-0000-4000-8000-000000000006"],
    ["ADJUSTMENT_NOT_LATEST", "เฉพาะการปรับยอดล่าสุด"],
    ["ADJUSTMENT_PENDING_EXISTS", "รออนุมัติ"],
    ["ADJUSTMENT_NOT_FOUND", "อาจถูกลบแล้ว"],
    ["CASH_COUNT_ACTIVE", "กำลังนับเงิน"],
  ];
  for (const [error, explanation] of cases) {
    expect(rpcErrorStatus(error)).toBe(409);
    expect(rpcErrorMessage(error)).toContain(explanation);
  }
  expect(rpcErrorStatus("Existing expense location access denied")).toBe(403);
});

test("overdue cash lock retains the shared error code and an actionable Thai reason", async () => {
  const result = cashCountLockResponse("CASH_COUNT_OVERDUE_LOCKED");
  expect(result?.status).toBe(409);
  expect(await result!.json()).toMatchObject({ errorCode: "CASH_COUNT_OVERDUE_LOCKED" });
  expect(cashCountLockResponse("ADJUSTMENT_NOT_LATEST")).toBeNull();
});
