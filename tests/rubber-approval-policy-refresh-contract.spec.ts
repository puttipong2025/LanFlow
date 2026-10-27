import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { loadSourceModule } from "./helpers/load-source-module";

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

test("create opens without awaiting policy, while OCR and edit retain their policy gate", () => {
  const create = functionBody(moduleSource, "openAdd", "function openOcrReview");
  expect(create).toContain("void refreshPolicy()");
  expect(create).not.toContain("await refreshPolicyBeforeOpeningBill()");
  expect(create).toContain("setModalOpen(true)");
  expect(create.indexOf("await requestBranchCreate()")).toBeLessThan(create.indexOf("setModalOpen(true)"));
  expect(moduleSource).toContain('if (policyStatus !== "ready") return false');
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

const validPolicy = {
  locationId: "71000000-0000-4000-8000-000000000021", groupId: null,
  ruleSource: "ungrouped", editWindowMinutes: 30, centralPrice: 42,
  priceAllowance: 1, effectivePriceCap: 43, priceRuleRevision: 1,
  nonCurrentDateRequiresApproval: false,
};

async function policyQuery(response: Response) {
  let queryFn: () => Promise<unknown> = async () => { throw new Error("query not registered"); };
  const hook = loadSourceModule<{ useRubberBillApprovals: (input: { locationId: string; ownerUserId: string }) => unknown }>(
    "src/hooks/useRubberBillApprovals.ts", {
      react: { useState: (initial: () => unknown) => [initial(), () => {}], useEffect: () => {} },
      "@tanstack/react-query": {
        useQueryClient: () => ({}), useMutation: () => ({}),
        useQuery: (options: { queryFn: () => Promise<unknown> }) => { queryFn = options.queryFn; return {}; },
      },
      "@/lib/auth-fetch": { authFetch: async () => response },
      "@/hooks/useActionableBadges": {}, "@/lib/idb-queue": {},
      "@/lib/rubber-bills/feed-cache": {},
    },
  );
  hook.useRubberBillApprovals({ locationId: validPolicy.locationId, ownerUserId: "owner" });
  return queryFn();
}

test("the client accepts valid current-branch policy", async () => {
  await expect(policyQuery(Response.json(validPolicy))).resolves.toEqual(validPolicy);
});

for (const [name, body] of [
  ["empty policy", {}],
  ["another branch", { ...validPolicy, locationId: "71000000-0000-4000-8000-000000000022" }],
  ["inconsistent price cap", { ...validPolicy, effectivePriceCap: 99 }],
] as const) {
  test(`the client rejects HTTP 200 with ${name} before releasing the save gate`, async () => {
    await expect(policyQuery(Response.json(body))).rejects.toThrow("รูปแบบ");
  });
}

test("the client rejects HTTP 200 HTML instead of treating it as an empty policy", async () => {
  await expect(policyQuery(new Response("<html>unavailable</html>"))).rejects.toThrow("รูปแบบ");
});
