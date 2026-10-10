import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadSourceModule } from "./helpers/load-source-module";

const locationId = "71000000-0000-4000-8000-000000000021";
const recordId = "71000000-0000-4000-8000-000000000022";
const requestId = "71000000-0000-4000-8000-000000000023";

function validSyncPayload(overrides: Record<string, unknown> = {}) {
  return {
    operation: "create",
    expectedRevisionNo: 0,
    clientTempId: "income-expense-client-id",
    idempotencyKey: "create:income-expense-client-id:0",
    locationId,
    recordStatus: "active",
    localBillNo: "LOCAL-IE-1",
    txDate: "2026-10-07",
    type: "expense",
    title: "ค่าวัสดุทดสอบ",
    cost: 100,
    billOption: "ค่าใช้จ่าย",
    clientRecordedAt: "2026-10-07T01:00:00.000Z",
    clientCreatedAt: "2026-10-07T01:00:00.000Z",
    ...overrides,
  };
}

function routeDependencies(data: unknown, error: { message: string } | null = null) {
  const supabase = { rpc: async () => ({ data, error }) };
  return {
    "@/lib/server/auth": {
      hasSystemManagerAccess: () => true,
      requireAuth: async () => ({
        ok: true,
        auth: { sub: "user-1", role: "super_admin", locationIds: [locationId] },
        supabase,
      }),
      requireSystemManager: async () => ({
        ok: true,
        auth: { sub: "user-1", role: "super_admin", locationIds: [locationId] },
        supabase,
      }),
    },
  };
}

test("income/expense sync rejects malformed mutation identity before the RPC", async () => {
  let rpcCalls = 0;
  const dependencies = routeDependencies(null);
  dependencies["@/lib/server/auth"].requireAuth = async () => ({
    ok: true,
    auth: { sub: "user-1", role: "super_admin", locationIds: [locationId] },
    supabase: {
      rpc: async () => {
        rpcCalls += 1;
        return { data: null, error: null };
      },
    },
  });
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/route")>(
    "src/app/api/lanflow/income-expense/route.ts",
    dependencies,
  );
  const malformed = [
    validSyncPayload({ operation: "upsert" }),
    validSyncPayload({ expectedRevisionNo: -1 }),
    validSyncPayload({ operation: "create", expectedRevisionNo: 1 }),
    validSyncPayload({ operation: "update", expectedRevisionNo: 0 }),
    validSyncPayload({ clientTempId: " " }),
    validSyncPayload({ idempotencyKey: " " }),
    validSyncPayload({ locationId: "not-a-uuid" }),
    validSyncPayload({ recordStatus: "deleted" }),
    validSyncPayload({ billOption: "บิลขาย", type: "income", cost: 0, saleLines: {} }),
    validSyncPayload({
      billOption: "บิลขาย",
      type: "income",
      cost: 10,
      saleLines: [{
        incomeSaleItemId: "not-a-uuid",
        quantity: "1",
        unitPrice: 10,
        sequenceNo: 1,
      }],
    }),
    validSyncPayload({
      billOption: "บิลขาย",
      type: "income",
      cost: 10,
      saleLines: [{
        incomeSaleItemId: "71000000-0000-4000-8000-000000000024",
        quantity: 1,
        unitPrice: 10.001,
        sequenceNo: 1,
      }],
    }),
  ];

  for (const payload of malformed) {
    const response = await route.POST(new Request("http://local/api/lanflow/income-expense", {
      method: "POST",
      body: JSON.stringify(payload),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "failed",
      errorMessage: "ข้อมูลอ้างอิงการซิงก์รับ-จ่ายไม่ถูกต้อง",
    });
  }
  expect(rpcCalls).toBe(0);
});

test("income/expense sync accepts the canonical sale-line payload", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/route")>(
    "src/app/api/lanflow/income-expense/route.ts",
    routeDependencies({
      status: "synced",
      id: recordId,
      serverBillNo: "IE-SALE-1",
      revisionNo: 1,
      serverReceivedAt: "2026-10-07T01:00:00.000Z",
    }),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/income-expense", {
    method: "POST",
    body: JSON.stringify(validSyncPayload({
      billOption: "บิลขาย",
      type: "income",
      cost: 10,
      saleLines: [{
        incomeSaleItemId: "71000000-0000-4000-8000-000000000024",
        quantity: 1,
        unitPrice: 10,
        sequenceNo: 1,
      }],
    })),
  }));

  expect(response.status).toBe(200);
});

test("income/expense sync keeps the queue when a successful RPC receipt is malformed", async () => {
  const malformedReceipts = [
    { status: "synced" },
    { status: "synced", id: recordId, serverBillNo: " ", revisionNo: 1, serverReceivedAt: "2026-10-07T01:00:00.000Z" },
    { status: "synced", id: recordId, serverBillNo: "IE-1", revisionNo: 0, serverReceivedAt: "2026-10-07T01:00:00.000Z" },
    { status: "synced", id: recordId, serverBillNo: "IE-1", revisionNo: 1, serverReceivedAt: "0" },
    { status: "pending_approval", requestId: "not-a-uuid", matchedReasons: [] },
  ];

  for (const receipt of malformedReceipts) {
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/route")>(
      "src/app/api/lanflow/income-expense/route.ts",
      routeDependencies(receipt),
    );
    const response = await route.POST(new Request("http://local/api/lanflow/income-expense", {
      method: "POST",
      body: JSON.stringify(validSyncPayload()),
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "failed",
      errorMessage: "ระบบซิงก์รับ-จ่ายไม่ตอบกลับตามรูปแบบที่กำหนด",
    });
  }
});

test("income/expense sync does not expose database diagnostics", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/route")>(
    "src/app/api/lanflow/income-expense/route.ts",
    routeDependencies(null, { message: 'relation "private.income_expense_secret" does not exist' }),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/income-expense", {
    method: "POST",
    body: JSON.stringify(validSyncPayload()),
  }));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    status: "failed",
    errorMessage: "บันทึกรายการรับ-จ่ายไม่สำเร็จ",
  });

  const internalResultRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/route")>(
    "src/app/api/lanflow/income-expense/route.ts",
    routeDependencies({ status: "failed", errorMessage: "unexpected implementation detail" }),
  );
  const internalResultResponse = await internalResultRoute.POST(new Request("http://local/api/lanflow/income-expense", {
    method: "POST",
    body: JSON.stringify(validSyncPayload()),
  }));
  expect(internalResultResponse.status).toBe(400);
  expect(await internalResultResponse.json()).toEqual({
    status: "failed",
    errorMessage: "บันทึกรายการรับ-จ่ายไม่สำเร็จ",
  });
});

test("income/expense feed rejects malformed RPC pages instead of defaulting them", async () => {
  const validFeedRow = {
    id: recordId,
    clientTempId: "client-1",
    idempotencyKey: `server:${recordId}`,
    locationId,
    syncStatus: "synced",
    recordStatus: "active",
    type: "expense",
    number: "IE-1",
    localBillNo: "LOCAL-1",
    txDate: "2026-10-07",
    title: "ค่าทดสอบ",
    cost: 100,
    billOption: "ค่าใช้จ่าย",
    clientRecordedAt: "2026-10-07T01:00:00.000Z",
    clientCreatedAt: "2026-10-07T01:00:00.000Z",
    revisionNo: 1,
  };
  const malformedPages = [
    null,
    { rows: {}, nextCursor: null, hasMore: false, pendingApprovalCount: 0 },
    { rows: [], nextCursor: null, hasMore: true, pendingApprovalCount: 0 },
    { rows: [], nextCursor: null, hasMore: false, pendingApprovalCount: -1 },
    {
      rows: [{
        ...validFeedRow,
        locationId: "71000000-0000-4000-8000-000000000099",
        title: "ผิดสาขา",
      }],
      nextCursor: null,
      hasMore: false,
      pendingApprovalCount: 0,
    },
    {
      rows: [{ ...validFeedRow, billOption: "รายรับ" }],
      nextCursor: null,
      hasMore: false,
      pendingApprovalCount: 0,
    },
    {
      rows: [{ ...validFeedRow, clientRecordedAt: undefined }],
      nextCursor: null,
      hasMore: false,
      pendingApprovalCount: 0,
    },
    {
      rows: [{
        ...validFeedRow,
        relationSourceType: "money_transfer",
        relationSourceId: 42,
      }],
      nextCursor: null,
      hasMore: false,
      pendingApprovalCount: 0,
    },
    {
      rows: [{ ...validFeedRow, serverBillNo: {} }],
      nextCursor: null,
      hasMore: false,
      pendingApprovalCount: 0,
    },
    {
      rows: [{ ...validFeedRow, idempotencyKey: undefined }],
      nextCursor: null,
      hasMore: false,
      pendingApprovalCount: 0,
    },
    {
      rows: [{ ...validFeedRow, createdByName: {} }],
      nextCursor: null,
      hasMore: false,
      pendingApprovalCount: 0,
    },
    {
      rows: [validFeedRow],
      nextCursor: "not-a-feed-cursor",
      hasMore: true,
      pendingApprovalCount: 0,
    },
    {
      rows: [validFeedRow],
      nextCursor: Buffer.from(JSON.stringify({
        v: 1,
        locationId,
        mode: "latest",
        search: "different search",
        sort: "tx_date_desc",
        date: validFeedRow.txDate,
        key: `actual:${recordId}`,
      })).toString("hex"),
      hasMore: true,
      pendingApprovalCount: 0,
    },
    {
      rows: [validFeedRow],
      nextCursor: Buffer.from(JSON.stringify({
        v: 1,
        locationId,
        mode: "latest",
        search: "",
        sort: "tx_date_desc",
        date: validFeedRow.txDate,
        key: `actual:${requestId}`,
      })).toString("hex"),
      hasMore: true,
      pendingApprovalCount: 0,
    },
    {
      rows: [validFeedRow],
      nextCursor: Buffer.from(JSON.stringify({
        v: 1,
        locationId,
        mode: "latest",
        search: "",
        sort: "tx_date_desc",
        date: validFeedRow.txDate,
        key: `actual:${recordId}`,
      })).toString("hex").toUpperCase(),
      hasMore: true,
      pendingApprovalCount: 0,
    },
    {
      rows: [validFeedRow],
      nextCursor: Buffer.from(JSON.stringify({
        v: 1,
        locationId,
        mode: "latest",
        search: "",
        sort: "tx_date_desc",
        date: "2026-10-06",
        key: `actual:${recordId}`,
      })).toString("hex"),
      hasMore: true,
      pendingApprovalCount: 0,
    },
    {
      rows: [{ ...validFeedRow, saleLines: {} }],
      nextCursor: null,
      hasMore: false,
      pendingApprovalCount: 0,
    },
    {
      rows: [{ ...validFeedRow, syncStatus: "pending", revisionNo: 0 }],
      nextCursor: null,
      hasMore: false,
      pendingApprovalCount: 1,
    },
    {
      rows: [{
        ...validFeedRow,
        syncStatus: "pending",
        revisionNo: 0,
        approvalPending: true,
        approvalRequestId: requestId,
        approvalRequestType: "cash_transfer_delete",
        approvalOperation: "delete",
        approvalReasons: [],
      }],
      nextCursor: null,
      hasMore: false,
      pendingApprovalCount: 1,
    },
    {
      rows: Array.from({ length: 101 }, (_, index) => ({
        ...validFeedRow,
        id: `row-${index}`,
        clientTempId: `client-${index}`,
        idempotencyKey: `server:row-${index}`,
      })),
      nextCursor: null,
      hasMore: false,
      pendingApprovalCount: 0,
    },
    {
      rows: [{
        ...validFeedRow,
        txDate: "2026-10-06",
      }, {
        ...validFeedRow,
        id: requestId,
        clientTempId: "client-2",
        idempotencyKey: `server:${requestId}`,
        txDate: "2026-10-07",
      }],
      nextCursor: null,
      hasMore: false,
      pendingApprovalCount: 0,
    },
  ];

  for (const page of malformedPages) {
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
      "src/app/api/lanflow/income-expense/feed/route.ts",
      routeDependencies(page),
    );
    const response = await route.GET({
      nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}`),
    } as never);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "ระบบไม่ตอบกลับรายการรับ-จ่ายตามรูปแบบที่กำหนด",
    });
  }

  const validCursorSearch = "OLD ค่าทดสอบ วันนี้";
  const validCursorPage = {
    rows: [validFeedRow],
    nextCursor: Buffer.from(JSON.stringify({
      v: 1,
      locationId,
      mode: "latest",
      search: validCursorSearch.toLowerCase(),
      sort: "tx_date_desc",
      date: validFeedRow.txDate,
      key: `actual:${recordId}`,
    })).toString("hex"),
    hasMore: true,
    pendingApprovalCount: 0,
  };
  const validCursorRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies(validCursorPage),
  );
  const validCursorResponse = await validCursorRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?${new URLSearchParams({
      locationId,
      search: `  ${validCursorSearch.replace(" ", "   ")}  `,
    })}`),
  } as never);
  expect(validCursorResponse.status).toBe(200);

  const derivedCursorCases = [
    {
      row: {
        ...validFeedRow,
        id: `money-transfer-income:${recordId}`,
        relationSourceType: "money_transfer",
        relationSourceId: recordId,
      },
      key: `transfer-income:${recordId}`,
    },
    {
      row: {
        ...validFeedRow,
        id: `money-transfer-branch-expense:${recordId}`,
        relationSourceType: "money_transfer",
        relationSourceId: recordId,
      },
      key: `transfer-expense:${recordId}`,
    },
    {
      row: {
        ...validFeedRow,
        id: `money-transfer-branch-paid-expense:${recordId}`,
        relationSourceType: "money_transfer",
        relationSourceId: recordId,
      },
      key: `customer-transfer-expense:${recordId}`,
    },
    {
      row: {
        ...validFeedRow,
        id: `time-tracking-withdrawal:${recordId}`,
        relationSourceType: "time_tracking_withdrawal",
        relationSourceId: recordId,
      },
      key: `time-tracking-withdrawal:${recordId}`,
    },
    {
      row: {
        ...validFeedRow,
        id: `rubber-bill-daily-expense:${locationId}:2026-10-07`,
        relationSourceType: "rubber_bill_daily",
        relationSourceId: "2026-10-07",
      },
      key: "rubber:2026-10-07",
    },
  ];
  for (const { row, key } of derivedCursorCases) {
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
      "src/app/api/lanflow/income-expense/feed/route.ts",
      routeDependencies({
        rows: [row],
        nextCursor: Buffer.from(JSON.stringify({
          v: 1,
          locationId,
          mode: "latest",
          search: "",
          sort: "tx_date_desc",
          date: row.txDate,
          key,
        })).toString("hex"),
        hasMore: true,
        pendingApprovalCount: 0,
      }),
    );
    const response = await route.GET({
      nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}`),
    } as never);
    expect(response.status).toBe(200);
  }

  const pinnedCreateRow = {
    ...validFeedRow,
    id: `approval-income:${requestId}`,
    clientTempId: "pending-client",
    idempotencyKey: "create:pending-client:0",
    syncStatus: "pending",
    revisionNo: 0,
    approvalPending: true,
    approvalRequestId: requestId,
    approvalRequestType: "income_expense",
    approvalOperation: "create",
    approvalReasons: ["keyword"],
    serverReceivedAt: "2026-10-08T01:00:00.000Z",
  };
  const pageableRows = Array.from({ length: 100 }, (_, index) => ({
    ...validFeedRow,
    id: `row-${index}`,
    clientTempId: `client-${index}`,
    idempotencyKey: `server:row-${index}`,
  })).sort((left, right) => left.id < right.id ? 1 : left.id > right.id ? -1 : 0);
  const pinnedCreatePage = {
    rows: [pinnedCreateRow, ...pageableRows],
    nextCursor: Buffer.from(JSON.stringify({
      v: 1,
      locationId,
      mode: "latest",
      search: "",
      sort: "tx_date_desc",
      date: validFeedRow.txDate,
      key: `actual:${pageableRows.at(-1)!.id}`,
    })).toString("hex"),
    hasMore: true,
    pendingApprovalCount: 1,
  };
  const pinnedCreateRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies(pinnedCreatePage),
  );
  const pinnedCreateResponse = await pinnedCreateRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}`),
  } as never);
  expect(pinnedCreateResponse.status).toBe(200);

  const zeroCashTransferIncomePage = {
    rows: [{
      ...validFeedRow,
      id: `cash-transfer-income:${recordId}`,
      clientTempId: `cash-transfer-income:${recordId}`,
      idempotencyKey: `cash-transfer-income:${recordId}`,
      type: "income",
      billOption: "รายรับ",
      cost: 0,
      relationSourceType: "money_transfer",
      relationSourceId: `cash:${recordId}`,
      relationSourceLocationId: locationId,
      relationLabel: "รับเงินแล้ว · ผลต่าง -฿100",
    }],
    nextCursor: null,
    hasMore: false,
    pendingApprovalCount: 0,
  };
  const zeroCashTransferIncomeRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies(zeroCashTransferIncomePage),
  );
  const zeroCashTransferIncomeResponse = await zeroCashTransferIncomeRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}`),
  } as never);
  expect(zeroCashTransferIncomeResponse.status).toBe(200);

  const mismatchedZeroCashIdentityRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies({
      ...zeroCashTransferIncomePage,
      rows: [{
        ...zeroCashTransferIncomePage.rows[0],
        idempotencyKey: `cash-transfer-income:${requestId}`,
      }],
    }),
  );
  const mismatchedZeroCashIdentityResponse = await mismatchedZeroCashIdentityRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}`),
  } as never);
  expect(mismatchedZeroCashIdentityResponse.status).toBe(500);

  const zeroManualIncomeRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies({
      ...zeroCashTransferIncomePage,
      rows: [{
        ...validFeedRow,
        type: "income",
        billOption: "รายรับ",
        cost: 0,
      }],
    }),
  );
  const zeroManualIncomeResponse = await zeroManualIncomeRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}`),
  } as never);
  expect(zeroManualIncomeResponse.status).toBe(500);

  const malformedPendingPage = {
    rows: [{ ...validFeedRow, syncStatus: "pending", revisionNo: 0 }],
    nextCursor: null,
    hasMore: false,
    pendingApprovalCount: 1,
  };
  const malformedPendingRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies(malformedPendingPage),
  );
  const malformedPendingResponse = await malformedPendingRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}&mode=pending_approval`),
  } as never);
  expect(malformedPendingResponse.status).toBe(500);

  const pendingFallbackPage = {
    rows: [{
      ...validFeedRow,
      syncStatus: "pending",
      revisionNo: 0,
      clientRecordedAt: "2026-10-07 01:00:00+00",
      clientCreatedAt: "2026-10-07 01:00:00+00",
      serverReceivedAt: "2026-10-07 01:00:00+00",
      approvalPending: true,
      approvalRequestId: requestId,
      approvalRequestType: "income_expense",
      approvalOperation: "create",
      approvalReasons: ["keyword"],
    }],
    nextCursor: null,
    hasMore: false,
    pendingApprovalCount: 1,
  };
  const pendingFallbackRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies(pendingFallbackPage),
  );
  const pendingFallbackResponse = await pendingFallbackRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}&mode=pending_approval`),
  } as never);
  expect(pendingFallbackResponse.status).toBe(200);

  const pendingCursorPage = {
    ...pendingFallbackPage,
    nextCursor: Buffer.from(JSON.stringify({
      v: 1,
      locationId,
      mode: "pending_approval",
      search: "",
      sort: "requested_at_asc",
      at: "2026-10-07T01:00:00+00:00",
      key: `income:${requestId}`,
    })).toString("hex"),
    hasMore: true,
  };
  const pendingCursorRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies(pendingCursorPage),
  );
  const pendingCursorResponse = await pendingCursorRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}&mode=pending_approval`),
  } as never);
  expect(pendingCursorResponse.status).toBe(200);

  const mismatchedPendingCursorRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies({
      ...pendingCursorPage,
      nextCursor: Buffer.from(JSON.stringify({
        v: 1,
        locationId,
        mode: "pending_approval",
        search: "",
        sort: "requested_at_asc",
        at: "2026-10-07T01:00:00+00:00",
        key: `cash-delete:${requestId}`,
      })).toString("hex"),
    }),
  );
  const mismatchedPendingCursorResponse = await mismatchedPendingCursorRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}&mode=pending_approval`),
  } as never);
  expect(mismatchedPendingCursorResponse.status).toBe(500);

  const mismatchedPendingCursorTimeRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies({
      ...pendingCursorPage,
      nextCursor: Buffer.from(JSON.stringify({
        v: 1,
        locationId,
        mode: "pending_approval",
        search: "",
        sort: "requested_at_asc",
        at: "2026-10-07T02:00:00+00:00",
        key: `income:${requestId}`,
      })).toString("hex"),
    }),
  );
  const mismatchedPendingCursorTimeResponse = await mismatchedPendingCursorTimeRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}&mode=pending_approval`),
  } as never);
  expect(mismatchedPendingCursorTimeResponse.status).toBe(500);

  const mismatchedPendingCursorMicrosRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies({
      ...pendingCursorPage,
      rows: [{
        ...pendingCursorPage.rows[0],
        serverReceivedAt: "2026-10-07T01:00:00.000002+00:00",
      }],
      nextCursor: Buffer.from(JSON.stringify({
        v: 1,
        locationId,
        mode: "pending_approval",
        search: "",
        sort: "requested_at_asc",
        at: "2026-10-07T01:00:00.000001+00:00",
        key: `income:${requestId}`,
      })).toString("hex"),
    }),
  );
  const mismatchedPendingCursorMicrosResponse = await mismatchedPendingCursorMicrosRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}&mode=pending_approval`),
  } as never);
  expect(mismatchedPendingCursorMicrosResponse.status).toBe(500);

  const unsortedPendingRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies({
      ...pendingFallbackPage,
      rows: [{
        ...pendingFallbackPage.rows[0],
        serverReceivedAt: "2026-10-07T02:00:00+00:00",
      }, {
        ...pendingFallbackPage.rows[0],
        id: `approval-income:${recordId}`,
        clientTempId: "pending-client-2",
        idempotencyKey: "create:pending-client-2:0",
        approvalRequestId: recordId,
        serverReceivedAt: "2026-10-07T01:00:00+00:00",
      }],
      pendingApprovalCount: 2,
    }),
  );
  const unsortedPendingResponse = await unsortedPendingRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}&mode=pending_approval`),
  } as never);
  expect(unsortedPendingResponse.status).toBe(500);

  const contradictoryPendingCountRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies({ ...pendingFallbackPage, pendingApprovalCount: 0 }),
  );
  const contradictoryPendingCountResponse = await contradictoryPendingCountRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}&mode=pending_approval`),
  } as never);
  expect(contradictoryPendingCountResponse.status).toBe(500);

  const latestPendingCreateResponse = await pendingFallbackRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}&mode=latest`),
  } as never);
  expect(latestPendingCreateResponse.status).toBe(200);

  const pendingCashDeletePage = {
    ...pendingFallbackPage,
    rows: [{
      ...pendingFallbackPage.rows[0],
      approvalRequestType: "cash_transfer_delete",
      approvalOperation: "delete",
      approvalReasons: [],
    }],
  };
  const pendingCashDeleteRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies(pendingCashDeletePage),
  );
  const pendingCashDeleteResponse = await pendingCashDeleteRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}&mode=pending_approval`),
  } as never);
  expect(pendingCashDeleteResponse.status).toBe(200);

  const pendingCashDeleteCursorRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies({
      ...pendingCashDeletePage,
      nextCursor: Buffer.from(JSON.stringify({
        v: 1,
        locationId,
        mode: "pending_approval",
        search: "",
        sort: "requested_at_asc",
        at: "2026-10-07T01:00:00+00:00",
        key: `cash-delete:${requestId}`,
      })).toString("hex"),
      hasMore: true,
    }),
  );
  const pendingCashDeleteCursorResponse = await pendingCashDeleteCursorRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}&mode=pending_approval`),
  } as never);
  expect(pendingCashDeleteCursorResponse.status).toBe(200);

  const latestAdjustmentPage = {
    rows: [{
      ...validFeedRow,
      relationSourceType: "time_tracking_withdrawal_adjustment",
      relationSourceId: recordId,
      relationSourceLocationId: locationId,
      relationLabel: "ปรับยอดเบิกเงิน",
      relationLockReason: "ต้องตรวจสอบที่โมดูลลงเวลา",
    }],
    nextCursor: null,
    hasMore: false,
    pendingApprovalCount: 0,
  };
  const latestAdjustmentRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies(latestAdjustmentPage),
  );
  const latestAdjustmentResponse = await latestAdjustmentRoute.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}&mode=latest`),
  } as never);
  expect(latestAdjustmentResponse.status).toBe(200);
});

test("income/expense feed rejects duplicate server identities", async () => {
  const row = {
    id: recordId,
    clientTempId: "client-1",
    idempotencyKey: `server:${recordId}`,
    locationId,
    syncStatus: "synced",
    recordStatus: "active",
    type: "expense",
    number: "IE-1",
    localBillNo: "LOCAL-1",
    txDate: "2026-10-07",
    title: "ค่าทดสอบ",
    cost: 100,
    billOption: "ค่าใช้จ่าย",
    clientRecordedAt: "2026-10-07T01:00:00.000Z",
    clientCreatedAt: "2026-10-07T01:00:00.000Z",
    revisionNo: 1,
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    routeDependencies({
      rows: [row, {
        ...row,
        clientTempId: "client-2",
        idempotencyKey: `server:${requestId}`,
      }],
      nextCursor: null,
      hasMore: false,
      pendingApprovalCount: 0,
    }),
  );
  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${locationId}`),
  } as never);
  expect(response.status).toBe(500);
});

test("income/expense feed canonicalizes an uppercase location before authorization and RPC", async () => {
  const canonicalLocationId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
  const page = {
    rows: [{
      id: recordId,
      clientTempId: "client-1",
      idempotencyKey: `server:${recordId}`,
      locationId: canonicalLocationId,
      syncStatus: "synced",
      recordStatus: "active",
      type: "expense",
      number: "IE-1",
      localBillNo: "LOCAL-1",
      txDate: "2026-10-07",
      title: "ค่าทดสอบ",
      cost: 100,
      billOption: "ค่าใช้จ่าย",
      clientRecordedAt: "2026-10-07T01:00:00.000Z",
      clientCreatedAt: "2026-10-07T01:00:00.000Z",
      revisionNo: 1,
    }],
    nextCursor: null,
    hasMore: false,
    pendingApprovalCount: 0,
  };
  let rpcLocationId: string | undefined;
  const dependencies = routeDependencies(page);
  dependencies["@/lib/server/auth"].hasSystemManagerAccess = () => false;
  dependencies["@/lib/server/auth"].requireAuth = async () => ({
    ok: true,
    auth: { sub: "user-1", role: "user", locationIds: [canonicalLocationId] },
    supabase: {
      rpc: async (...args: unknown[]) => {
        rpcLocationId = (args[1] as { p_location_id?: string } | undefined)?.p_location_id;
        return { data: page, error: null };
      },
    },
  });
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/feed/route")>(
    "src/app/api/lanflow/income-expense/feed/route.ts",
    dependencies,
  );
  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/income-expense/feed?locationId=${canonicalLocationId.toUpperCase()}`),
  } as never);
  expect(response.status).toBe(200);
  expect(rpcLocationId).toBe(canonicalLocationId);
});

function saleDetailDependencies(options: {
  bill?: Record<string, unknown> | null;
  billError?: { message: string } | null;
  lines?: Array<Record<string, unknown>>;
  lineError?: { message: string } | null;
}) {
  const bill = options.bill ?? {
    id: recordId,
    location_id: locationId,
    bill_option: "บิลขาย",
    title: "บิลขายทดสอบ",
    cost: 100,
    server_bill_no: "IE-1",
    tx_date: "2026-10-07",
    created_by_name: "ผู้ทดสอบ",
    revision_no: 1,
    report_lock_no: null,
  };
  const lines = options.lines ?? [{
    id: "71000000-0000-4000-8000-000000000024",
    income_sale_item_id: "71000000-0000-4000-8000-000000000025",
    stock_product_id: "71000000-0000-4000-8000-000000000026",
    title: "สินค้า",
    quantity: 2,
    unit_price: 50,
    line_total: 100,
    sequence_no: 1,
  }];
  const supabase = {
    from(table: string) {
      const response = table === "income_expense"
        ? { data: bill, error: options.billError ?? null }
        : { data: lines, error: options.lineError ?? null };
      const query = {
        select: () => query,
        eq: () => query,
        order: async () => response,
        maybeSingle: async () => response,
      };
      return query;
    },
  };
  return {
    "@/lib/server/auth": {
      hasSystemManagerAccess: () => true,
      requireAuth: async () => ({
        ok: true,
        auth: { sub: "manager-1", role: "admin", locationIds: [], canAccessSystemManager: true },
        supabase,
      }),
    },
  };
}

test("sale detail matches manager authorization and rejects unsafe numeric rows", async () => {
  const managerRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/[id]/route")>(
    "src/app/api/lanflow/income-expense/[id]/route.ts",
    saleDetailDependencies({}),
  );
  const managerResponse = await managerRoute.GET(new Request("http://local/detail"), {
    params: Promise.resolve({ id: recordId }),
  });
  expect(managerResponse.status).toBe(200);

  const zeroPriceRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/[id]/route")>(
    "src/app/api/lanflow/income-expense/[id]/route.ts",
    saleDetailDependencies({
      bill: {
        id: recordId,
        location_id: locationId,
        bill_option: "บิลขาย",
        title: "บิลแจกฟรี",
        cost: 0,
        server_bill_no: "IE-0",
        tx_date: "2026-10-07",
        created_by_name: "ผู้ทดสอบ",
        revision_no: 1,
        report_lock_no: null,
      },
      lines: [{
        id: "71000000-0000-4000-8000-000000000024",
        income_sale_item_id: "71000000-0000-4000-8000-000000000025",
        stock_product_id: "71000000-0000-4000-8000-000000000026",
        title: "สินค้าแจกฟรี",
        quantity: 2,
        unit_price: 0,
        line_total: 0,
        sequence_no: 1,
      }],
    }),
  );
  const zeroPriceResponse = await zeroPriceRoute.GET(new Request("http://local/detail"), {
    params: Promise.resolve({ id: recordId }),
  });
  expect(zeroPriceResponse.status).toBe(200);
  expect(await zeroPriceResponse.json()).toEqual(expect.objectContaining({
    cost: 0,
    saleLines: [expect.objectContaining({ unitPrice: 0, lineTotal: 0 })],
  }));

  const emptySaleRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/[id]/route")>(
    "src/app/api/lanflow/income-expense/[id]/route.ts",
    saleDetailDependencies({
      bill: {
        id: recordId,
        location_id: locationId,
        bill_option: "บิลขาย",
        title: "บิลขายไม่มีรายการ",
        cost: 0,
        server_bill_no: "IE-EMPTY",
        tx_date: "2026-10-07",
        created_by_name: "ผู้ทดสอบ",
        revision_no: 1,
        report_lock_no: null,
      },
      lines: [],
    }),
  );
  const emptySaleResponse = await emptySaleRoute.GET(new Request("http://local/detail"), {
    params: Promise.resolve({ id: recordId }),
  });
  expect(emptySaleResponse.status).toBe(500);

  const invalidLineRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/[id]/route")>(
    "src/app/api/lanflow/income-expense/[id]/route.ts",
    saleDetailDependencies({ lines: [{
      id: "71000000-0000-4000-8000-000000000024",
      income_sale_item_id: "71000000-0000-4000-8000-000000000025",
      stock_product_id: "71000000-0000-4000-8000-000000000026",
      title: "สินค้า",
      quantity: "not-a-number",
      unit_price: 50,
      line_total: -1,
      sequence_no: 1,
    }] }),
  );
  const invalidLineResponse = await invalidLineRoute.GET(new Request("http://local/detail"), {
    params: Promise.resolve({ id: recordId }),
  });
  expect(invalidLineResponse.status).toBe(500);
  expect(await invalidLineResponse.json()).toEqual({ error: "ระบบไม่ตอบกลับรายละเอียดบิลขายตามรูปแบบที่กำหนด" });

  const invalidSequenceRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/[id]/route")>(
    "src/app/api/lanflow/income-expense/[id]/route.ts",
    saleDetailDependencies({ lines: [{
      id: "71000000-0000-4000-8000-000000000024",
      income_sale_item_id: "71000000-0000-4000-8000-000000000025",
      stock_product_id: "71000000-0000-4000-8000-000000000026",
      title: "สินค้า",
      quantity: 2,
      unit_price: 50,
      line_total: 100,
      sequence_no: 2,
    }] }),
  );
  const invalidSequenceResponse = await invalidSequenceRoute.GET(new Request("http://local/detail"), {
    params: Promise.resolve({ id: recordId }),
  });
  expect(invalidSequenceResponse.status).toBe(500);

  const databaseErrorRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/[id]/route")>(
    "src/app/api/lanflow/income-expense/[id]/route.ts",
    saleDetailDependencies({ billError: { message: 'relation "private.sale_secret" does not exist' } }),
  );
  const databaseErrorResponse = await databaseErrorRoute.GET(new Request("http://local/detail"), {
    params: Promise.resolve({ id: recordId }),
  });
  expect(databaseErrorResponse.status).toBe(500);
  expect(await databaseErrorResponse.json()).toEqual({ error: "โหลดรายละเอียดบิลขายไม่สำเร็จ" });
});

test("approval routes validate request and result identity and hide database diagnostics", async () => {
  const pendingRequestRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/approval-requests/route")>(
    "src/app/api/lanflow/income-expense/approval-requests/route.ts",
    routeDependencies({ status: "pending", requestId, matchedReasons: ["keyword"] }),
  );
  const pendingRequest = await pendingRequestRoute.POST(new Request("http://local/approval", {
    method: "POST",
    body: JSON.stringify(validSyncPayload()),
  }) as never);
  expect(pendingRequest.status).toBe(200);
  expect(await pendingRequest.json()).toEqual({ status: "pending", requestId, matchedReasons: ["keyword"] });

  const createRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/approval-requests/route")>(
    "src/app/api/lanflow/income-expense/approval-requests/route.ts",
    routeDependencies({ status: "pending", requestId: "not-a-uuid", requestStatus: "pending", matchedReasons: [] }),
  );
  const malformedRequest = await createRoute.POST(new Request("http://local/approval", {
    method: "POST",
    body: JSON.stringify(validSyncPayload({ clientTempId: " " })),
  }) as never);
  expect(malformedRequest.status).toBe(400);

  const malformedResult = await createRoute.POST(new Request("http://local/approval", {
    method: "POST",
    body: JSON.stringify(validSyncPayload()),
  }) as never);
  expect(malformedResult.status).toBe(500);
  expect(await malformedResult.json()).toEqual({
    status: "failed",
    errorMessage: "ระบบไม่ตอบกลับผลคำขออนุมัติตามรูปแบบที่กำหนด",
  });

  const decideRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/approval-requests/[id]/decide/route")>(
    "src/app/api/lanflow/income-expense/approval-requests/[id]/decide/route.ts",
    routeDependencies({ status: "approved", requestId: "71000000-0000-4000-8000-000000000099", incomeExpenseId: recordId }),
  );
  const invalidComment = await decideRoute.POST(new Request("http://local/decide", {
    method: "POST",
    body: JSON.stringify({ decision: "approved", comment: `bad\u0000comment${"x".repeat(1001)}` }),
  }) as never, { params: Promise.resolve({ id: requestId }) });
  expect(invalidComment.status).toBe(400);

  const mismatchedResult = await decideRoute.POST(new Request("http://local/decide", {
    method: "POST",
    body: JSON.stringify({ decision: "approved", comment: "ตรวจแล้ว" }),
  }) as never, { params: Promise.resolve({ id: requestId }) });
  expect(mismatchedResult.status).toBe(500);
  expect(await mismatchedResult.json()).toEqual({
    status: "failed",
    errorMessage: "ระบบไม่ตอบกลับผลการอนุมัติตามรูปแบบที่กำหนด",
  });

  const mismatchedConflictRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/approval-requests/[id]/decide/route")>(
    "src/app/api/lanflow/income-expense/approval-requests/[id]/decide/route.ts",
    routeDependencies({
      status: "conflict",
      requestId: "71000000-0000-4000-8000-000000000099",
      errorMessage: "Revision conflict",
    }),
  );
  const mismatchedConflict = await mismatchedConflictRoute.POST(new Request("http://local/decide", {
    method: "POST",
    body: JSON.stringify({ decision: "approved" }),
  }) as never, { params: Promise.resolve({ id: requestId }) });
  expect(mismatchedConflict.status).toBe(500);
  expect(await mismatchedConflict.json()).toEqual({
    status: "failed",
    errorMessage: "ระบบไม่ตอบกลับผลการอนุมัติตามรูปแบบที่กำหนด",
  });

  const errorRoute = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/approval-requests/[id]/decide/route")>(
    "src/app/api/lanflow/income-expense/approval-requests/[id]/decide/route.ts",
    routeDependencies(null, { message: "duplicate key value violates private_income_expense_key" }),
  );
  const errorResponse = await errorRoute.POST(new Request("http://local/decide", {
    method: "POST",
    body: JSON.stringify({ decision: "approved" }),
  }) as never, { params: Promise.resolve({ id: requestId }) });
  expect(errorResponse.status).toBe(503);
  expect(await errorResponse.json()).toEqual({ status: "failed", errorMessage: "ดำเนินการคำขอไม่สำเร็จ" });
});

test("income/expense queue protects an uncertain server commit and online state is reactive", () => {
  const syncSource = readFileSync(resolve("src/hooks/useIncomeExpense.ts"), "utf8");
  const retrySource = readFileSync(resolve("src/hooks/usePerRecordSyncRetry.ts"), "utf8");
  const listSource = readFileSync(resolve("src/hooks/useIncomeExpenseOperationalList.ts"), "utf8");
  const moduleSource = readFileSync(resolve("src/components/income-expense/IncomeExpenseModule.tsx"), "utf8");
  const locksSource = readFileSync(resolve("src/lib/record-action-locks.ts"), "utf8");

  expect(syncSource).toContain("event.serverSubmissionAttempted = true");
  expect(syncSource).toContain("event.serverSubmissionAttempted = false");
  expect(syncSource.match(/serverSubmissionAttempted === true/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  expect(retrySource).toContain('entity === "income_expense"');
  expect(retrySource).toContain("event.serverSubmissionAttempted = true");
  expect(retrySource).toMatch(/candidate\.status === "failed"\s*\|\|\s*candidate\.status === "conflict"/);
  expect(listSource).toContain('import { useOnlineStatus } from "@/hooks/useOnlineStatus"');
  expect(listSource).toContain("const online = useOnlineStatus();");
  expect(listSource).not.toContain("isDeviceOnline");
  expect(listSource).toContain("const canonicalLocationId = locationId.toLowerCase();");
  expect(listSource).toContain("queuePartition(ownerUserId, canonicalLocationId)");
  expect(listSource).toContain("locationId: canonicalLocationId");
  expect(listSource).toContain(
    "isIncomeExpenseFeedPayload(data, canonicalLocationId, serverMode, normalizedSearch)",
  );
  expect(moduleSource).toContain("getPendingServerActionBlockReason(transaction)");
  expect(moduleSource).toContain("&& !transaction.serverSubmissionAttempted");
  expect(locksSource).toContain("record.serverSubmissionAttempted === true");
});
