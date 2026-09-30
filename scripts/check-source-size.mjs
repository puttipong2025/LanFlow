import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const sourceRoot = resolve("src");
const hardLimit = 500;
const grandfathered = new Map(Object.entries({
  "src/app/api/lanflow/time-tracking/admin/route.ts": 611,
  "src/components/CustomersModule.tsx": 1008,
  "src/components/LanFlowApp.tsx": 810,
  "src/components/MoneyTransferModule.tsx": 869,
  "src/components/TransportModule.tsx": 774,
  "src/components/acid-stock/AcidStockModule.tsx": 992,
  "src/components/cash-counts/CashCountModule.tsx": 570,
  "src/components/dashboard/Dashboard.tsx": 809,
  "src/components/income-expense/IncomeExpenseApprovalModal.tsx": 650,
  "src/components/income-expense/IncomeExpenseModal.tsx": 583,
  "src/components/income-expense/IncomeExpenseModule.tsx": 1015,
  "src/components/lanflow/TelegramBadgeConfigModal.tsx": 684,
  "src/components/money-transfer/CustomerTransferForm.tsx": 618,
  "src/components/rubber-bills/RubberBillModal.tsx": 856,
  "src/components/rubber-bills/RubberBillsModule.tsx": 819,
  "src/components/rubber-evidence/RubberEvidenceModule.tsx": 539,
  "src/components/rubber-exports/RubberExportDetailModal.tsx": 514,
  "src/components/rubber-exports/RubberExportsModule.tsx": 679,
  "src/hooks/useIncomeExpenseApprovals.ts": 508,
  "src/hooks/useRubberBills.ts": 533,
  "src/types/index.ts": 610,
}));

const normalize = (path) => path.replaceAll("\\", "/");
const countPhysicalLines = (source) => {
  if (source.length === 0) return 0;
  const lineCount = source.split(/\r?\n/).length;
  return source.endsWith("\n") ? lineCount - 1 : lineCount;
};
const files = (await readdir(sourceRoot, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name)) && !entry.name.endsWith(".d.ts"))
  .map((entry) => resolve(entry.parentPath, entry.name));

const violations = [];
for (const file of files) {
  const path = normalize(relative(resolve("."), file));
  const lines = countPhysicalLines(await readFile(file, "utf8"));
  const baseline = grandfathered.get(path);
  if (baseline === undefined && lines > hardLimit) {
    violations.push(`${path}: ${lines} lines exceeds the ${hardLimit}-line hard limit`);
  } else if (baseline !== undefined && lines > baseline) {
    violations.push(`${path}: ${lines} lines exceeds its grandfathered baseline of ${baseline}`);
  } else if (baseline !== undefined && lines <= hardLimit) {
    violations.push(`${path}: now ${lines} lines; remove it from the grandfathered allowlist`);
  }
}

for (const path of grandfathered.keys()) {
  try {
    await readFile(resolve(path), "utf8");
  } catch {
    violations.push(`${path}: grandfathered entry no longer exists; remove it from the allowlist`);
  }
}

if (violations.length > 0) {
  throw new Error(`Source-size ratchet failed:\n- ${violations.join("\n- ")}`);
}
console.log(`Source-size ratchet passed: new files <= ${hardLimit} lines and ${grandfathered.size} grandfathered files did not grow.`);

