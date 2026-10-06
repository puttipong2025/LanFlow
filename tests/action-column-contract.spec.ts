import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPendingServerActionBlockReason } from "@/lib/record-action-locks";

const tables = [
  "src/components/CustomersModule.tsx",
  "src/components/TransportModule.tsx",
  "src/components/cash-counts/CashCountModule.tsx",
  "src/components/reports/ReportsModule.tsx",
  "src/components/MoneyTransferModule.tsx",
  "src/components/income-expense/IncomeExpenseModule.tsx",
  "src/components/income-expense/IncomeExpenseApprovalModal.tsx",
  "src/components/rubber-bills/RubberBillsTable.tsx",
  "src/components/rubber-exports/RubberExportTable.tsx",
  "src/components/rubber-bills/WeighingQueueModal.tsx",
  "src/components/acid-stock/AcidStockModule.tsx",
  "src/components/time-tracking/manager/ManagerEmployeeDirectory.tsx",
];

test("in-scope tables use the Thai action header and no legacy action label", () => {
  for (const file of tables) {
    const source = readFileSync(resolve(file), "utf8");
    expect(source, file).not.toContain(">การทำงาน</th>");
    const actionHeaders = [...source.matchAll(/<thead[^>]*>([\s\S]*?)<\/thead>/g)]
      .map((match) => match[1])
      .filter((header) => header.includes("จัดการ"));
    expect(actionHeaders.length, `${file} must expose an action header`).toBeGreaterThan(0);
    expect(
      actionHeaders.some((header) => header.match(/<th[^>]*>([\s\S]*?)<\/th>/)?.[1].includes("จัดการ")),
      `${file} must have an in-scope table with the action column first`,
    ).toBe(true);
  }
});

test("shared icon button preserves tooltip, accessible name, focus, and compact size", () => {
  const source = readFileSync(resolve("src/components/shared/IconButton.tsx"), "utf8");
  expect(source).toContain("title={label}");
  expect(source).toContain("aria-label={label}");
  expect(source).toContain("focus-ring");
  expect(source).toContain("h-10");
  expect(source).toContain('visibleLabel ? "px-3" : "w-10"');
});

test("rubber bill actions for evidence, OCR source, and deletion stay icon-only, with customer before bill number", () => {
  const source = readFileSync(resolve("src/components/rubber-bills/RubberBillsTable.tsx"), "utf8");
  const header = source.match(/<thead[^>]*>([\s\S]*?)<\/thead>/)?.[1] ?? "";

  expect(header.indexOf("ชื่อลูกค้า")).toBeLessThan(header.indexOf("เลขที่บิล"));
  expect(source).toContain("size-10 shrink-0 items-center justify-center rounded-md bg-settings");
  expect(source).toMatch(/<Images size=\{16\} \/>\s*<\/button>/);
  expect(source).toContain('title="เปิดรูปต้นฉบับจาก OCR"');
  expect(source).toMatch(/<Trash2 size=\{16\} \/>\s*<\/button>/);
});

test("pending-create pseudo rows do not expose the bill-only OCR source action", () => {
  const source = readFileSync(resolve("src/components/rubber-bills/RubberBillsTable.tsx"), "utf8");

  expect(source).toContain('bill.hasOcrSourceImage && !bill.id.startsWith("approval:")');
  expect(source).toContain('bill.id.startsWith("approval:") ? "รออนุมัติ"');
});

test("rubber bill sync problems cannot reopen the editable modal through the view action", () => {
  const source = readFileSync(resolve("src/components/rubber-bills/RubberBillsTable.tsx"), "utf8");

  expect(source).toMatch(
    /const viewDisabled = deleting\s*\|\| \(!bill\.sourceRubberExportId && \(hasSyncProblem \|\| Boolean\(actionBlockReason\)\)\);/,
  );
});

test("a server-confirmed bill with a pending local replay blocks edit and delete actions", () => {
  const source = readFileSync(resolve("src/components/rubber-bills/RubberBillsModule.tsx"), "utf8");

  expect(source).toContain("getPendingServerActionBlockReason(bill)");
  expect(getPendingServerActionBlockReason({
    id: "server-id",
    clientTempId: "client-id",
    serverBillNo: "RB-1",
    syncStatus: "pending",
  })).toContain("กำลังยืนยันผล");
  expect(getPendingServerActionBlockReason({
    id: "client-id",
    clientTempId: "client-id",
    serverBillNo: undefined,
    syncStatus: "pending",
  })).toBeNull();
});

test("rubber bill actions recheck an in-flight create marker from IndexedDB", () => {
  const source = readFileSync(resolve("src/components/rubber-bills/RubberBillsModule.tsx"), "utf8");

  expect(source).toContain("async function getPendingSubmissionBlockReason(bill: RubberBill)");
  expect(source).toContain("event.serverSubmissionAttempted === true");
  expect(source.match(/await getPendingSubmissionBlockReason\(bill\)/g)).toHaveLength(3);
});
