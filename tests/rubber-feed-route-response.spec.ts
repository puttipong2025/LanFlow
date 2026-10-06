import { expect, test } from "@playwright/test";

import { mapRubberBillFeedRow } from "../src/lib/rubber-bills/map-feed-row";
import { loadSourceModule } from "./helpers/load-source-module";

const locationId = "71000000-0000-4000-8000-000000000021";

function feedRouteDependencies(data: unknown) {
  const supabase = { rpc: async () => ({ data, error: null }) };
  return {
    "@/lib/server/auth": {
      hasSystemManagerAccess: () => true,
      requireAuth: async () => ({
        ok: true,
        auth: { sub: "user-1", role: "super_admin", locationIds: [locationId] },
        supabase,
      }),
    },
  };
}

function sequencedFeedRouteDependencies(dataByCall: unknown[]) {
  let callIndex = 0;
  const supabase = {
    rpc: async () => ({ data: dataByCall[callIndex++], error: null }),
  };
  return {
    "@/lib/server/auth": {
      hasSystemManagerAccess: () => true,
      requireAuth: async () => ({
        ok: true,
        auth: { sub: "user-1", role: "super_admin", locationIds: [locationId] },
        supabase,
      }),
    },
  };
}

test("pending-create rows keep approval identity separate from real bill ids", () => {
  const requestId = "71000000-0000-4000-8000-000000000022";
  const bill = mapRubberBillFeedRow({
    row_kind: "approval_create",
    work_identity: `approval:${requestId}`,
    id: requestId,
    approval_request_id: requestId,
    location_id: locationId,
    operational_sort_at: "2026-10-05T00:00:00.000Z",
  });

  expect(bill.id).toBe(`approval:${requestId}`);
  expect(bill.approvalRequestId).toBe(requestId);
});

test("rubber bill feed rejects a malformed next cursor from the RPC", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    feedRouteDependencies({
      rows: [],
      hasMore: true,
      nextSortAt: "0",
      nextWorkIdentity: "bill:71000000-0000-4000-8000-000000000022",
    }),
  );
  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}`),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด" });
});

test("rubber bill feed rejects an empty work identity in a client cursor", async () => {
  const cursor = Buffer.from(JSON.stringify({
    version: 2,
    ownerUserId: "user-1",
    locationId,
    mode: "latest",
    documentStatus: "any",
    search: "",
    sortAt: "2026-10-05T00:00:00.000Z",
    workIdentity: "",
  }), "utf8").toString("base64url");
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    feedRouteDependencies({ rows: [], hasMore: false, nextSortAt: null, nextWorkIdentity: null }),
  );
  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}&cursor=${cursor}`),
  } as never);

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "cursor ไม่ถูกต้อง", code: "INVALID_CURSOR" });
});

test("rubber bill feed rejects oversized query input before calling the RPC", async () => {
  let rpcCalls = 0;
  const supabase = {
    rpc: async () => {
      rpcCalls += 1;
      return { data: { rows: [], hasMore: false, nextSortAt: null, nextWorkIdentity: null }, error: null };
    },
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
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}&search=${"x".repeat(201)}`),
  } as never);

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "พารามิเตอร์รายการบิลยางไม่ถูกต้อง" });
  expect(rpcCalls).toBe(0);
});

test("rubber bill feed rejects rows without client identity and sort invariants", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    feedRouteDependencies({
      rows: [{}, {}],
      hasMore: false,
      nextSortAt: null,
      nextWorkIdentity: null,
    }),
  );
  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}`),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด" });
});

test("rubber bill feed rejects pending-create rows without approval invariants", async () => {
  const requestId = "71000000-0000-4000-8000-000000000022";
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    feedRouteDependencies({
      rows: [{
        row_kind: "approval_create",
        id: requestId,
        location_id: locationId,
        work_identity: `approval:${requestId}`,
        operational_sort_at: "2026-10-05T00:00:00.000Z",
      }],
      hasMore: false,
      nextSortAt: null,
      nextWorkIdentity: null,
    }),
  );
  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}`),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด" });
});

test("rubber bill feed rejects retired raw approval payload fields", async () => {
  const requestId = "71000000-0000-4000-8000-000000000022";
  const retiredFields = ["original_payload", "proposed_payload", "approval_original_summary"];
  for (const field of retiredFields) {
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
      "src/app/api/lanflow/rubber-bills/feed/route.ts",
      feedRouteDependencies({
        rows: [{
          row_kind: "approval_create",
          id: requestId,
          approval_request_id: requestId,
          approval_pending: true,
          approval_operation: "create",
          approval_reasons: ["price"],
          revision_no: 0,
          location_id: locationId,
          work_identity: `approval:${requestId}`,
          operational_sort_at: "2026-10-05T00:00:00.000Z",
          items: [],
          [field]: { shouldNotReachBrowser: true },
        }],
        hasMore: false,
        nextSortAt: null,
        nextWorkIdentity: null,
      }),
    );
    const response = await route.GET({
      nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=pending_approval`),
    } as never);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด" });
  }
});

test("rubber bill feed rejects duplicate work identities from the RPC", async () => {
  const requestId = "71000000-0000-4000-8000-000000000022";
  const duplicateRow = {
    row_kind: "approval_create",
    id: requestId,
    approval_request_id: requestId,
    approval_pending: true,
    approval_operation: "create",
    approval_reasons: ["price"],
    revision_no: 0,
    location_id: locationId,
    work_identity: `approval:${requestId}`,
    operational_sort_at: "2026-10-05T00:00:00.000Z",
    items: [],
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    feedRouteDependencies({
      rows: [duplicateRow, { ...duplicateRow }],
      hasMore: false,
      nextSortAt: null,
      nextWorkIdentity: null,
    }),
  );
  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=pending_approval`),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด" });
});

test("rubber bill feed rejects malformed approval reasons before the UI maps them", async () => {
  const requestId = "71000000-0000-4000-8000-000000000022";
  const billId = "71000000-0000-4000-8000-000000000023";
  const malformedRows = [
    {
      row_kind: "approval_create",
      id: requestId,
      record_status: "active",
      approval_request_id: requestId,
      approval_pending: true,
      approval_operation: "create",
      approval_reasons: "price",
      revision_no: 0,
      location_id: locationId,
      work_identity: `approval:${requestId}`,
      operational_sort_at: "2026-10-05T00:00:00.000Z",
      items: [],
    },
    {
      row_kind: "bill",
      id: billId,
      record_status: "active",
      approval_request_id: requestId,
      approval_pending: true,
      approval_operation: "update",
      approval_reasons: ["unknown_reason"],
      revision_no: 1,
      location_id: locationId,
      work_identity: `bill:${billId}`,
      operational_sort_at: "2026-10-05T00:00:00.000Z",
      items: [],
    },
  ];

  for (const row of malformedRows) {
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
      "src/app/api/lanflow/rubber-bills/feed/route.ts",
      feedRouteDependencies({
        rows: [row],
        hasMore: false,
        nextSortAt: null,
        nextWorkIdentity: null,
      }),
    );
    const response = await route.GET({
      nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=pending_approval`),
    } as never);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด" });
  }
});

test("rubber bill feed preserves valid pending approval reasons", async () => {
  const requestId = "71000000-0000-4000-8000-000000000022";
  const billId = "71000000-0000-4000-8000-000000000023";
  const rows = [
    {
      row_kind: "approval_create",
      id: requestId,
      record_status: "active",
      approval_request_id: requestId,
      approval_pending: true,
      approval_operation: "create",
      approval_reasons: ["price", "non_current_date"],
      revision_no: 0,
      location_id: locationId,
      work_identity: `approval:${requestId}`,
      operational_sort_at: "2026-10-05T00:00:00.000002Z",
      items: [],
    },
    {
      row_kind: "bill",
      id: billId,
      record_status: "active",
      approval_request_id: requestId,
      approval_pending: true,
      approval_operation: "delete",
      approval_reasons: ["time"],
      approval_proposed_summary: {
        customerName: "ลูกค้าทดสอบ",
        billDate: "2026-10-05",
        billType: "บิลเครื่องชั่งเล็ก",
        netWeight: 100,
        averagePrice: 42,
        netRubberValue: 4_200,
        deductionTotal: 0,
        netTotal: 4_200,
      },
      revision_no: 1,
      location_id: locationId,
      work_identity: `bill:${billId}`,
      operational_sort_at: "2026-10-05T00:00:00.000001Z",
      items: [],
    },
  ];

  for (const row of rows) {
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
      "src/app/api/lanflow/rubber-bills/feed/route.ts",
      feedRouteDependencies({
        rows: [row],
        hasMore: false,
        nextSortAt: null,
        nextWorkIdentity: null,
      }),
    );
    const response = await route.GET({
      nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=pending_approval`),
    } as never);

    expect(response.status).toBe(200);
    expect((await response.json()).rows).toEqual([row]);
  }
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    feedRouteDependencies({ rows, hasMore: false, nextSortAt: null, nextWorkIdentity: null }),
  );
  const response = await route.GET({ nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=pending_approval`) } as never);
  expect(response.status).toBe(500);
});

test("rubber bill feed rejects malformed item rows before the mapper reads them", async () => {
  const requestId = "71000000-0000-4000-8000-000000000022";
  const malformedItems = [{ description: { malformed: true } }, { price: { malformed: true } }];
  for (const malformedItem of malformedItems) {
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
      "src/app/api/lanflow/rubber-bills/feed/route.ts",
      feedRouteDependencies({
        rows: [{
          row_kind: "approval_create",
          id: requestId,
          approval_request_id: requestId,
          approval_pending: true,
          approval_operation: "create",
          approval_reasons: ["price"],
          revision_no: 0,
          location_id: locationId,
          work_identity: `approval:${requestId}`,
          operational_sort_at: "2026-10-05T00:00:00.000Z",
          items: [malformedItem],
        }],
        hasMore: false,
        nextSortAt: null,
        nextWorkIdentity: null,
      }),
    );
    const response = await route.GET({
      nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=pending_approval`),
    } as never);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด" });
  }
});

test("rubber bill approval feed rejects bill-backed requests without a proposed summary", async () => {
  const requestId = "71000000-0000-4000-8000-000000000022";
  const billId = "71000000-0000-4000-8000-000000000023";
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    feedRouteDependencies({
      rows: [{
        row_kind: "bill",
        id: billId,
        approval_request_id: requestId,
        approval_pending: true,
        approval_operation: "update",
        approval_reasons: ["price"],
        revision_no: 1,
        location_id: locationId,
        work_identity: `bill:${billId}`,
        operational_sort_at: "2026-10-05T00:00:00.000Z",
        items: [],
      }],
      hasMore: false,
      nextSortAt: null,
      nextWorkIdentity: null,
    }),
  );
  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=pending_approval`),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด" });
});

test("rubber bill feed rejects a malformed proposed summary before React renders it", async () => {
  const requestId = "71000000-0000-4000-8000-000000000022";
  const billId = "71000000-0000-4000-8000-000000000023";
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    feedRouteDependencies({
      rows: [{
        row_kind: "bill",
        id: billId,
        approval_request_id: requestId,
        approval_pending: true,
        approval_operation: "update",
        approval_reasons: ["price"],
        approval_proposed_summary: {
          customerName: { malformed: true },
          billDate: "2026-10-05",
          billType: "บิลเครื่องชั่งเล็ก",
          netWeight: 100,
          averagePrice: 42,
          netRubberValue: 4_200,
          deductionTotal: 0,
          netTotal: 4_200,
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
    }),
  );
  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=pending_approval`),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด" });
});

test("rubber bill feed rejects malformed display values before React renders the bill", async () => {
  const requestId = "71000000-0000-4000-8000-000000000022";
  const billId = "71000000-0000-4000-8000-000000000023";
  for (const malformedField of [{ customer_name: { malformed: true } }, { net_total: { malformed: true } }]) {
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
      "src/app/api/lanflow/rubber-bills/feed/route.ts",
      feedRouteDependencies({
        rows: [{
          row_kind: "bill",
          id: billId,
          ...malformedField,
          approval_request_id: requestId,
          approval_pending: true,
          approval_operation: "update",
          approval_reasons: ["price"],
          revision_no: 1,
          location_id: locationId,
          work_identity: `bill:${billId}`,
          operational_sort_at: "2026-10-05T00:00:00.000Z",
          items: [],
        }],
        hasMore: false,
        nextSortAt: null,
        nextWorkIdentity: null,
      }),
    );
    const response = await route.GET({
      nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=pending_approval`),
    } as never);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด" });
  }
});

test("rubber bill feed rejects an empty page that still claims to have more rows", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    feedRouteDependencies({
      rows: [],
      hasMore: true,
      nextSortAt: "2026-10-05T00:00:00.000Z",
      nextWorkIdentity: "bill:71000000-0000-4000-8000-000000000022",
    }),
  );
  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}`),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด" });
});

test("rubber bill feed rejects malformed evidence states from the RPC", async () => {
  const billId = "71000000-0000-4000-8000-000000000022";
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    sequencedFeedRouteDependencies([
      {
        rows: [{
          row_kind: "bill",
          id: billId,
          record_status: "active",
          approval_pending: false,
          location_id: locationId,
          work_identity: `bill:${billId}`,
          operational_sort_at: "2026-10-05T00:00:00.000Z",
          items: [],
        }],
        hasMore: false,
        nextSortAt: "2026-10-05T00:00:00.000Z",
        nextWorkIdentity: `bill:${billId}`,
      },
      {},
    ]),
  );
  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}`),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับสถานะหลักฐานตามรูปแบบที่กำหนด" });
});

test("rubber bill feed rejects evidence objects with missing fields", async () => {
  const billId = "71000000-0000-4000-8000-000000000022";
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    sequencedFeedRouteDependencies([
      {
        rows: [{
          row_kind: "bill",
          id: billId,
          record_status: "active",
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
      [{}],
    ]),
  );
  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}`),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับสถานะหลักฐานตามรูปแบบที่กำหนด" });
});

test("rubber bill feed rejects missing evidence states for returned bills", async () => {
  const billId = "71000000-0000-4000-8000-000000000022";
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/feed/route")>(
    "src/app/api/lanflow/rubber-bills/feed/route.ts",
    sequencedFeedRouteDependencies([
      {
        rows: [{
          row_kind: "bill",
          id: billId,
          record_status: "active",
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
      [],
    ]),
  );
  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/feed?locationId=${locationId}`),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "ระบบไม่ตอบกลับสถานะหลักฐานตามรูปแบบที่กำหนด" });
});
