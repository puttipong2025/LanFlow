import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  canAccessEvidenceLocation,
  parseCompletionPayload,
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
  expect(parseCompletionPayload({ locationId: ownLocation, completionId, revisionNo: 2 })).toEqual({
    locationId: ownLocation,
    completionId,
    revisionNo: 2,
  });
  expect(parseCompletionPayload({ locationId: ownLocation, completionId, revisionNo: -1 })).toBeNull();
  expect(parseCompletionPayload({ locationId: "not-a-uuid", completionId, revisionNo: 2 })).toBeNull();
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
