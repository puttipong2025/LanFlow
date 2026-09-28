import { expect, test } from "@playwright/test";
import { canViewNavigationTab } from "../src/components/lanflow/NavigationTabs";
import type { Profile } from "../src/types";

test.use({ storageState: { cookies: [], origins: [] } });

const baseProfile: Profile = {
  id: "00000000-0000-4000-8000-000000000003",
  name: "Permission test",
  phone: "0820000001",
  role: "user",
  isActive: true,
  locationIds: ["00000000-0000-4000-8000-000000000102"],
};

test("Cash Count navigation matches the Admin-or-manager RPC permission", () => {
  expect(canViewNavigationTab("cash-count", baseProfile)).toBe(false);
  expect(canViewNavigationTab("cash-count", { ...baseProfile, role: "admin" })).toBe(true);
  expect(canViewNavigationTab("cash-count", { ...baseProfile, role: "super_admin" })).toBe(true);
});
