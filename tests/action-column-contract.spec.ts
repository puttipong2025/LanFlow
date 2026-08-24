import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const tables = [
  "src/components/CustomersModule.tsx",
  "src/components/TransportModule.tsx",
  "src/components/OcrTicketUpload.tsx",
  "src/components/cash-counts/CashCountModule.tsx",
  "src/components/reports/ReportsModule.tsx",
  "src/components/MoneyTransferModule.tsx",
  "src/components/income-expense/IncomeExpenseModule.tsx",
  "src/components/income-expense/IncomeExpenseApprovalModal.tsx",
  "src/components/rubber-bills/RubberBillsTable.tsx",
  "src/components/rubber-exports/RubberExportTable.tsx",
  "src/components/rubber-bills/WeighingQueueModal.tsx",
  "src/components/acid-stock/AcidStockModule.tsx",
  "src/components/TimeTrackingModule.tsx",
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

test("rubber bill actions for evidence and deletion stay icon-only, with customer before bill number", () => {
  const source = readFileSync(resolve("src/components/rubber-bills/RubberBillsTable.tsx"), "utf8");
  const header = source.match(/<thead[^>]*>([\s\S]*?)<\/thead>/)?.[1] ?? "";

  expect(header.indexOf("ชื่อลูกค้า")).toBeLessThan(header.indexOf("เลขที่บิล"));
  expect(source).toContain("size-10 shrink-0 items-center justify-center rounded-md bg-settings");
  expect(source).toContain("<Images size={16} />\n                    </button>");
  expect(source).toContain("<Trash2 size={16} />\n                    </button>");
});
