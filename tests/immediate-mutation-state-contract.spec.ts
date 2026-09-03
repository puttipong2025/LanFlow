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
});
