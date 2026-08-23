import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("Admin section switcher uses named pressed buttons instead of incomplete tabs", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/admin/AdminContent.tsx"), "utf8");
  expect(source).not.toContain('role="tablist"');
  expect(source).not.toContain('role="tab"');
  expect(source).toContain('aria-pressed={tab === "employees"}');
  expect(source).toContain('aria-pressed={tab === "branches"}');
  expect(source).toContain(">พนักงาน</button>");
  expect(source).toContain(">สาขา</button>");
});
