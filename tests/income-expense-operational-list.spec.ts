import { expect, test } from "@playwright/test";

import {
  incomeExpenseSyncProblems,
  mergeIncomeExpenseLocalEvents,
  mergeIncomeExpenseOperationalLatestPages,
  normalizeIncomeExpenseSearch,
} from "../src/lib/income-expense/operational-list";
import { cashBranchTransferQueryKeys } from "../src/lib/income-expense/query-keys";
import type { SyncEvent } from "../src/lib/idb-queue";

const ownerUserId = "owner";
const locationId = "location";

function event(patch: Partial<SyncEvent> = {}): SyncEvent {
  const id = patch.id ?? "local-record";
  return {
    queueId: 1,
    id,
    entity: "income_expense",
    ownerUserId,
    locationId,
    operation: "create",
    timestamp: 1,
    status: "pending",
    payload: {
      clientTempId: id,
      idempotencyKey: `create:${id}:0`,
      locationId,
      localBillNo: `LOCAL-${id}`,
      type: "expense",
      txDate: "2026-08-25",
      title: "ค่าขนส่ง",
      cost: 100,
      billOption: "ค่าใช้จ่าย",
      clientCreatedAt: "2026-08-25T00:00:00.000Z",
      clientRecordedAt: "2026-08-25T00:00:00.000Z",
      expectedRevisionNo: 0,
    },
    ...patch,
  } as SyncEvent;
}

function eventWithPayload(payloadPatch: Record<string, unknown>, patch: Partial<SyncEvent> = {}) {
  const id = patch.id ?? "local-record";
  return event({
    ...patch,
    payload: {
      ...(event().payload as Record<string, unknown>),
      clientTempId: id,
      idempotencyKey: `create:${id}:0`,
      ...payloadPatch,
    },
  });
}

test("normalizes a server search term and keeps local pending create in the latest projection", () => {
  expect(normalizeIncomeExpenseSearch("  ค่า\n ขนส่ง  ")).toBe("ค่า ขนส่ง");

  const rows = mergeIncomeExpenseLocalEvents([], [event()], "ค่าขนส่ง");

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ clientTempId: "local-record", syncStatus: "pending" });
});

test("projects only failed and conflict queue records oldest first", () => {
  const rows = incomeExpenseSyncProblems([
    event({ id: "pending", timestamp: 1, status: "pending" }),
    event({ id: "conflict", timestamp: 20, status: "conflict" }),
    event({ id: "failed", timestamp: 10, status: "failed" }),
  ]);

  expect(rows.map((row) => [row.clientTempId, row.syncStatus])).toEqual([
    ["failed", "failed"],
    ["conflict", "conflict"],
  ]);
});

test("filters sync problems by a searchable field without matching amount and preserves queue order", () => {
  const rows = [
    eventWithPayload({ localBillNo: "IE-101" }, { id: "number", timestamp: 30, status: "failed" }),
    eventWithPayload({ txDate: "2026-08-01" }, { id: "date", timestamp: 20, status: "conflict" }),
    eventWithPayload({ title: "ค่าซ่อมเครื่องจักร" }, { id: "title", timestamp: 10, status: "failed" }),
    eventWithPayload({ billOption: "ค่าดำเนินงาน" }, { id: "category", timestamp: 40, status: "conflict" }),
    eventWithPayload({ createdByName: "สมชาย ผู้บันทึก", createdByPhone: "0812345678" }, { id: "creator", timestamp: 50, status: "failed" }),
  ];

  expect(incomeExpenseSyncProblems(rows).map((row) => row.clientTempId)).toEqual([
    "title",
    "date",
    "number",
    "category",
    "creator",
  ]);
  expect(incomeExpenseSyncProblems(rows, "IE-101").map((row) => row.clientTempId)).toEqual(["number"]);
  expect(incomeExpenseSyncProblems(rows, "2026-08-01").map((row) => row.clientTempId)).toEqual(["date"]);
  expect(incomeExpenseSyncProblems(rows, "เครื่องจักร").map((row) => row.clientTempId)).toEqual(["title"]);
  expect(incomeExpenseSyncProblems(rows, "ดำเนินงาน").map((row) => row.clientTempId)).toEqual(["category"]);
  expect(incomeExpenseSyncProblems(rows, "สมชาย").map((row) => row.clientTempId)).toEqual(["creator"]);
  expect(incomeExpenseSyncProblems(rows, "0812345678").map((row) => row.clientTempId)).toEqual(["creator"]);
  expect(incomeExpenseSyncProblems(rows, "100")).toEqual([]);
});

function serverRow(id: string, title: string) {
  return {
    ...mergeIncomeExpenseLocalEvents([], [event({ id })], "")[0]!,
    id: `server-${id}`,
    clientTempId: id,
    number: `IE-${id}`,
    title,
    syncStatus: "synced" as const,
  };
}

test("overlays a queued update on its authoritative record loaded on page 2 without duplication", () => {
  const pageOne = serverRow("page-one", "รายการหน้าแรก");
  const pageTwo = serverRow("page-two", "ก่อนแก้ไข");
  const queuedUpdate = eventWithPayload(
    { clientTempId: "page-two", title: "หลังแก้ไข", clientRecordedAt: "2026-08-25T12:00:00.000Z" },
    { id: "queue-update-page-two", operation: "update", status: "pending", timestamp: 2 },
  );

  const rows = mergeIncomeExpenseOperationalLatestPages([
    { rows: [pageOne] },
    { rows: [pageTwo] },
  ], [queuedUpdate], "");

  expect(rows.filter((row) => row.clientTempId === "page-two")).toEqual([
    expect.objectContaining({ id: "server-page-two", title: "หลังแก้ไข", syncStatus: "pending" }),
  ]);
});

test("hides a pending delete when its authoritative record was loaded on page 2", () => {
  const pageOne = serverRow("page-one", "รายการหน้าแรก");
  const pageTwo = serverRow("page-two", "ต้องถูกซ่อน");
  const queuedDelete = event({ id: "page-two", operation: "delete", status: "pending", timestamp: 2 });

  const rows = mergeIncomeExpenseOperationalLatestPages([
    { rows: [pageOne] },
    { rows: [pageTwo] },
  ], [queuedDelete], "");

  expect(rows.map((row) => row.clientTempId)).toEqual(["page-one"]);
});

test("projects one conflicted record when its authoritative record was loaded on page 2", () => {
  const pageOne = serverRow("page-one", "รายการหน้าแรก");
  const pageTwo = serverRow("page-two", "ก่อนชนกัน");
  const conflict = eventWithPayload(
    { title: "ข้อมูลชนกัน" },
    { id: "page-two", operation: "update", status: "conflict", timestamp: 2, errorMessage: "revision ไม่ตรง" },
  );

  const rows = mergeIncomeExpenseOperationalLatestPages([
    { rows: [pageOne] },
    { rows: [pageTwo] },
  ], [conflict], "");

  expect(rows.filter((row) => row.clientTempId === "page-two")).toEqual([
    expect.objectContaining({ id: "server-page-two", title: "ข้อมูลชนกัน", syncStatus: "conflict", syncErrorMessage: "revision ไม่ตรง" }),
  ]);
});

test("places a truly local create in the latest projection across loaded pages", () => {
  const pageOne = {
    ...serverRow("page-one", "รายการหน้าแรก"),
    clientRecordedAt: "2026-08-25T10:00:00.000Z",
  };
  const pageTwo = {
    ...serverRow("page-two", "รายการหน้าสอง"),
    txDate: "2026-08-24",
    clientRecordedAt: "2026-08-24T10:00:00.000Z",
  };
  const localCreate = eventWithPayload(
    { clientRecordedAt: "2026-08-25T12:00:00.000Z" },
    { id: "local-create", timestamp: 3 },
  );

  const rows = mergeIncomeExpenseOperationalLatestPages([
    { rows: [pageOne] },
    { rows: [pageTwo] },
  ], [localCreate], "");

  expect(rows.map((row) => row.clientTempId)).toEqual(["local-create", "page-one", "page-two"]);
});

test("scopes cash summary and detail keys by owner and selected location", () => {
  expect(cashBranchTransferQueryKeys.pending("owner-a", "location-a")).toEqual([
    "cashBranchTransfers", "owner-a", "pending", "location-a",
  ]);
  expect(cashBranchTransferQueryKeys.detail("owner-a", "location-a", "transfer-a")).toEqual([
    "cashBranchTransfers", "owner-a", "detail", "location-a", "transfer-a",
  ]);
});
