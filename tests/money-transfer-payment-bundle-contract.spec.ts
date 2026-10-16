import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { parsePaymentBundleDetailPage } from "../src/lib/payment-bundle-detail";

const source = (path: string) => readFileSync(resolve(path), "utf8");

test("money-transfer save buttons stay locked while slip OCR is running", () => {
  for (const file of [
    "src/components/money-transfer/BranchTransferForm.tsx",
    "src/components/money-transfer/CustomerTransferForm.tsx",
    "src/components/money-transfer/TransportTransferForm.tsx",
  ]) {
    const form = source(file);
    const saveButton = form.slice(form.lastIndexOf("<button"));
    expect(saveButton).toContain("slipUploading");
  }
});

test("payment bundles keep the existing transfer type and use one parent link", () => {
  const migrationPath = "supabase/migrations/20261016010000_money_transfer_payment_bundles.sql";
  expect(existsSync(resolve(migrationPath))).toBe(true);
  const migration = source(migrationPath);
  expect(migration).toContain("is_payment_bundle");
  expect(migration).toContain("bundle_parent_id");
  expect(migration).toContain("bundle_frozen_at");
  expect(migration).toContain("on delete restrict");
  expect(migration).toContain("create_or_update_payment_bundle");
  expect(migration).toContain("save_payment_bundle");
  expect(migration).toContain("dissolve_payment_bundle");
  expect(migration).not.toContain("create table public.payment_bundle");
  expect(migration).not.toContain("create table public.payment_allocation");
});

test("money-transfer list and UI expose bundle filters and detail seams", () => {
  const hook = source("src/hooks/usePaymentBundles.ts");
  const module = source("src/components/MoneyTransferModule.tsx");
  const dialog = source("src/components/money-transfer/PaymentBundleDialog.tsx");
  expect(hook).toContain("get_payment_bundle_candidates");
  expect(hook).toContain("get_payment_bundle_detail");
  expect(hook).toContain("create_or_update_payment_bundle");
  expect(module).toContain("PaymentBundleDialog");
  expect(dialog).toContain("คัดลอกบัญชี");
  expect(dialog).toContain("คัดลอกยอดคงเหลือ");
  expect(dialog).toContain("ดูบิล");
});

test("bundle mutation gates close and reports expose read-only child detail", () => {
  const migration = source("supabase/migrations/20261016010000_money_transfer_payment_bundles.sql");
  const reportRoute = source("src/app/api/lanflow/reports/[reportId]/route.ts");
  expect(migration).toContain("pg_advisory_xact_lock");
  expect(migration).toContain("set_config('app.payment_bundle_mutation', 'off', true)");
  expect(migration).toContain("reportable_items_before_payment_bundles");
  expect(reportRoute).toContain("bundleChildren");
  expect(reportRoute).toContain("allocated");
});

test("bundle mutations refresh the authoritative detail before another write", () => {
  const hook = source("src/hooks/usePaymentBundles.ts");
  expect(hook).toContain('["paymentBundleDetail"]');
  expect(hook).toContain('["paymentBundleCandidates"]');
});

test("bundle detail pagination rejects malformed or repeated cursors", () => {
  const hook = source("src/hooks/usePaymentBundles.ts");
  const reportRoute = source("src/app/api/lanflow/reports/[reportId]/route.ts");
  expect(hook).toContain("parsePaymentBundleDetailPage");
  expect(reportRoute).toContain("parsePaymentBundleDetailPage");
});

test("bundle detail parser fails fast instead of looping on a repeated cursor", () => {
  expect(() => parsePaymentBundleDetailPage(null, new Set())).toThrow("ข้อมูลรายละเอียดชุดจ่ายรวมไม่ถูกต้อง");

  expect(() => parsePaymentBundleDetailPage({
    id: "bundle-1",
    children: [],
    has_more_children: "false",
  }, new Set())).toThrow("ข้อมูลสถานะหน้าถัดไปของชุดจ่ายรวมไม่ถูกต้อง");

  expect(() => parsePaymentBundleDetailPage({
    id: "bundle-1",
    children: [],
    has_more_children: true,
    next_child_created_at: "2026-10-16T00:00:00.000Z",
    next_child_id: "child-1",
  }, new Set())).toThrow("ข้อมูลหน้าถัดไปของชุดจ่ายรวมไม่มีรายการอ้างอิง");

  const seen = new Set<string>();
  const page = {
    id: "bundle-1",
    children: [{ id: "child-1", created_at: "2026-10-16T00:00:00.000Z" }],
    has_more_children: true,
    next_child_created_at: "2026-10-16T00:00:00.000Z",
    next_child_id: "child-1",
  };
  parsePaymentBundleDetailPage(page, seen);
  expect(() => parsePaymentBundleDetailPage(page, seen)).toThrow("ข้อมูลหน้าถัดไปของชุดจ่ายรวมวนซ้ำ");

  expect(() => parsePaymentBundleDetailPage({
    id: "another-bundle",
    children: [],
    has_more_children: false,
  }, new Set(), "bundle-1")).toThrow("ข้อมูลรายละเอียดชุดจ่ายรวมไม่ตรงกับรายการที่ขอ");

  expect(() => parsePaymentBundleDetailPage({
    ...page,
    next_child_id: "another-child",
  }, new Set(), "bundle-1")).toThrow("ข้อมูลหน้าถัดไปของชุดจ่ายรวมไม่ตรงกับรายการสุดท้าย");
});

test("a frozen or report-locked bundle is read-only in the modal", () => {
  const dialog = source("src/components/money-transfer/PaymentBundleDialog.tsx");
  expect(dialog).toContain("!bundle.bundleFrozenAt");
  expect(dialog).toContain("readOnly={Boolean(bundle.reportLockNo)}");
});
