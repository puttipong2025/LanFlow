import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getPaginationPageNumbers } from "../src/components/shared/TablePagination";

test.describe("shared table pagination", () => {
  test("keeps at most seven page buttons in a window around the current page", () => {
    expect(getPaginationPageNumbers(1, 1)).toEqual([1]);
    expect(getPaginationPageNumbers(10, 1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(getPaginationPageNumbers(10, 5)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(getPaginationPageNumbers(10, 10)).toEqual([4, 5, 6, 7, 8, 9, 10]);
  });

  test("clamps invalid current pages before building the visible window", () => {
    expect(getPaginationPageNumbers(3, 0)).toEqual([1, 2, 3]);
    expect(getPaginationPageNumbers(3, 99)).toEqual([1, 2, 3]);
  });

  test("income/expense and rubber bills use the same pagination controls", () => {
    const incomeExpense = readFileSync(
      resolve("src/components/income-expense/IncomeExpenseModule.tsx"),
      "utf8",
    );
    const rubberBills = readFileSync(
      resolve("src/components/rubber-bills/RubberBillsTable.tsx"),
      "utf8",
    );

    expect(incomeExpense).toContain("<TablePagination");
    expect(incomeExpense).toContain("<TablePageSizeSelect");
    expect(rubberBills).toContain("<TablePagination");
  });

  test("income/expense keeps one document-number column in the agreed order", () => {
    const source = readFileSync(
      resolve("src/components/income-expense/IncomeExpenseModule.tsx"),
      "utf8",
    );
    const header = source.match(/<thead[^>]*>([\s\S]*?)<\/thead>/)?.[1] ?? "";
    const labels = ["จัดการ", "เลขที่", "จำนวนเงิน", "รายการ", "วันที่", "ประเภท", "หมวด", "ผู้บันทึก", "Sync"];

    let previousIndex = -1;
    for (const label of labels) {
      const index = header.indexOf(`>${label}</th>`);
      expect(index, `missing ${label} header`).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
    expect(header).not.toContain(">เลขบิล</th>");
  });
});
