import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const moduleSource = readFileSync(
  "src/components/rubber-bills/RubberBillsModule.tsx",
  "utf8",
);
const policyPanelSource = readFileSync(
  "src/components/rubber-bills/RubberApprovalPolicyPanel.tsx",
  "utf8",
);
const policyHookSource = readFileSync(
  "src/hooks/useRubberApprovalGroups.ts",
  "utf8",
);

function functionBody(source: string, name: string, nextMarker: string) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(nextMarker, start + 1);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  expect(end, `${nextMarker} must follow ${name}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

test("online create, OCR review, and edit refresh the effective rubber policy before opening", () => {
  const refreshHelper = functionBody(
    moduleSource,
    "refreshPolicyBeforeOpeningBill",
    "function handlePrint",
  );
  expect(refreshHelper).toContain("refreshApprovalSettings()");
  expect(refreshHelper).toContain("if (!isOnline) return true");
  expect(refreshHelper).toContain("return false");

  expect(functionBody(moduleSource, "openAdd", "function openOcrReview")).toContain(
    "await refreshPolicyBeforeOpeningBill()",
  );
  expect(functionBody(moduleSource, "openOcrReview", "function closeBillModal")).toContain(
    "await refreshPolicyBeforeOpeningBill()",
  );
  expect(functionBody(moduleSource, "openEdit", "function openView")).toContain(
    "await refreshPolicyBeforeOpeningBill()",
  );
});

test("a failed policy confirmation refreshes authoritative management state once", () => {
  const confirmationHandler = functionBody(
    policyPanelSource,
    "confirmAction",
    "if (loading)",
  );
  expect(confirmationHandler.match(/await policy\.refetch\(\)/g)).toHaveLength(1);
});

test("auto-reset lock patches and refreshes management state without periodic polling", () => {
  const start = policyHookSource.indexOf("const savePriceAllowanceAutoResetLock");
  const end = policyHookSource.indexOf("\n\n  return {", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const lockMutation = policyHookSource.slice(start, end);
  expect(lockMutation).toContain("queryClient.setQueryData<GroupsResponse>");
  expect(lockMutation).toContain("priceAllowanceAutoResetLocked: data.locked");
  expect(lockMutation).not.toContain("invalidatePolicyQueries");
  expect(lockMutation).toContain("await queryClient.invalidateQueries");
  expect(policyHookSource).toContain("refetchInterval: false");
  expect(policyHookSource).toContain('refetchOnMount: "always"');
  expect(policyHookSource).toContain('refetchOnWindowFocus: "always"');
});

test("lock failures refetch once and unlock confirmation retains a stable target", () => {
  const lockHandler = functionBody(
    policyPanelSource,
    "changeAutoResetLock",
    "\n  return (",
  );
  expect(lockHandler.match(/await policy\.refetch\(\)/g)).toHaveLength(1);
  expect(lockHandler).toContain('setConfirmation({ kind: "autoResetUnlock", target })');
  expect(policyPanelSource).toContain('groupId: group.id');
  expect(policyPanelSource).toContain("lockInput(confirmation.target, false)");
});
