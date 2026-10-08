import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildRubberBillReceiptModel,
  renderRubberBillReceiptHtml,
} from "@/components/rubber-bills/bill-display";
import { mapRubberExportRow } from "@/lib/server/rubber-export-response";
import type { RubberBill } from "@/types";
import { loadSourceModule } from "./helpers/load-source-module";

const caseVariantLocationId = "6a000000-0000-4000-8000-000000000002";
const caseVariantExportId = "6b000000-0000-4000-8000-000000000003";
const validReceiptResult = {
  status: "received",
  billId: "6c000000-0000-4000-8000-000000000004",
  billNo: "RB-001",
  sourceExportId: caseVariantExportId,
  sourceExportNo: "REX-001",
  receivedAt: "2026-10-08T00:00:00.000Z",
  receivedAgeHours: 24,
};

function branchReceiptRow(id: string, verifiedAt: string) {
  return {
    source_rubber_export_id: id,
    source_export_no: `REX-${id.slice(0, 2)}`,
    source_location_id: caseVariantLocationId,
    source_location_name: "สาขาทดสอบ",
    verified_at: verifiedAt,
    current_weight: 100,
    rubber_value: 3_500,
    received_age_hours: 24,
    age_is_estimated: false,
    is_same_location: true,
  };
}

function branchReceiptRouteDependencies(rpc: (name: string, args: unknown) => Promise<unknown>) {
  return {
    "@/lib/server/auth": {
      hasSystemManagerAccess: () => false,
      requireAuth: async () => ({
        ok: true,
        auth: {
          sub: "user-1",
          role: "admin",
          locationIds: [caseVariantLocationId],
        },
        supabase: { rpc },
      }),
    },
  };
}

function branchReceiptBill(): RubberBill {
  return {
    id: "61000000-0000-4000-8000-000000000001",
    clientTempId: "branch-receipt-test",
    localBillNo: "2608100001",
    serverBillNo: "2608100001",
    syncStatus: "synced",
    idempotencyKey: "branch-receipt-test",
    locationId: "61000000-0000-4000-8000-000000000002",
    billNo: "2608100001",
    billDate: "2026-08-10",
    customerName: "รับยางจากสาขา สาขาต้นทาง",
    billType: "บิลเครื่องชั่งเล็ก",
    deductWeight: 0,
    weight: 100,
    netWeight: 100,
    weighValueTotal: 3_600,
    rubberValue: 3_600,
    price: 36,
    deductionTotal: 3_600,
    payableBeforeRounding: 0,
    netTotal: 0,
    acidPackCount: 0,
    approvalState: "not_required",
    weighItems: [{
      id: "weigh-1",
      label: "รับยางจากสาขา สาขาต้นทาง",
      inWeight: 100,
      outWeight: 0,
      netWeight: 100,
      price: 35.99,
      total: 3_600,
    }],
    debtItems: [{
      id: "debt-1",
      title: "หักมูลค่ายางรับจากสาขา สาขาต้นทาง",
      amount: 3_600,
    }],
    createdByUserId: "user-1",
    createdByName: "ผู้รับเข้า",
    createdByPhone: "",
    clientCreatedAt: "2026-08-10T08:00:00.000Z",
    clientRecordedAt: "2026-08-10T08:00:00.000Z",
    serverReceivedAt: "2026-08-10T08:00:00.000Z",
    revisionNo: 1,
    recordStatus: "active",
    sourceRubberExportId: "61000000-0000-4000-8000-000000000003",
    sourceExportNo: "REX-20260807-001",
    receivedAt: "2026-08-10T08:00:00.000Z",
    receivedAgeHours: 168,
    receivedAgeIsEstimated: true,
  };
}

test("renders branch source, compensated age, carried value and zero payable in the Rubber Bill receipt", () => {
  const model = buildRubberBillReceiptModel(branchReceiptBill());
  const html = renderRubberBillReceiptHtml(model);

  expect(model.weighItems[0].lineTotal).toBe(3_600);
  expect(html).toContain("ใบรับยางจากสาขา");
  expect(html).toContain("ราคาเฉลี่ย");
  expect(html).toContain("มูลค่ารวมค่าทำงาน");
  expect(html).toContain("REX-20260807-001");
  expect(html).toContain("7 วัน 0 ชั่วโมง (ประมาณการ)");
  expect(html).toContain("ยอดที่ต้องจ่ายลูกค้า");
  expect(html).not.toContain("ยังไม่กำหนดราคา");
});

test("maps the active destination receipt onto the source Rubber Export", () => {
  const summary = mapRubberExportRow({
    id: "export-1",
    export_no: "REX-001",
    location_id: "source-1",
    locations: { name: "สาขาต้นทาง" },
    status: "verified",
    original_weight_total: 100,
    paid_total: 3_600,
    rubber_value_total: 3_600,
    average_price: 36,
    other_operating_cost: 0,
    created_by_name: "ผู้สร้าง",
    created_at: "2026-08-07T08:00:00.000Z",
    rubber_export_items: [{ count: 1 }],
    receipt_bill_id: "bill-1",
    receipt_bill_no: "2608100001",
    receipt_location_name: "สาขาปลายทาง",
  });

  expect(summary).toMatchObject({
    receiptBillId: "bill-1",
    receiptBillNo: "2608100001",
    receiptLocationName: "สาขาปลายทาง",
    rubberValueTotal: 3_600,
  });
});

test("keeps the edit action out of branch-receipt rows", () => {
  const source = readFileSync(resolve("src/components/rubber-bills/RubberBillsTable.tsx"), "utf8");
  expect(source).toContain("!bill.sourceRubberExportId && <button");
  expect(source).toContain("รับจากสาขา");
  expect(source).toContain("อายุตอนรับ");
});

test("branch receipt feed canonicalizes a valid destination UUID before access checks", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/branch-receipts/route")>(
    "src/app/api/lanflow/rubber-bills/branch-receipts/route.ts",
    branchReceiptRouteDependencies(async (name, args) => {
      calls.push({ name, args });
      return {
        data: {
          rows: [],
          hasMore: false,
          nextSameLocation: null,
          nextVerifiedAt: null,
          nextId: null,
        },
        error: null,
      };
    }),
  );

  const response = await route.GET({
    nextUrl: new URL(
      `http://local/api/lanflow/rubber-bills/branch-receipts?destinationLocationId=${caseVariantLocationId.toUpperCase()}`,
    ),
  } as never);

  expect(response.status).toBe(200);
  expect(calls).toEqual([{
    name: "get_receivable_rubber_exports_page",
    args: expect.objectContaining({ p_destination_location_id: caseVariantLocationId }),
  }]);
});

test("branch receipt feed lowercase UUID control remains accepted", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/branch-receipts/route")>(
    "src/app/api/lanflow/rubber-bills/branch-receipts/route.ts",
    branchReceiptRouteDependencies(async () => ({
      data: {
        rows: [],
        hasMore: false,
        nextSameLocation: null,
        nextVerifiedAt: null,
        nextId: null,
      },
      error: null,
    })),
  );

  const response = await route.GET({
    nextUrl: new URL(
      `http://local/api/lanflow/rubber-bills/branch-receipts?destinationLocationId=${caseVariantLocationId}`,
    ),
  } as never);

  expect(response.status).toBe(200);
});

test("branch receipt feed accepts a search at the shared 200-character boundary", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const search = "x".repeat(200);
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/branch-receipts/route")>(
    "src/app/api/lanflow/rubber-bills/branch-receipts/route.ts",
    branchReceiptRouteDependencies(async (name, args) => {
      calls.push({ name, args });
      return {
        data: {
          rows: [],
          hasMore: false,
          nextSameLocation: null,
          nextVerifiedAt: null,
          nextId: null,
        },
        error: null,
      };
    }),
  );

  const response = await route.GET({
    nextUrl: new URL(
      `http://local/api/lanflow/rubber-bills/branch-receipts?destinationLocationId=${caseVariantLocationId}&search=${search}`,
    ),
  } as never);

  expect(response.status).toBe(200);
  expect(calls).toEqual([{
    name: "get_receivable_rubber_exports_page",
    args: expect.objectContaining({ p_search: search }),
  }]);
});

test("branch receipt feed rejects an oversized search before calling the RPC", async () => {
  let rpcCalls = 0;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/branch-receipts/route")>(
    "src/app/api/lanflow/rubber-bills/branch-receipts/route.ts",
    branchReceiptRouteDependencies(async () => {
      rpcCalls += 1;
      return {
        data: {
          rows: [],
          hasMore: false,
          nextSameLocation: null,
          nextVerifiedAt: null,
          nextId: null,
        },
        error: null,
      };
    }),
  );

  const response = await route.GET({
    nextUrl: new URL(
      `http://local/api/lanflow/rubber-bills/branch-receipts?destinationLocationId=${caseVariantLocationId}&search=${"x".repeat(201)}`,
    ),
  } as never);

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "พารามิเตอร์รายการรับยางไม่ถูกต้อง" });
  expect(rpcCalls).toBe(0);
});

test("branch receipt creation canonicalizes valid destination and source UUIDs", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/branch-receipts/route")>(
    "src/app/api/lanflow/rubber-bills/branch-receipts/route.ts",
    branchReceiptRouteDependencies(async (name, args) => {
      calls.push({ name, args });
      return { data: validReceiptResult, error: null };
    }),
  );

  const response = await route.POST(new Request(
    "http://local/api/lanflow/rubber-bills/branch-receipts",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destinationLocationId: caseVariantLocationId.toUpperCase(),
        sourceRubberExportId: caseVariantExportId.toUpperCase(),
      }),
    },
  ));

  expect(response.status).toBe(201);
  expect(calls).toEqual([{
    name: "receive_rubber_export",
    args: {
      p_destination_location_id: caseVariantLocationId,
      p_source_rubber_export_id: caseVariantExportId,
    },
  }]);
});

test("branch receipt route hides unexpected database diagnostics", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/branch-receipts/route")>(
    "src/app/api/lanflow/rubber-bills/branch-receipts/route.ts",
    branchReceiptRouteDependencies(async () => ({
      data: null,
      error: { message: "relation public.private_receipts does not exist" },
    })),
  );

  const response = await route.GET({
    nextUrl: new URL(
      `http://local/api/lanflow/rubber-bills/branch-receipts?destinationLocationId=${caseVariantLocationId}`,
    ),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "ดำเนินการรับยางจากสาขาไม่สำเร็จ" });
});

test("branch receipt route preserves known source-stale conflicts", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/branch-receipts/route")>(
    "src/app/api/lanflow/rubber-bills/branch-receipts/route.ts",
    branchReceiptRouteDependencies(async () => ({
      data: null,
      error: { message: "BRANCH_RECEIPT_SOURCE_STALE" },
    })),
  );

  const response = await route.GET({
    nextUrl: new URL(
      `http://local/api/lanflow/rubber-bills/branch-receipts?destinationLocationId=${caseVariantLocationId}`,
    ),
  } as never);

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "รายการนี้ไม่พร้อมรับแล้ว กรุณารีเฟรชและเลือกใหม่",
  });
});

test("branch receipt feed rejects a null RPC payload", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/branch-receipts/route")>(
    "src/app/api/lanflow/rubber-bills/branch-receipts/route.ts",
    branchReceiptRouteDependencies(async () => ({ data: null, error: null })),
  );

  const response = await route.GET({
    nextUrl: new URL(
      `http://local/api/lanflow/rubber-bills/branch-receipts?destinationLocationId=${caseVariantLocationId}`,
    ),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับรายการรับยางตามรูปแบบที่กำหนด" });
});

test("branch receipt feed rejects rows outside the database pagination order", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/branch-receipts/route")>(
    "src/app/api/lanflow/rubber-bills/branch-receipts/route.ts",
    branchReceiptRouteDependencies(async () => ({
      data: {
        rows: [
          branchReceiptRow("6d000000-0000-4000-8000-000000000005", "2026-10-07T00:00:00.000Z"),
          branchReceiptRow("6e000000-0000-4000-8000-000000000006", "2026-10-08T00:00:00.000Z"),
        ],
        hasMore: false,
        nextSameLocation: null,
        nextVerifiedAt: null,
        nextId: null,
      },
      error: null,
    })),
  );

  const response = await route.GET({
    nextUrl: new URL(
      `http://local/api/lanflow/rubber-bills/branch-receipts?destinationLocationId=${caseVariantLocationId}`,
    ),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับรายการรับยางตามรูปแบบที่กำหนด" });
});

test("branch receipt feed accepts rows in database pagination order", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/branch-receipts/route")>(
    "src/app/api/lanflow/rubber-bills/branch-receipts/route.ts",
    branchReceiptRouteDependencies(async () => ({
      data: {
        rows: [
          branchReceiptRow("6e000000-0000-4000-8000-000000000006", "2026-10-08T00:00:00.000Z"),
          branchReceiptRow("6d000000-0000-4000-8000-000000000005", "2026-10-07T00:00:00.000Z"),
        ],
        hasMore: false,
        nextSameLocation: null,
        nextVerifiedAt: null,
        nextId: null,
      },
      error: null,
    })),
  );

  const response = await route.GET({
    nextUrl: new URL(
      `http://local/api/lanflow/rubber-bills/branch-receipts?destinationLocationId=${caseVariantLocationId}`,
    ),
  } as never);

  expect(response.status).toBe(200);
});

test("branch receipt creation rejects an incomplete success payload", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/branch-receipts/route")>(
    "src/app/api/lanflow/rubber-bills/branch-receipts/route.ts",
    branchReceiptRouteDependencies(async () => ({
      data: { status: "received" },
      error: null,
    })),
  );

  const response = await route.POST(new Request(
    "http://local/api/lanflow/rubber-bills/branch-receipts",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destinationLocationId: caseVariantLocationId,
        sourceRubberExportId: caseVariantExportId,
      }),
    },
  ));

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับผลการรับยางตามรูปแบบที่กำหนด" });
});
