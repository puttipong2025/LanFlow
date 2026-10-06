import { expect, test } from "@playwright/test";

import { isRetryableSyncResponse } from "@/lib/sync-response";
import { loadSourceModule } from "./helpers/load-source-module";

test("classifies transient sync responses without treating business failures as retryable", () => {
  expect([401, 408, 425, 429, 500, 503].map(isRetryableSyncResponse)).toEqual([
    true,
    true,
    true,
    true,
    true,
    true,
  ]);
  expect([400, 403, 409, 422].map(isRetryableSyncResponse)).toEqual([
    false,
    false,
    false,
    false,
  ]);
});

function rubberRouteDependencies(data: unknown) {
  const supabase = { rpc: async () => ({ data, error: null }) };
  return {
    "@/lib/server/auth": {
      requireAuth: async () => ({ ok: true, supabase }),
      requireRole: async () => ({ ok: true, auth: { role: "super_admin" }, supabase }),
    },
  };
}

function validRubberSubmission(overrides: Record<string, unknown> = {}) {
  return {
    operation: "create",
    expectedRevisionNo: 0,
    clientTempId: "submitted-bill",
    idempotencyKey: "create:submitted-bill:0",
    locationId: "71000000-0000-4000-8000-000000000021",
    ...overrides,
  };
}

test("rubber bill sync route rejects malformed mutation identity before the RPC can commit", async () => {
  let rpcCalls = 0;
  const supabase = {
    rpc: async () => {
      rpcCalls += 1;
      return { data: { status: "failed", errorMessage: "RPC should not run" }, error: null };
    },
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    {
      "@/lib/server/auth": {
        requireAuth: async () => ({ ok: true, supabase }),
      },
    },
  );
  const invalidSubmissions = [
    validRubberSubmission({ operation: "update", expectedRevisionNo: "1" }),
    validRubberSubmission({ clientTempId: " " }),
    validRubberSubmission({ idempotencyKey: " " }),
    validRubberSubmission({ expectedRevisionNo: 1 }),
    validRubberSubmission({ operation: "delete", expectedRevisionNo: 0 }),
    validRubberSubmission({ locationId: "not-a-uuid" }),
  ];
  for (const submission of invalidSubmissions) {
    const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
      method: "POST",
      body: JSON.stringify(submission),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "failed",
      errorMessage: "ข้อมูลอ้างอิงการซิงก์บิลยางไม่ถูกต้อง",
    });
  }
  expect(rpcCalls).toBe(0);
});

test("rubber bill sync route fails closed for an unknown RPC status", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies({ status: "unexpected" }),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission()),
  }));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    status: "failed",
    errorMessage: "ระบบซิงก์บิลยางไม่ตอบกลับตามรูปแบบที่กำหนด",
  });
});

test("rubber bill sync route does not expose database error details from a failed result", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies({
      status: "failed",
      errorMessage: 'relation "private.rubber_bill_secret" does not exist',
    }),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission()),
  }));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    status: "failed",
    errorMessage: "บันทึกบิลยางไม่สำเร็จ",
  });
});

test("rubber bill sync route does not expose database error details from a conflict result", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies({
      status: "conflict",
      errorMessage: 'duplicate key value violates unique constraint "rubber_bills_pkey"',
    }),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission()),
  }));

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    status: "conflict",
    errorMessage: "บันทึกบิลยางไม่สำเร็จ",
  });
});

test("rubber bill sync route replaces a blank RPC failure message", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies({ status: "failed", errorMessage: "   " }),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission()),
  }));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    status: "failed",
    errorMessage: "บันทึกบิลยางไม่สำเร็จ",
  });
});

test("rubber bill sync route preserves an actionable business failure", async () => {
  const failed = {
    status: "failed",
    errorMessage: "บิลอยู่ในรายงาน RPT-001 แล้ว จึงสร้างคำขอไม่ได้",
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies(failed),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission()),
  }));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual(failed);
});

test("rubber bill sync route rejects an incomplete synced response before the queue can be cleared", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies({ status: "synced" }),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission()),
  }));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    status: "failed",
    errorMessage: "ระบบซิงก์บิลยางไม่ตอบกลับตามรูปแบบที่กำหนด",
  });
});

test("rubber bill sync route accepts an approved create replay after the bill was revised", async () => {
  const replayedBill = {
    status: "synced",
    id: "71000000-0000-4000-8000-000000000021",
    serverBillNo: "RB-0001",
    revisionNo: 2,
    serverReceivedAt: "2026-10-05T00:00:00.000Z",
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies(replayedBill),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission()),
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(replayedBill);
});

test("rubber bill sync route rejects an invalid server timestamp", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies({
      status: "synced",
      id: "71000000-0000-4000-8000-000000000021",
      serverBillNo: "RB-0001",
      revisionNo: 1,
      serverReceivedAt: "not-a-date",
    }),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission()),
  }));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    status: "failed",
    errorMessage: "ระบบซิงก์บิลยางไม่ตอบกลับตามรูปแบบที่กำหนด",
  });
});

test("rubber bill sync route rejects a non-ISO server timestamp accepted by Date.parse", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies({
      status: "synced",
      id: "71000000-0000-4000-8000-000000000021",
      serverBillNo: "RB-0001",
      revisionNo: 1,
      serverReceivedAt: "0",
    }),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission()),
  }));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    status: "failed",
    errorMessage: "ระบบซิงก์บิลยางไม่ตอบกลับตามรูปแบบที่กำหนด",
  });
});

test("rubber bill sync route rejects a whitespace-only server bill number", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies({
      status: "synced",
      id: "71000000-0000-4000-8000-000000000021",
      serverBillNo: " ",
      revisionNo: 1,
      serverReceivedAt: "2026-10-05T00:00:00.000Z",
    }),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission()),
  }));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    status: "failed",
    errorMessage: "ระบบซิงก์บิลยางไม่ตอบกลับตามรูปแบบที่กำหนด",
  });
});

test("rubber bill sync route rejects a non-positive synced revision", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies({
      status: "synced",
      id: "71000000-0000-4000-8000-000000000021",
      serverBillNo: "RB-0001",
      revisionNo: 0,
      serverReceivedAt: "2026-10-05T00:00:00.000Z",
    }),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission()),
  }));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    status: "failed",
    errorMessage: "ระบบซิงก์บิลยางไม่ตอบกลับตามรูปแบบที่กำหนด",
  });
});

test("rubber bill sync route preserves a synced revision for the submitted operation", async () => {
  const synced = {
    status: "synced",
    id: "71000000-0000-4000-8000-000000000021",
    serverBillNo: "RB-0001",
    revisionNo: 1,
    serverReceivedAt: "2026-10-05T00:00:00.000Z",
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies(synced),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission()),
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(synced);
});

test("rubber bill sync route rejects a pending approval for another submission", async () => {
  const mismatchedResults = [
    {
      status: "pending_approval",
      requestId: "71000000-0000-4000-8000-000000000021",
      operation: "update",
      clientTempId: "submitted-bill",
    },
    {
      status: "pending_approval",
      requestId: "71000000-0000-4000-8000-000000000021",
      operation: "create",
      clientTempId: "another-bill",
    },
  ];

  for (const result of mismatchedResults) {
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
      "src/app/api/lanflow/rubber-bills/route.ts",
      rubberRouteDependencies(result),
    );
    const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
      method: "POST",
      body: JSON.stringify(validRubberSubmission()),
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "failed",
      errorMessage: "ระบบซิงก์บิลยางไม่ตอบกลับตามรูปแบบที่กำหนด",
    });
  }
});

test("rubber bill sync route preserves a pending approval for the submitted bill", async () => {
  const pendingApproval = {
    status: "pending_approval",
    requestId: "71000000-0000-4000-8000-000000000021",
    operation: "create",
    clientTempId: "submitted-bill",
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies(pendingApproval),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission()),
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(pendingApproval);
});

test("rubber maximum route rejects an unknown RPC status", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/max-price-allowance/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/max-price-allowance/route.ts",
    rubberRouteDependencies({ status: "unexpected" }),
  );
  const response = await route.PUT(new Request("http://local/api/lanflow/rubber-bills/approval-settings/max-price-allowance", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxPriceAllowance: 10, expectedMaxPriceAllowance: 9 }),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการบันทึก" });
});

test("rubber maximum route rejects malformed conflict details before the UI reads them", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/max-price-allowance/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/max-price-allowance/route.ts",
    rubberRouteDependencies({
      status: "conflict",
      code: "RUBBER_ALLOWANCE_LIMIT_TOO_LOW",
      errorMessage: "conflict",
      conflicts: [{ scope: "group", locationIds: [], allowance: "invalid" }],
    }),
  );
  const response = await route.PUT(new Request("http://local/api/lanflow/rubber-bills/approval-settings/max-price-allowance", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxPriceAllowance: 10, expectedMaxPriceAllowance: 9 }),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการบันทึก" });
});
