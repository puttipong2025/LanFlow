import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

function between(value: string, start: string, end: string) {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  expect(startIndex, `${start} should exist`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `${end} should follow ${start}`).toBeGreaterThan(startIndex);
  return value.slice(startIndex, endIndex);
}

test("OCR review asks before mutating queue or modal state", () => {
  const body = between(
    source("src/components/rubber-bills/RubberBillsModule.tsx"),
    "async function openOcrReview",
    "function closeBillModal",
  );
  const guard = body.indexOf("await requestBranchCreate()");
  expect(guard).toBeGreaterThanOrEqual(0);
  expect(guard).toBeLessThan(body.indexOf("setOcrReviewItem(item)"));
  expect(guard).toBeLessThan(body.indexOf("ocrQueue.setReviewing(item.id)"));
  expect(guard).toBeLessThan(body.indexOf("setOcrQueueModalOpen(false)"));
});

test("Rubber Export loads available bills once before the guard and opens only afterward", () => {
  const body = between(
    source("src/components/rubber-exports/RubberExportsModule.tsx"),
    "async function openCreate",
    "useEffect(() =>",
  );
  const load = body.indexOf('loadAvailableBills("create")');
  const guard = body.indexOf("await requestBranchCreate");
  const open = body.indexOf("setCreating(true)");
  expect(load).toBeGreaterThanOrEqual(0);
  expect(body.match(/loadAvailableBills\("create"\)/g)).toHaveLength(1);
  expect(load).toBeLessThan(guard);
  expect(guard).toBeLessThan(open);
});

test("edit paths and excluded Rubber Bill actions do not request confirmation", () => {
  const rubber = source("src/components/rubber-bills/RubberBillsModule.tsx");
  const rubberEdit = between(rubber, "function openEdit", "function openView");
  const queueActions = between(rubber, "บัตรคิว", "ตั้งค่าและอนุมัติบิลยาง");
  const wex = source("src/components/rubber-bills/ExportVehicleWeighBillsModal.tsx");
  const wexEdit = between(wex, "async function openEdit", "async function submitForm");

  expect(rubberEdit).not.toContain("requestBranchCreate");
  expect(queueActions).not.toContain("requestBranchCreate");
  expect(wexEdit).not.toContain("requestBranchCreate");
});

test("pending confirmation is owned by one caller and one user", () => {
  const hook = source("src/hooks/useBranchCreateGuard.tsx");
  expect(hook).toContain("if (pendingRef.current) return Promise.resolve(null)");
  expect(hook.indexOf("if (pendingRef.current) return Promise.resolve(null)"))
    .toBeLessThan(hook.indexOf("if (!requiresBranchCreateConfirmation("));
  expect(hook).toContain("pending.userId !== userId");
  expect(hook).toContain("pending.userId === userId");
  expect(hook).toContain("stateUserIdRef.current === userId");
});
