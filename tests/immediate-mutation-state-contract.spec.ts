import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSource(path: string) {
  return readFileSync(resolve(path), "utf8");
}

test.describe("immediate mutation state contract", () => {
  test("waits for approval query invalidation before mutateAsync resolves", () => {
    const sources = [
      "src/hooks/useRubberBillApprovals.ts",
      "src/hooks/useRubberApprovalGroups.ts",
      "src/hooks/useStockEntryApprovals.ts",
      "src/hooks/useStockProductApprovals.ts",
      "src/hooks/useAcidProducts.ts",
      "src/hooks/useAcidStock.ts",
    ].map(readSource);

    for (const source of sources) {
      expect(source).not.toContain("void queryClient.invalidateQueries");
    }
    expect(sources[0]).toContain("return Promise.all([");
    expect(sources[1]).toContain("return Promise.all([");
    expect(sources[2]).toContain("onSuccess: (data) => Promise.all([");
    expect(sources[3]).toContain("onSuccess: (data) => Promise.all([");
  });

  test("keeps the direct state handoff for server-confirmed admin mutations", () => {
    const adminModule = readSource("src/components/AdminModule.tsx");
    const adminUsersRoute = readSource("src/app/api/lanflow/admin/users/route.ts");

    expect(adminModule).toContain("setUsers((current) => current.some((user) => user.id === data.user!.id)");
    expect(adminModule).not.toContain("toast.success(\"สร้างบัญชีผู้ใช้แล้ว\");\n      await loadUsers();");
    expect(adminUsersRoute).toContain("isActive: true");
    expect(adminUsersRoute).toContain("canAccessSystemManager: capabilities.canManageSystem");
  });

  test("clears deleted rubber-group caches from the revision-protected input", () => {
    const source = readSource("src/hooks/useRubberApprovalGroups.ts");

    expect(source).toContain(
      "onSuccess: (_data, group) => invalidateLocations(group.locationIds)",
    );
    expect(source).not.toContain(
      "onSuccess: (data) => invalidateLocations(data.releasedLocationIds)",
    );
  });

  test("clears central-price caches for every location in the authoritative response", () => {
    const source = readSource("src/hooks/useRubberApprovalGroups.ts");

    expect(source).toContain("function policyLocationIds(data: GroupsResponse)");
    expect(source).toContain("await invalidateLocations(policyLocationIds(data));");
    expect(source).not.toContain("await invalidateLocations(allLocationIds);");
  });

  test("pins the confirmed central price revision until the mutation is submitted", () => {
    const source = readSource("src/components/rubber-bills/RubberApprovalPolicyPanel.tsx");

    expect(source).toContain(
      '| { kind: "central"; value: number; previousValue: number; expectedRevision: number }',
    );
    expect(source).toContain("expectedRevision: confirmation.expectedRevision");
    expect(source).toContain("confirmation.previousValue.toFixed(2)");
    expect(source).not.toContain(
      "await policy.saveCentralPrice({ centralPrice: confirmation.value, expectedRevision: central.revision });",
    );
  });

  test("reports pending approval only after the server confirms the request", () => {
    const source = readSource("src/hooks/useRubberBills.ts");
    const queuedFallback = source.match(
      /return \{\s+\.\.\.calculatedBill,\s+syncStatus: "pending"[\s\S]*?\n\s+\};/
    )?.[0] ?? "";

    expect(source).toContain('approvalPending: data.status === "pending_approval"');
    expect(queuedFallback).toContain("approvalPending: false");
    expect(queuedFallback).not.toContain("isRubberBillPriceApprovalRequired");
  });

  test("stores server identity beside queued Rubber Bill updates and deletes", () => {
    const source = readSource("src/hooks/useRubberBills.ts");

    expect(source).toContain('serverId: operation === "update" ? bill.id : undefined');
    expect(source).toContain('serverBillNo: operation === "update" ? bill.serverBillNo : undefined');
    expect(source).toContain("serverId: bill.id,");
    expect(source).toContain("serverBillNo: bill.serverBillNo,");
  });

  test("marks a possible create commit before transport and blocks local mutation until replay", () => {
    const source = readSource("src/hooks/useRubberBills.ts");

    expect(source).toContain(
      'serverSubmissionAttempted: operation === "create" && directSubmissionScope !== null',
    );
    expect(source).toContain(
      'if (event.operation === "create" && event.serverSubmissionAttempted !== true)',
    );
    expect(source.match(/pendingCreates\.some\(\(event\) => event\.serverSubmissionAttempted === true\)/g))
      .toHaveLength(2);
  });
});
