import { expect, test } from "@playwright/test";
import { parsePendingWorkApiBody } from "../src/lib/pending-work-blockers";
import {
  pendingWorkErrorResponse,
  PENDING_WORK_BLOCKED,
} from "../src/lib/server/pending-work-response";

test.use({ storageState: { cookies: [], origins: [] } });

test("maps valid database details to an ordered, labeled 409 response", async () => {
  const response = pendingWorkErrorResponse({
    code: "P0001",
    message: PENDING_WORK_BLOCKED,
    details: JSON.stringify({
      blockers: [
        { key: "stock_entry_delete_pending", count: 3 },
        { key: "rubber_bill_pending", count: 1 },
      ],
    }),
  });

  expect(response?.status).toBe(409);
  expect(await response?.json()).toEqual({
    error: "ยังมีงานค้างที่ต้องจัดการก่อนดำเนินการ",
    blockers: [
      { key: "rubber_bill_pending", label: "บิลยางที่ยังไม่พร้อม", count: 1 },
      { key: "stock_entry_delete_pending", label: "คำขอลบรายการสต็อก", count: 3 },
    ],
  });
});

for (const [name, details] of [
  ["malformed JSON", "not-json"],
  ["unknown key", JSON.stringify({ blockers: [{ key: "future_blocker", count: 1 }] })],
  ["inherited object key", JSON.stringify({ blockers: [{ key: "toString", count: 1 }] })],
  ["zero count", JSON.stringify({ blockers: [{ key: "rubber_bill_pending", count: 0 }] })],
  ["unsafe count", JSON.stringify({ blockers: [{ key: "rubber_bill_pending", count: Number.MAX_SAFE_INTEGER + 1 }] })],
  ["duplicate key", JSON.stringify({ blockers: [
    { key: "rubber_bill_pending", count: 1 },
    { key: "rubber_bill_pending", count: 2 },
  ] })],
  ["unexpected field", JSON.stringify({ blockers: [{ key: "rubber_bill_pending", count: 1, ids: ["secret"] }] })],
] as const) {
  test(`fails closed for ${name} without returning raw diagnostics`, async () => {
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      const response = pendingWorkErrorResponse({
        code: "P0001",
        message: PENDING_WORK_BLOCKED,
        details,
      });
      expect(response?.status).toBe(500);
      const body = await response?.json();
      expect(body).toEqual({ error: "ตรวจสอบงานค้างไม่สำเร็จ กรุณาลองใหม่" });
      expect(JSON.stringify(body)).not.toContain("future_blocker");
      expect(JSON.stringify(body)).not.toContain("secret");
      expect(JSON.stringify(body)).not.toContain("not-json");
    } finally {
      console.error = originalConsoleError;
    }
  });
}

test("ignores unrelated database errors", () => {
  expect(pendingWorkErrorResponse({ message: "CASH_COUNT_ACTIVE", details: null })).toBeNull();
});

test("client parser accepts the public response shape and rejects unknown keys", () => {
  expect(parsePendingWorkApiBody({
    error: "blocked",
    blockers: [{
      key: "cash_transfer_receipt_pending",
      label: "เงินสดโอนเข้าสาขาที่ยังไม่รับ",
      count: 2,
    }],
  })).toEqual([{
    key: "cash_transfer_receipt_pending",
    label: "เงินสดโอนเข้าสาขาที่ยังไม่รับ",
    count: 2,
  }]);
  expect(parsePendingWorkApiBody({
    blockers: [{ key: "unknown", label: "raw", count: 2 }],
  })).toBeNull();
});

test("maps branch receipt and branch deletion blockers for Report and Cash Count", async () => {
  const response = pendingWorkErrorResponse({
    message: PENDING_WORK_BLOCKED,
    details: JSON.stringify({ blockers: [
      { key: "branch_transfer_delete_pending", count: 1 },
      { key: "branch_transfer_receipt_pending", count: 2 },
    ] }),
  });
  expect(response?.status).toBe(409);
  expect((await response?.json()).blockers).toEqual([
    { key: "branch_transfer_receipt_pending", label: "เงินโอนเข้าบัญชีสาขาที่ยังไม่ยืนยันรับ", count: 2 },
    { key: "branch_transfer_delete_pending", label: "คำขอลบรายการโอนเข้าบัญชีสาขา", count: 1 },
  ]);
});
