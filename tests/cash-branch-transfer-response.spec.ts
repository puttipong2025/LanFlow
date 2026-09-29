import { expect, test } from "@playwright/test";

import { cashTransferErrorResponse } from "../src/lib/server/cash-branch-transfer-response";

test("cash transfer responses preserve known business errors", async () => {
  const response = cashTransferErrorResponse("ไม่มีสิทธิ์ตรวจรับสาขานี้");
  const conflict = cashTransferErrorResponse("รายการนี้ถูกตรวจรับแล้ว");

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "ไม่มีสิทธิ์ตรวจรับสาขานี้" });
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({ error: "รายการนี้ถูกตรวจรับแล้ว" });
});

test("cash transfer responses redact unexpected database diagnostics", async () => {
  const response = cashTransferErrorResponse('invalid input syntax for type uuid: "not-a-uuid"');

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "ดำเนินการรายการเงินสดไม่สำเร็จ" });
});
