import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migration = fs.readFileSync(path.join(
  root,
  "supabase/migrations/20260818010000_rubber_bill_evidence_review.sql",
), "utf8");
const legacyDigestDropMigration = fs.readFileSync(path.join(
  root,
  "supabase/migrations/20260818030000_drop_legacy_weight_evidence_digest.sql",
), "utf8");

function source(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("review state has one canonical source and half-open periods", () => {
  expect(migration).toContain("rubber_bill_evidence_review_periods");
  expect(migration).toContain("rubber_bill_evidence_reviews");
  expect(migration).toContain("b.client_created_at >= period.opened_at");
  expect(migration).toContain("b.client_created_at < period.closed_at");
  expect(migration).toContain("private.rubber_bill_evidence_review_states");
  expect(migration).toContain("s.bill_type in ('weighing', 'บิลเครื่องชั่งเล็ก')");
  expect(migration).not.toContain("add column evidence_review_scope");
});

test("review writes serialize by branch and reject stale bulk sets", () => {
  expect(migration).toContain("pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0))");
  expect(migration).toContain("p_expected_pending_fingerprint");
  expect(migration).toContain("p_expected_status text");
  expect(migration).toContain("record_weight_evidence_backup(");
  expect(migration).toContain("claim_weight_evidence_completion(");
});

test("Telegram digest remains count-only and branch-selectable", () => {
  const digest = migration.slice(
    migration.indexOf("create or replace function public.get_weight_evidence_review_digest"),
    migration.indexOf("revoke all on function public.get_weight_evidence_review_digest"),
  );
  expect(migration).toContain("evidence_all_locations");
  expect(migration).toContain("evidence_location_ids");
  expect(migration).toContain("get_weight_evidence_review_digest");
  expect(migration).toContain("save_telegram_badge_config_with_evidence_locations");
  expect(digest).toContain("pending_before_today");
  expect(digest).not.toContain("customer_name");
  expect(digest).not.toContain("web_view_url");
});

test("legacy per-bill Evidence digest is retired by a forward migration", () => {
  expect(legacyDigestDropMigration).toContain(
    "drop function if exists public.get_weight_evidence_digest()",
  );
  expect(source("supabase/functions/telegram-badge-dispatch/index.ts"))
    .not.toContain("get_weight_evidence_digest");
  expect(source("supabase/functions/_shared/telegram-badge.ts"))
    .not.toContain("formatWeightEvidenceDigest");
});

test("web review is a separate five-card module with authenticated image routes", () => {
  const detailRoute = source("src/app/api/lanflow/evidence/bills/[billId]/revisions/[revisionNo]/detail/route.ts");
  const imageRoute = source("src/app/api/lanflow/evidence/bills/[billId]/revisions/[revisionNo]/rows/[rowId]/[role]/image/route.ts");
  const tabs = source("src/components/lanflow/tabs.ts");
  const app = source("src/components/LanFlowApp.tsx");
  const module = source("src/components/rubber-evidence/RubberEvidenceModule.tsx");
  const table = source("src/components/rubber-bills/RubberBillsTable.tsx");

  expect(detailRoute).toContain("requireAuth(request)");
  expect(imageRoute).toContain("downloadEvidenceImageFromDrive");
  expect(imageRoute).not.toContain("web_view_url");
  expect(tabs).toContain('"rubber-evidence"');
  expect(app).toContain("<RubberEvidenceModule");
  expect(module).toContain("const CARD_PAGE_SIZE = 5");
  expect(module).toContain("ควรปรับปรุง");
  expect(module).toContain('result.state === "blocked"');
  expect(module.match(/result\.state === "stale"/g)).toHaveLength(2);
  expect(table).toContain("เปิดหลักฐาน");
  expect(table).toContain("สถานะหลักฐาน");
});

test("staged preparation is cancelable, deduplicated, and bounded to three image requests", () => {
  const loader = source("src/hooks/useRubberEvidencePage.ts");
  expect(loader).toContain("const IMAGE_CONCURRENCY = 3");
  expect(loader).toContain("new AbortController()");
  expect(loader).toContain("controller.abort()");
  expect(loader).toContain("clearCache();");
  expect(loader).toContain("URL.createObjectURL");
  expect(loader).toContain("URL.revokeObjectURL");
  expect(loader).toContain("inFlight");
  expect(loader).toContain("`${bill.id}:${bill.revisionNo}`");
  expect(loader).toContain("[bills, clearCache, online, reloadToken]");
});

test("generic waiting dialog keeps the Share PDF wrapper contract", () => {
  const generic = source("src/components/shared/OperationWaitingDialog.tsx");
  const wrapper = source("src/components/shared/SharePdfWaitingModal.tsx");
  expect(generic).toContain("aria-live");
  expect(generic).toContain("autoFocus");
  expect(wrapper).toContain("OperationWaitingDialog");
  expect(wrapper).toContain("กำลังสร้าง PDF");
});

test("Badge migration separates bill pricing work from evidence review work", () => {
  const badgeMigration = source("supabase/migrations/20260818020000_separate_rubber_evidence_badge.sql");
  expect(badgeMigration).toContain("'rubber-evidence'::text");
  expect(badgeMigration).toContain("count(distinct s.bill_id)");
  expect(badgeMigration).toContain("count(distinct b.blocker_id)");
});
