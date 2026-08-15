import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  canAccessEvidenceLocation,
  parseCompletionClaimPayload,
  parseCompletionIdentityPayload,
  parseOcrModelResponse,
} from "../src/lib/server/weight-evidence";

const root = process.cwd();

test("OCR accepts exactly one high-confidence non-negative value", () => {
  expect(parseOcrModelResponse('{"values":[2760.5],"confidence":"high"}')).toBe(2760.5);
  expect(parseOcrModelResponse('{"values":[2760,2810],"confidence":"high"}')).toBeNull();
  expect(parseOcrModelResponse('{"values":[-1],"confidence":"high"}')).toBeNull();
  expect(parseOcrModelResponse('{"values":[2760],"confidence":"low"}')).toBeNull();
});

test("completion payload and branch permission reject malformed or foreign input", () => {
  const ownLocation = "11111111-1111-4111-8111-111111111111";
  const foreignLocation = "22222222-2222-4222-8222-222222222222";
  const completionId = "33333333-3333-4333-8333-333333333333";
  const auth: Parameters<typeof canAccessEvidenceLocation>[0] = {
    sub: "44444444-4444-4444-8444-444444444444",
    phone: "",
    name: "Weight Evidence Test",
    role: "user",
    locationIds: [ownLocation],
    primaryLocationId: ownLocation,
    canAccessSystemManager: false,
    canAccessMoneyTransfer: false,
    canManageTimePayroll: false,
  };

  expect(canAccessEvidenceLocation(auth, ownLocation)).toBe(true);
  expect(canAccessEvidenceLocation(auth, foreignLocation)).toBe(false);
  expect(parseCompletionIdentityPayload({ locationId: ownLocation, completionId, revisionNo: 2 })).toEqual({
    locationId: ownLocation,
    completionId,
    revisionNo: 2,
  });
  expect(parseCompletionIdentityPayload({ locationId: ownLocation, completionId, revisionNo: -1 })).toBeNull();
  expect(parseCompletionIdentityPayload({ locationId: "not-a-uuid", completionId, revisionNo: 2 })).toBeNull();
  expect(parseCompletionClaimPayload({ locationId: ownLocation, completionId, revisionNo: 2 })).toBeNull();
  expect(parseCompletionClaimPayload({ locationId: ownLocation, completionId, revisionNo: 2, manualCorrectionCount: -1 })).toBeNull();
  expect(parseCompletionClaimPayload({ locationId: ownLocation, completionId, revisionNo: 2, manualCorrectionCount: 1 })).toEqual({
    locationId: ownLocation,
    completionId,
    revisionNo: 2,
    manualCorrectionCount: 1,
  });
});

test("migration stores only opaque completion ownership and clears on bill change", () => {
  const sql = fs.readFileSync(path.join(root, "supabase/migrations/20260814010000_weight_evidence_completion.sql"), "utf8");
  expect(sql).toContain("add column if not exists evidence_completion_id uuid");
  expect(sql).toContain("new.revision_no is distinct from old.revision_no");
  expect(sql).toContain("new.record_status is distinct from old.record_status");
  expect(sql).toContain("tg_table_name = 'rubber_exports'");
  expect(sql).toContain("array['sold_out_at', 'sold_out_by_user_id', 'sold_out_by_name']");
  expect(sql).toContain("for update");
  expect(sql).not.toMatch(/create\s+table/i);
  expect(sql).not.toMatch(/add\s+column[^;]*(image|ocr_value|payload_json)/i);
});

test("count cutover is atomic and leaves only the five-argument claim", () => {
  const sql = fs.readFileSync(path.join(root, "supabase/migrations/20260815010000_weight_evidence_share_and_digest.sql"), "utf8");
  expect(sql).toContain("begin;");
  expect(sql).toContain("lock table public.rubber_bills in access exclusive mode");
  expect(sql).toContain("WEIGHT_EVIDENCE_COMPLETION_PREFLIGHT_FAILED");
  expect(sql).toContain("evidence_manual_correction_count integer not null default 0");
  expect(sql).toContain("p_manual_correction_count integer");
  expect(sql).toContain("drop function if exists public.claim_weight_evidence_completion(uuid, uuid, integer, uuid)");
  expect(sql).toContain("notify pgrst, 'reload schema'");
  expect(sql).toContain("source_rubber_export_id is not null");
  expect(sql).toContain("array['sold_out_at', 'sold_out_by_user_id', 'sold_out_by_name']");
});

test("evidence routes do not expose foreign completion UUID or persist OCR", () => {
  const status = fs.readFileSync(path.join(root, "src/app/api/lanflow/evidence/bills/[billId]/status/route.ts"), "utf8");
  const ocr = fs.readFileSync(path.join(root, "src/app/api/lanflow/evidence/ocr/route.ts"), "utf8");
  expect(status).toContain('"owned_by_other"');
  expect(status).not.toContain("evidenceCompletionId:");
  expect(ocr).not.toMatch(/result\.supabase|\.storage\.|\.upload\(/);
  expect(ocr).not.toContain("raw_response");
});

test("today bills include the customer name needed by the Android work list", () => {
  const route = fs.readFileSync(path.join(root, "src/app/api/lanflow/evidence/today-bills/route.ts"), "utf8");
  expect(route).toContain("customer_name");
  expect(route).toContain("customerName: bill.customer_name");
});

test("today bills expose the confirmed timestamp fallback for automatic matching", () => {
  const route = fs.readFileSync(path.join(root, "src/app/api/lanflow/evidence/today-bills/route.ts"), "utf8");
  expect(route).toContain("client_recorded_at");
  expect(route).toContain("server_received_at");
  expect(route).toContain("created_at");
  expect(route).toContain("matchingRecordedAt: bill.client_recorded_at ?? bill.server_received_at ?? bill.created_at");
});

test("today bills expose only canonical customer-bill share fields", () => {
  const route = fs.readFileSync(path.join(root, "src/app/api/lanflow/evidence/today-bills/route.ts"), "utf8");
  expect(route).toContain('.is("source_rubber_export_id", null)');
  expect(route).toContain("weight, deduct_weight, net_weight, average_price, deduction_total, net_total");
  expect(route).toContain("weight_in, weight_out, net_weight");
  expect(route).not.toContain("select(\"*\")");
});
