import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("central backup contract stays separate from rubber bill items", () => {
  const sql = fs.readFileSync(path.join(
    root,
    "supabase/migrations/20260817010000_weight_evidence_drive_backup.sql",
  ), "utf8");

  expect(sql).toContain("create table public.rubber_bill_item_evidence_files");
  expect(sql).toContain("primary key (bill_item_id, role)");
  expect(sql).toContain("on delete cascade");
  expect(sql).toContain("evidence_manual_correction_count");
  expect(sql).toContain("claim_weight_evidence_completion(");
  expect(sql).toContain("p_manual_correction_count integer");
  expect(sql).not.toContain("alter table public.rubber_bill_items\n  add column evidence_images");
});

test("Drive backup route enforces the bounded idempotent contract", () => {
  const route = fs.readFileSync(path.join(
    root,
    "src/app/api/lanflow/evidence/bills/[billId]/rows/[rowId]/[role]/backup/route.ts",
  ), "utf8");
  const drive = fs.readFileSync(path.join(root, "src/lib/server/google-drive.ts"), "utf8");

  expect(route).toContain("WEIGHT_EVIDENCE_MAX_BACKUP_IMAGE_BYTES");
  expect(route).toContain("record_weight_evidence_backup");
  expect(route).toContain("noStoreJson");
  expect(drive).toContain("appProperties");
  expect(drive).toContain("evidenceKey");
  expect(drive).toContain("permissions");
});

test("new claim payload accepts a bounded manual correction count", () => {
  const source = fs.readFileSync(path.join(root, "src/lib/server/weight-evidence.ts"), "utf8");
  expect(source).toContain("manualCorrectionCount");
  expect(source).toContain("WEIGHT_EVIDENCE_MAX_BACKUP_IMAGE_BYTES = 4 * 1024 * 1024");
  expect(source).toContain("WEIGHT_EVIDENCE_MAX_IMAGE_BYTES = 8 * 1024 * 1024");
});

test("reported OCR-origin bills allow only isolated Weight Evidence updates", () => {
  const sql = fs.readFileSync(path.join(
    root,
    "supabase/migrations/20260901010000_allow_weight_evidence_on_reported_ocr_bills.sql",
  ), "utf8");

  expect(sql).toContain("create or replace function private.guard_reported_entity()");
  expect(sql).toContain("evidence_completion_id");
  expect(sql).toContain("evidence_manual_correction_count");
  expect(sql.match(/- 'has_ocr_source_image'/g)).toHaveLength(2);
  expect(sql).toContain("perform private.raise_report_lock(v_report_no)");
});
