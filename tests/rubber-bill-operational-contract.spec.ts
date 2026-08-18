import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

test("work badges use current work while reports retain historical blockers", () => {
  const feedMigration = source("supabase/migrations/20260819020000_rubber_bill_operational_feed.sql");
  const badgeMigration = source("supabase/migrations/20260819030000_current_work_actionable_badges.sql");
  expect(feedMigration).toContain("private.rubber_bill_current_work_items");
  expect(feedMigration).toContain("count(distinct w.work_identity)");
  expect(badgeMigration).toContain("private.rubber_bill_current_work_items");
  expect(badgeMigration).not.toContain("rubber_bill_report_blockers");
  expect(source("supabase/migrations/20260727030000_actionable_badges_report_precheck.sql"))
    .toContain("private.rubber_bill_report_blockers");
});

test("Rubber filter UI distinguishes loaded history from work counts", () => {
  const module = source("src/components/rubber-bills/RubberBillsModule.tsx");
  expect(module).toContain("รายการล่าสุด");
  expect(module).toContain("ยังไม่กำหนดราคา");
  expect(module).toContain("ซิงก์มีปัญหา");
  expect(module).toContain("ไม่จำกัดสถานะ (ในข้อมูลที่โหลด)");
  expect(module).toContain("value !== \"latest\" && count > 0");
});

test("sync problem mode stays local and does not advertise more server pages", () => {
  const hook = source("src/hooks/useRubberBillList.ts");
  const localBranch = hook.match(/if \(mode === "sync_problem"\)([\s\S]*?)const \{ events, snapshots \}/)?.[1] ?? "";
  expect(localBranch).toContain("getPendingEvents");
  expect(localBranch).toContain("hasMore: false");
  expect(localBranch).not.toContain("authFetch");
});
