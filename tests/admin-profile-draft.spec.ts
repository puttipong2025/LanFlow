import { expect, test } from "@playwright/test";

import { isPrimaryLocationLocked } from "../src/components/admin/profile-draft";

test("ordinary Admin cannot change an existing primary branch but gets one on first assignment", () => {
  expect(isPrimaryLocationLocked(false, "branch-a")).toBe(true);
  expect(isPrimaryLocationLocked(false, null)).toBe(false);
  expect(isPrimaryLocationLocked(true, "branch-a")).toBe(false);
});
