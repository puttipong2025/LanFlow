import { expect, test } from "@playwright/test";

import { loadSourceModule } from "./helpers/load-source-module";

const locationId = "71000000-0000-4000-8000-000000000021";
const billId = "71000000-0000-4000-8000-000000000022";

test("pending approval feed rejects a non-pending bill returned by the RPC", async () => {
  const supabase = {
    rpc: async () => ({
      data: {
        rows: [{
          row_kind: "bill",
          id: billId,
          approval_pending: false,
          location_id: locationId,
          work_identity: `bill:${billId}`,
          operational_sort_at: "2026-10-05T00:00:00.000Z",
          items: [],
        }],
        hasMore: false,
        nextSortAt: null,
        nextWorkIdentity: null,
      },
      error: null,
    }),
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    {
      "@/lib/server/auth": {
        hasSystemManagerAccess: () => true,
        requireAuth: async () => ({
          ok: true,
          auth: { sub: "user-1", role: "super_admin", locationIds: [locationId] },
          supabase,
        }),
      },
    },
  );

  const response = await route.GET({
    nextUrl: new URL(
      `http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=pending_approval`,
    ),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด",
  });
});

test("pending approval feed rejects a deleted bill returned by the RPC", async () => {
  const requestId = "71000000-0000-4000-8000-000000000023";
  const supabase = {
    rpc: async () => ({
      data: {
        rows: [{
          row_kind: "bill",
          id: billId,
          record_status: "deleted",
          approval_request_id: requestId,
          approval_pending: true,
          approval_operation: "update",
          approval_reasons: ["price"],
          approval_proposed_summary: {
            customerName: "ลูกค้าทดสอบ",
            billDate: "2026-10-06",
            billType: "บิลเครื่องชั่งเล็ก",
            netWeight: 1,
            averagePrice: 42,
            netRubberValue: 42,
            deductionTotal: 0,
            netTotal: 42,
          },
          revision_no: 1,
          location_id: locationId,
          work_identity: `bill:${billId}`,
          operational_sort_at: "2026-10-05T00:00:00.000Z",
          items: [],
        }],
        hasMore: false,
        nextSortAt: null,
        nextWorkIdentity: null,
      },
      error: null,
    }),
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    {
      "@/lib/server/auth": {
        hasSystemManagerAccess: () => true,
        requireAuth: async () => ({
          ok: true,
          auth: { sub: "user-1", role: "super_admin", locationIds: [locationId] },
          supabase,
        }),
      },
    },
  );

  const response = await route.GET({
    nextUrl: new URL(
      `http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=pending_approval`,
    ),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด",
  });
});

test("unpriced feed rejects a bill whose weigh rows are already priced", async () => {
  const supabase = {
    rpc: async () => ({
      data: {
        rows: [{
          row_kind: "bill",
          id: billId,
          approval_pending: false,
          location_id: locationId,
          work_identity: `bill:${billId}`,
          operational_sort_at: "2026-10-05T00:00:00.000Z",
          items: [{ item_type: "weigh", price: 42 }],
        }],
        hasMore: false,
        nextSortAt: null,
        nextWorkIdentity: null,
      },
      error: null,
    }),
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    {
      "@/lib/server/auth": {
        hasSystemManagerAccess: () => true,
        requireAuth: async () => ({
          ok: true,
          auth: { sub: "user-1", role: "super_admin", locationIds: [locationId] },
          supabase,
        }),
      },
    },
  );

  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=unpriced`),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด",
  });
});

test("editable feed rejects a pending create returned by the RPC", async () => {
  const supabase = {
    rpc: async () => ({
      data: {
        rows: [{
          row_kind: "approval_create",
          id: billId,
          approval_request_id: billId,
          approval_pending: true,
          approval_operation: "create",
          approval_reasons: ["price"],
          revision_no: 0,
          location_id: locationId,
          work_identity: `approval:${billId}`,
          operational_sort_at: "2026-10-05T00:00:00.000Z",
          items: [],
        }],
        hasMore: false,
        nextSortAt: null,
        nextWorkIdentity: null,
      },
      error: null,
    }),
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    {
      "@/lib/server/auth": {
        hasSystemManagerAccess: () => true,
        requireAuth: async () => ({
          ok: true,
          auth: { sub: "user-1", role: "super_admin", locationIds: [locationId] },
          supabase,
        }),
      },
    },
  );

  const response = await route.GET({
    nextUrl: new URL(
      `http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}&documentStatus=editable`,
    ),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด",
  });
});

test("report-locked feed rejects an empty report lock number", async () => {
  const requestId = "71000000-0000-4000-8000-000000000023";
  const supabase = {
    rpc: async () => ({
      data: {
        rows: [{
          row_kind: "bill",
          id: billId,
          approval_request_id: requestId,
          approval_pending: true,
          approval_operation: "update",
          approval_reasons: ["price"],
          approval_proposed_summary: {
            customerName: "ลูกค้าทดสอบ",
            billDate: "2026-10-06",
            billType: "บิลเครื่องชั่งเล็ก",
            netWeight: 1,
            averagePrice: 42,
            netRubberValue: 42,
            deductionTotal: 0,
            netTotal: 42,
          },
          report_lock_no: "",
          location_id: locationId,
          work_identity: `bill:${billId}`,
          operational_sort_at: "2026-10-05T00:00:00.000Z",
          items: [],
        }],
        hasMore: false,
        nextSortAt: null,
        nextWorkIdentity: null,
      },
      error: null,
    }),
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    {
      "@/lib/server/auth": {
        hasSystemManagerAccess: () => true,
        requireAuth: async () => ({
          ok: true,
          auth: { sub: "user-1", role: "super_admin", locationIds: [locationId] },
          supabase,
        }),
      },
    },
  );

  const response = await route.GET({
    nextUrl: new URL(
      `http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=pending_approval&documentStatus=report_locked`,
    ),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด",
  });
});
