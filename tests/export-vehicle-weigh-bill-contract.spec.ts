import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

import {
  canManageExportVehicleWeighBills,
  exportVehicleWeighBillErrorResponse,
  mapExportVehicleWeighBillDetail,
  parseCreateExportVehicleWeighBillPayload,
  parseDeleteExportVehicleWeighBillPayload,
  parseUpdateExportVehicleWeighBillPayload,
} from "../src/lib/server/export-vehicle-weigh-bill-response";
import type { AuthTokenPayload } from "../src/lib/server/auth";

const locationId = "11111111-1111-4111-8111-111111111111";
const rubberExportId = "22222222-2222-4222-8222-222222222222";
const carrierId = "44444444-4444-4444-8444-444444444444";

const line = {
  vehicleRegistration: "  กข   1234  ",
  carrierId: null,
  carrierName: null,
  inboundAt: "2026-08-24T01:00:00.000Z",
  inboundWeight: 1_000,
  outboundAt: "2026-08-24T02:00:00.000Z",
  outboundWeight: 1_500,
};

function auth(overrides: Partial<AuthTokenPayload> = {}): AuthTokenPayload {
  return {
    sub: "33333333-3333-4333-8333-333333333333",
    phone: "",
    name: "WEX contract actor",
    role: "admin",
    locationIds: [locationId],
    primaryLocationId: locationId,
    canAccessSystemManager: false,
    canAccessMoneyTransfer: false,
    canManageTimePayroll: false,
    ...overrides,
  };
}

test("normalizes a valid create payload and rejects malformed vehicle evidence", () => {
  expect(parseCreateExportVehicleWeighBillPayload({
    locationId,
    lines: [line],
    rubberExportIds: [rubberExportId],
  })).toEqual({
    locationId,
    lines: [{ ...line, vehicleRegistration: "กข 1234" }],
    rubberExportIds: [rubberExportId],
  });

  expect(parseCreateExportVehicleWeighBillPayload({
    locationId,
    lines: [],
    rubberExportIds: [],
  })).toBeNull();
  expect(parseCreateExportVehicleWeighBillPayload({
    locationId,
    lines: [line, { ...line, vehicleRegistration: "กข 1234" }],
    rubberExportIds: [],
  })).toBeNull();
  expect(parseCreateExportVehicleWeighBillPayload({
    locationId,
    lines: [{ ...line, outboundWeight: line.inboundWeight }],
    rubberExportIds: [],
  })).toBeNull();
  expect(parseCreateExportVehicleWeighBillPayload({
    locationId,
    lines: [{ ...line, outboundAt: line.inboundAt }],
    rubberExportIds: [],
  })).toBeNull();
  expect(parseCreateExportVehicleWeighBillPayload({
    locationId,
    lines: [line],
    rubberExportIds: [rubberExportId, rubberExportId],
  })).toBeNull();
});

test("accepts an inbound-only weigh line with zero outbound weight", () => {
  expect(parseCreateExportVehicleWeighBillPayload({
    locationId,
    lines: [{
      ...line,
      outboundAt: null,
      outboundWeight: 0,
    }],
    rubberExportIds: [],
  })).toEqual({
    locationId,
    lines: [{
      ...line,
      vehicleRegistration: "กข 1234",
      outboundAt: null,
      outboundWeight: 0,
    }],
    rubberExportIds: [],
  });

  expect(parseCreateExportVehicleWeighBillPayload({
    locationId,
    lines: [{ ...line, outboundWeight: 0 }],
    rubberExportIds: [],
  })).toBeNull();
  expect(parseCreateExportVehicleWeighBillPayload({
    locationId,
    lines: [{ ...line, outboundAt: null }],
    rubberExportIds: [],
  })).toBeNull();
});

test("normalizes optional carriers and maps nullable carrier snapshots in detail", () => {
  const selected = parseCreateExportVehicleWeighBillPayload({
    locationId,
    lines: [{ ...line, carrierId, carrierName: "  ชื่อ   ที่ client ส่ง  " }],
    rubberExportIds: [],
  });
  expect(selected?.lines[0]).toMatchObject({
    carrierId,
    carrierName: "ชื่อ ที่ client ส่ง",
  });

  const manual = parseCreateExportVehicleWeighBillPayload({
    locationId,
    lines: [{ ...line, carrierName: "  ขนส่ง   กรอกเอง  " }],
    rubberExportIds: [],
  });
  expect(manual?.lines[0]).toMatchObject({ carrierId: null, carrierName: "ขนส่ง กรอกเอง" });

  const blank = parseCreateExportVehicleWeighBillPayload({
    locationId,
    lines: [{ ...line, carrierId: "", carrierName: "   " }],
    rubberExportIds: [],
  });
  expect(blank?.lines[0]).toMatchObject({ carrierId: null, carrierName: null });

  expect(parseCreateExportVehicleWeighBillPayload({
    locationId,
    lines: [{ ...line, carrierId: "not-a-uuid", carrierName: "ผู้ขนส่ง" }],
    rubberExportIds: [],
  })).toBeNull();

  expect(mapExportVehicleWeighBillDetail({
    id: locationId,
    wexNo: "WEX-20260824-001",
    locationId,
    locationName: "สาขาทดสอบ",
    revision: 1,
    vehicleCount: 1,
    rubberExportCount: 0,
    vehicleNetWeight: 500,
    reservedRubberWeight: 0,
    remainingWeight: 500,
    createdByName: "ผู้สร้าง",
    createdAt: line.inboundAt,
    updatedAt: line.outboundAt,
    lines: [{
      id: rubberExportId,
      sequenceNo: 1,
      vehicleRegistration: "กข 1234",
      carrierId,
      carrierName: "ชื่อจาก master",
      inboundAt: line.inboundAt,
      inboundWeight: 1_000,
      outboundAt: line.outboundAt,
      outboundWeight: 1_500,
      netWeight: 500,
    }],
    rubberExports: [],
  })?.lines[0]).toMatchObject({ carrierId, carrierName: "ชื่อจาก master" });
});

test("requires positive revisions for update and idempotent delete requests", () => {
  expect(parseUpdateExportVehicleWeighBillPayload({
    expectedRevision: 3,
    lines: [line],
    rubberExportIds: [],
  })).toEqual({
    expectedRevision: 3,
    lines: [{ ...line, vehicleRegistration: "กข 1234" }],
    rubberExportIds: [],
  });
  expect(parseUpdateExportVehicleWeighBillPayload({
    expectedRevision: 0,
    lines: [line],
    rubberExportIds: [],
  })).toBeNull();
  expect(parseDeleteExportVehicleWeighBillPayload({ expectedRevision: 2 }))
    .toEqual({ expectedRevision: 2 });
  expect(parseDeleteExportVehicleWeighBillPayload({ expectedRevision: 1.5 })).toBeNull();
});

test("allows assigned admins and system managers while preserving delete authority", () => {
  expect(canManageExportVehicleWeighBills(auth(), locationId)).toBe(true);
  expect(canManageExportVehicleWeighBills(auth({ locationIds: [] }), locationId)).toBe(false);
  expect(canManageExportVehicleWeighBills(auth({ role: "user" }), locationId)).toBe(false);
  expect(canManageExportVehicleWeighBills(auth({
    role: "user",
    locationIds: [],
    canAccessSystemManager: true,
  }), locationId)).toBe(true);
});

test("maps frozen WEX failures to the HTTP contract", async () => {
  const cases = [
    ["WEX_INVALID_LINES", 400],
    ["WEX_FORBIDDEN", 403],
    ["WEX_NOT_FOUND", 404],
    ["WEX_STALE_REVISION", 409],
    ["WEX_REX_RESERVED", 409],
    ["WEX_REX_INELIGIBLE", 409],
    ["WEX_CARRIER_INELIGIBLE", 409],
    ["WEX_OVERWEIGHT", 409],
    ["WEX_INCOMPLETE_WEIGHING", 409],
    ["WEX_RESERVATION_LOCKED", 409],
    ["unexpected", 500],
  ] as const;

  for (const [message, status] of cases) {
    const response = exportVehicleWeighBillErrorResponse(message);
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toEqual({ error: message });
  }
});

test("migration enforces atomic reservation, server weight, sale lock, and permanent delete", () => {
  const sql = readFileSync(resolve(
    "supabase/migrations/20260824030000_export_vehicle_weigh_bills.sql",
  ), "utf8");

  expect(sql).toContain("create table public.export_vehicle_weigh_bills");
  expect(sql).toContain("create table public.export_vehicle_weigh_lines");
  expect(sql).toContain("carrier_id uuid references public.transport_staffs(id)");
  expect(sql).toContain("carrier_name text");
  expect(sql).toContain("s.record_status = 'active'");
  expect(sql).toContain("s.default_location_id is null or s.default_location_id = p_location_id");
  expect(sql).toContain("s.main_name");
  expect(sql).toContain("create table public.export_vehicle_weigh_bill_reservations");
  expect(sql).toMatch(/unique\s*\(rubber_export_id\)/i);
  expect(sql).toContain("private.next_document_sequence('WEX'");
  expect(sql).toContain("'WEX-' || to_char(v_wex_date, 'YYYYMMDD')");
  expect(sql).toMatch(/order by e\.id\s+for update/i);
  expect(sql).toContain("sum(e.current_weight)");
  expect(sql).toContain("sum(l.outbound_weight - l.inbound_weight)");
  expect(sql).toContain("WEX_OVERWEIGHT");
  expect(sql).toContain("WEX_REX_RESERVED");
  expect(sql).toContain("WEX_RESERVATION_LOCKED");
  expect(sql).toContain("create or replace function public.set_rubber_export_sold_out");

  const deleteFunction = sql.match(
    /create(?: or replace)? function public\.delete_export_vehicle_weigh_bill[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";
  const auditAt = deleteFunction.indexOf("insert into public.document_deletion_audits");
  const reservationsAt = deleteFunction.indexOf("delete from public.export_vehicle_weigh_bill_reservations");
  const linesAt = deleteFunction.indexOf("delete from public.export_vehicle_weigh_lines");
  const parentAt = deleteFunction.indexOf("delete from public.export_vehicle_weigh_bills");
  expect(auditAt).toBeGreaterThan(0);
  expect(reservationsAt).toBeGreaterThan(auditAt);
  expect(linesAt).toBeGreaterThan(reservationsAt);
  expect(parentAt).toBeGreaterThan(linesAt);
  expect(deleteFunction).not.toMatch(/update\s+public\.rubber_exports/i);
  expect(deleteFunction).toContain("document_kind = 'export_vehicle_weigh_bill'");
  expect(deleteFunction).toContain("'status', 'deleted'");

  const inboundOnlySql = readFileSync(resolve(
    "supabase/migrations/20260825010000_allow_inbound_only_wex.sql",
  ), "utf8");
  expect(inboundOnlySql).toContain("outbound_weight = 0 and outbound_at is null");
  expect(inboundOnlySql).toContain("when outbound_weight = 0 then 0::numeric");
  expect(inboundOnlySql).toContain("sum(l.net_weight)");
  expect(inboundOnlySql).toContain("private.enforce_complete_wex_before_reservation");
  expect(inboundOnlySql).toContain("WEX_INCOMPLETE_WEIGHING");

  const sharedCarrierSql = readFileSync(resolve(
    "supabase/migrations/20260826030000_wex_shared_carrier.sql",
  ), "utf8");
  expect(sharedCarrierSql).toContain("create or replace function private.normalized_export_vehicle_weigh_lines");
  expect(sharedCarrierSql).toContain("v_shared_carrier_id");
  expect(sharedCarrierSql).toContain("v_shared_carrier_name");
  expect(sharedCarrierSql).toContain("p_lines->0->>'carrierId'");
});

test("routes expose only the frozen active WEX contract", () => {
  const collection = readFileSync(resolve(
    "src/app/api/lanflow/export-vehicle-weigh-bills/route.ts",
  ), "utf8");
  const options = readFileSync(resolve(
    "src/app/api/lanflow/export-vehicle-weigh-bills/options/route.ts",
  ), "utf8");
  const detail = readFileSync(resolve(
    "src/app/api/lanflow/export-vehicle-weigh-bills/[wexId]/route.ts",
  ), "utf8");

  expect(collection).toContain("create_export_vehicle_weigh_bill");
  expect(options).toContain("get_export_vehicle_weigh_bill_options");
  expect(options).toContain('.from("transport_staffs")');
  expect(options).toContain('record_status", "active"');
  expect(options).toContain("default_location_id.is.null");
  expect(options).toContain("default_location_id.eq.${locationId}");
  expect(options).toContain("carriers:");
  expect(detail).toContain("get_export_vehicle_weigh_bill_detail");
  expect(detail).toContain("update_export_vehicle_weigh_bill");
  expect(detail).toContain("delete_export_vehicle_weigh_bill");
  expect(detail).not.toContain("sold_out_at");
  expect(`${collection}\n${options}\n${detail}`).not.toContain("deletion-history");
});
