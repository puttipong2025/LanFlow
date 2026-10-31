import { expect, test } from "@playwright/test";
import { keywordFormFixture } from "./helpers/approval-keyword-form-fixture";

for (const existing of ["income", "expense", "both"] as const) {
  for (const desired of ["income", "expense", "both"] as const) {
    test(`keyword form preserves database uniqueness by text and scope ${existing}/${desired}`, async () => {
      const fixture = keywordFormFixture(existing, desired);
      await fixture.submit();
      expect(fixture.writes()).toBe(existing === desired ? 0 : 1);
      expect(fixture.issue()).toBe(existing === desired ? "มีข้อความนี้ในรายการตรวจสอบแล้ว" : null);
    });
  }
}
test("disabled keyword does not prevent a replacement in the same scope", async () => {
  const fixture = keywordFormFixture("expense", "expense", false);
  await fixture.submit();
  expect(fixture.writes()).toBe(1);
  expect(fixture.issue()).toBeNull();
});
