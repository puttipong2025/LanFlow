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

function rubberRouteDependencies(
  data: unknown,
  existingServerId = "71000000-0000-4000-8000-000000000021",
) {
  const selection = {
    eq: () => selection,
    maybeSingle: async () => ({ data: { id: existingServerId }, error: null }),
  };
  const supabase = { rpc: async () => ({ data, error: null }) };
  Object.assign(supabase, { from: () => ({ select: () => selection }) });
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
    validRubberSubmission({ operation: "update", expectedRevisionNo: 1, expectedServerId: "not-a-uuid" }),
    validRubberSubmission({ expectedServerId: "71000000-0000-4000-8000-000000000021" }),
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

test("rubber bill sync route rejects an invalid price-adjustment target before the RPC", async () => {
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

  for (const priceAdjustmentTarget of [
    -1,
    1.001,
    0.1 + 0.2,
    1_000_000_000_000,
    "1000",
  ]) {
    const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
      method: "POST",
      body: JSON.stringify(validRubberSubmission({ priceAdjustmentTarget })),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "failed",
      errorMessage: "ยอดปรับราคาบิลยางไม่ถูกต้อง",
    });
  }
  expect(rpcCalls).toBe(0);
});

test("rubber bill sync route rejects a declared oversized request before the RPC", async () => {
  let rpcCalls = 0;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    {
      "@/lib/server/auth": {
        requireAuth: async () => ({
          ok: true,
          supabase: {
            rpc: async () => {
              rpcCalls += 1;
              return { data: null, error: null };
            },
          },
        }),
      },
    },
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    headers: { "Content-Length": String((1024 * 1024) + 1) },
    body: JSON.stringify(validRubberSubmission()),
  }));

  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({
    status: "failed",
    errorMessage: "ข้อมูลบิลยางมีขนาดใหญ่เกินกำหนด",
  });
  expect(rpcCalls).toBe(0);
});

test("rubber bill sync route rejects an actual oversized request before the RPC", async () => {
  let rpcCalls = 0;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    {
      "@/lib/server/auth": {
        requireAuth: async () => ({
          ok: true,
          supabase: {
            rpc: async () => {
              rpcCalls += 1;
              return { data: null, error: null };
            },
          },
        }),
      },
    },
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission({ filler: "x".repeat(1024 * 1024) })),
  }));

  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({
    status: "failed",
    errorMessage: "ข้อมูลบิลยางมีขนาดใหญ่เกินกำหนด",
  });
  expect(rpcCalls).toBe(0);
});

test("rubber bill sync route keeps an oversized response stable when stream cancellation fails", async () => {
  let cancelCalls = 0;
  let rpcCalls = 0;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    {
      "@/lib/server/auth": {
        requireAuth: async () => ({
          ok: true,
          supabase: {
            rpc: async () => {
              rpcCalls += 1;
              return { data: null, error: null };
            },
          },
        }),
      },
    },
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array((1024 * 1024) + 1));
    },
    cancel() {
      cancelCalls += 1;
      throw new Error("synthetic cancel failure");
    },
  });
  const requestInit: RequestInit & { duplex: "half" } = {
    method: "POST",
    body,
    duplex: "half",
  };
  const response = await route.POST(new Request(
    "http://local/api/lanflow/rubber-bills",
    requestInit,
  ));

  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({
    status: "failed",
    errorMessage: "ข้อมูลบิลยางมีขนาดใหญ่เกินกำหนด",
  });
  expect(cancelCalls).toBe(1);
  expect(rpcCalls).toBe(0);
});

test("rubber bill sync route preserves Request.text UTF-8 BOM handling", async () => {
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
  const body = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(JSON.stringify(validRubberSubmission())),
  ]);
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body,
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(pendingApproval);
});

test("rubber bill sync route accepts a discarded replay for the submitted identity", async () => {
  const discarded = {
    status: "discarded",
    operation: "create",
    clientTempId: "submitted-bill",
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies(discarded),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission({ submissionMode: "replay" })),
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(discarded);
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

test("rubber bill sync route keeps a database-shaped failed result retryable without exposing details", async () => {
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

  expect(response.status).toBe(503);
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

test("rubber bill sync route treats a blank RPC failure message as a retryable malformed result", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies({ status: "failed", errorMessage: "   " }),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission()),
  }));

  expect(response.status).toBe(503);
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

test("rubber bill sync route rejects a synced response for another submitted bill", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies({
      status: "synced",
      id: "71000000-0000-4000-8000-000000000099",
      serverBillNo: "RB-OTHER",
      revisionNo: 2,
      serverReceivedAt: "2026-10-07T00:00:00.000Z",
    }),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission({
      operation: "delete",
      expectedRevisionNo: 1,
      expectedServerId: "71000000-0000-4000-8000-000000000021",
    })),
  }));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    status: "failed",
    errorMessage: "ระบบซิงก์บิลยางไม่ตอบกลับตามรูปแบบที่กำหนด",
  });
});

test("rubber bill sync route rejects a create result for another persisted bill", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies({
      status: "synced",
      id: "71000000-0000-4000-8000-000000000099",
      serverBillNo: "RB-OTHER",
      revisionNo: 1,
      serverReceivedAt: "2026-10-07T00:00:00.000Z",
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

test("rubber bill sync route rejects a mismatched expected Server identity before the RPC", async () => {
  let rpcCalls = 0;
  const selection = {
    eq: () => selection,
    maybeSingle: async () => ({
      data: { id: "71000000-0000-4000-8000-000000000021" },
      error: null,
    }),
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    {
      "@/lib/server/auth": {
        requireAuth: async () => ({
          ok: true,
          supabase: {
            from: () => ({ select: () => selection }),
            rpc: async () => {
              rpcCalls += 1;
              return { data: null, error: null };
            },
          },
        }),
      },
    },
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission({
      operation: "delete",
      expectedRevisionNo: 1,
      expectedServerId: "71000000-0000-4000-8000-000000000099",
    })),
  }));

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    status: "conflict",
    errorMessage: "ข้อมูลอ้างอิงบิลยางไม่ตรงกับ Server",
  });
  expect(rpcCalls).toBe(0);
});

test("rubber bill sync route fails closed when its Server identity lookup fails", async () => {
  let rpcCalls = 0;
  const selection = {
    eq: () => selection,
    maybeSingle: async () => ({
      data: null,
      error: { code: "42P01", message: 'relation "public.rubber_bills" does not exist' },
    }),
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    {
      "@/lib/server/auth": {
        requireAuth: async () => ({
          ok: true,
          supabase: {
            from: () => ({ select: () => selection }),
            rpc: async () => {
              rpcCalls += 1;
              return { data: null, error: null };
            },
          },
        }),
      },
    },
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission({
      operation: "delete",
      expectedRevisionNo: 1,
      expectedServerId: "71000000-0000-4000-8000-000000000021",
    })),
  }));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    status: "failed",
    errorMessage: "ตรวจสอบข้อมูลอ้างอิงบิลยางไม่สำเร็จ",
  });
  expect(rpcCalls).toBe(0);
});

test("rubber bill sync route accepts a synced response for the submitted server bill", async () => {
  const synced = {
    status: "synced",
    id: "71000000-0000-4000-8000-000000000021",
    serverBillNo: "RB-EXPECTED",
    revisionNo: 2,
    serverReceivedAt: "2026-10-07T00:00:00.000Z",
  };
  let rpcPayload: Record<string, unknown> | undefined;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    {
      "@/lib/server/auth": {
        requireAuth: async () => ({
          ok: true,
          supabase: {
            from: () => ({ select: () => ({
              eq() { return this; },
              maybeSingle: async () => ({ data: { id: synced.id }, error: null }),
            }) }),
            rpc: async (_name: string, args: { payload: Record<string, unknown> }) => {
              rpcPayload = args.payload;
              return { data: synced, error: null };
            },
          },
        }),
      },
    },
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission({
      operation: "delete",
      expectedRevisionNo: 1,
      expectedServerId: synced.id,
    })),
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(synced);
  expect(rpcPayload).not.toHaveProperty("expectedServerId");
});

test("rubber bill sync route treats uppercase and lowercase Server UUIDs as the same identity", async () => {
  const synced = {
    status: "synced",
    id: "71000000-0000-4000-8000-0000000000ab",
    serverBillNo: "RB-UUID-CASE",
    revisionNo: 2,
    serverReceivedAt: "2026-10-07T00:00:00.000Z",
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies(synced, synced.id),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission({
      operation: "delete",
      expectedRevisionNo: 1,
      expectedServerId: synced.id.toUpperCase(),
    })),
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(synced);
});

test("rubber bill sync route keeps legacy delete submissions without a server identity compatible", async () => {
  const synced = {
    status: "synced",
    id: "71000000-0000-4000-8000-000000000021",
    serverBillNo: "RB-LEGACY",
    revisionNo: 2,
    serverReceivedAt: "2026-10-07T00:00:00.000Z",
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>(
    "src/app/api/lanflow/rubber-bills/route.ts",
    rubberRouteDependencies(synced),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", {
    method: "POST",
    body: JSON.stringify(validRubberSubmission({ operation: "delete", expectedRevisionNo: 1 })),
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(synced);
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
