import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

test("app shell owns sync but not Rubber or Income list reads", () => {
  const app = source("src/components/LanFlowApp.tsx");
  expect(app).toContain("useLanFlowOfflineSyncCoordinator");
  expect(app).not.toContain("useRubberBills(");
  expect(app).not.toContain("useIncomeExpense(");
});

test("Evidence owns its full Rubber Bill read", () => {
  const evidence = source("src/components/rubber-evidence/RubberEvidenceModule.tsx");
  expect(evidence).toContain("useRubberBills(selectedLocation.id, profile.id)");
});

test("Rubber and OCR lock reads do not load Money Transfer history", () => {
  const rubber = source("src/components/rubber-bills/RubberBillsModule.tsx");
  const ocr = source("src/components/OcrTicketUpload.tsx");
  expect(rubber).toContain("bill.transferLockId");
  expect(rubber).not.toContain("useMoneyTransferSourceLocks");
  expect(ocr).toContain("useMoneyTransferSourceLocks");
  expect(rubber).not.toContain("useMoneyTransfers");
  expect(ocr).not.toContain("useMoneyTransfers");
});

test("Rubber operational list uses a scoped cursor feed and page-scoped evidence", () => {
  const module = source("src/components/rubber-bills/RubberBillsModule.tsx");
  const hook = source("src/hooks/useRubberBillList.ts");
  const route = source("src/app/api/lanflow/rubber-bills/feed/route.ts");
  expect(module).toContain("useRubberBillList");
  expect(module).not.toContain("useRubberBillEvidenceReview");
  expect(hook).toContain("useInfiniteQuery");
  expect(hook).toContain('limit: pageParam ? "100" : "150"');
  expect(hook).toContain("signal");
  expect(route).toContain("CURSOR_SCOPE_MISMATCH");
  expect(route).toContain("get_rubber_bill_evidence_states_for_bills");
});

test("Income branch transfer uses the mutation-only seam", () => {
  const incomeExpense = source("src/components/income-expense/IncomeExpenseModule.tsx");
  expect(incomeExpense).toContain("useMoneyTransferMutations");
  expect(incomeExpense).not.toContain("= useMoneyTransfers(");
});
