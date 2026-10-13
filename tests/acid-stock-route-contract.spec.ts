import { expect, test } from "@playwright/test";

import { loadSourceModule } from "./helpers/load-source-module";

const locationId = "91000000-0000-4000-8000-000000000001";
const targetLocationId = "91000000-0000-4000-8000-000000000002";
const productId = "92000000-0000-4000-8000-000000000001";
const entryId = "93000000-0000-4000-8000-000000000001";
const outId = "93000000-0000-4000-8000-000000000002";
const inId = "93000000-0000-4000-8000-000000000003";

function validMovementPage(overrides: Record<string, unknown> = {}) {
  return {
    rows: [{
      movement_id: `stock-entry:${entryId}`,
      source_type: "stock_entry",
      source_id: entryId,
      source_line_id: null,
      tx_date: "2026-10-13",
      location_id: locationId,
      product_id: productId,
      product_name: "กรด",
      quantity_delta: 1,
      amount: 0,
      display_bill_no: "AS-261013-0001",
      tx_type: "receive",
      created_by_user_id: null,
      created_by_name: null,
      created_by_phone: null,
      created_at: "2026-10-13T01:02:03.000Z",
      relation_lock_reason: null,
      report_lock_no: null,
    }],
    hasMore: true,
    nextTxDate: "2026-10-13",
    nextCreatedAt: "2026-10-13T01:02:03.000Z",
    nextMovementId: `stock-entry:${entryId}`,
    ...overrides,
  };
}

function loadRoute(rpc: (name: string, args: unknown) => Promise<unknown>) {
  return loadSourceModule<typeof import("../src/app/api/lanflow/acid-stock/route")>(
    "src/app/api/lanflow/acid-stock/route.ts",
    {
      "@/lib/server/auth": {
        requireAuth: async () => ({
          ok: true,
          auth: {
            sub: "94000000-0000-4000-8000-000000000001",
            canAccessSystemManager: false,
            locationIds: [locationId],
          },
          supabase: { rpc },
        }),
      },
    },
  );
}

function post(route: ReturnType<typeof loadRoute>, payload: unknown) {
  return route.POST(new Request("http://local/api/lanflow/acid-stock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

test("rejects unknown stock actions before calling an RPC", async () => {
  let calls = 0;
  const route = loadRoute(async () => {
    calls += 1;
    return { data: { status: "synced" }, error: null };
  });

  const response = await post(route, {
    action: "wrong",
    locationId,
    productId,
    txDate: "2026-10-13",
    quantity: 1,
    amount: 0,
  });

  expect(response.status).toBe(400);
  expect(calls).toBe(0);
});

test("validates receive identity and numeric payload before calling an RPC", async () => {
  let calls = 0;
  const route = loadRoute(async () => {
    calls += 1;
    return { data: { status: "synced" }, error: null };
  });

  for (const payload of [
    { action: "receive", entryId: "bad", locationId, productId, txDate: "2026-10-13", quantity: 1, amount: 0 },
    { action: "receive", entryId, locationId, productId, txDate: "2026-10-32", quantity: 1, amount: 0 },
    { action: "receive", entryId, locationId, productId, txDate: "2026-10-13", quantity: 0, amount: 0 },
    { action: "receive", entryId, locationId, productId, txDate: "2026-10-13", quantity: 1.001, amount: 0 },
    { action: "receive", entryId, locationId, productId, txDate: "2026-10-13", quantity: 1, amount: -1 },
    { action: "receive", entryId, locationId, productId, txDate: "2026-10-13", quantity: 1, amount: "0" },
  ]) {
    expect((await post(route, payload)).status).toBe(400);
  }

  expect(calls).toBe(0);
});

test("rejects a receive command outside the authenticated location scope", async () => {
  let calls = 0;
  const route = loadRoute(async () => {
    calls += 1;
    return { data: { status: "synced" }, error: null };
  });

  const response = await post(route, {
    action: "receive",
    entryId,
    locationId: targetLocationId,
    productId,
    txDate: "2026-10-13",
    quantity: 1,
    amount: 0,
  });

  expect(response.status).toBe(403);
  expect(calls).toBe(0);
});

test("validates transfer identities and forwards a canonical valid payload", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const route = loadRoute(async (name, args) => {
    calls.push({ name, args });
    return {
      data: {
        status: "synced",
        outId,
        inId,
        transferBillNo: "AT-261013-0001",
        serverReceivedAt: "2026-10-13T01:02:03.000Z",
        diagnostic: "must-not-cross-route-boundary",
      },
      error: null,
    };
  });

  expect((await post(route, {
    action: "transfer",
    outId,
    inId: outId,
    fromLocationId: locationId,
    toLocationId: targetLocationId,
    productId,
    txDate: "2026-10-13",
    quantity: 1,
  })).status).toBe(400);

  const payload = {
    action: "transfer",
    outId,
    inId,
    fromLocationId: locationId,
    toLocationId: targetLocationId,
    productId,
    txDate: "2026-10-13",
    quantity: 1,
    internalSecret: "must-not-reach-the-rpc",
  };
  const response = await post(route, payload);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: "synced",
    outId,
    inId,
    transferBillNo: "AT-261013-0001",
    serverReceivedAt: "2026-10-13T01:02:03.000Z",
  });
  expect(calls).toEqual([{
    name: "transfer_stock",
    args: {
      payload: {
        action: "transfer",
        outId,
        inId,
        fromLocationId: locationId,
        toLocationId: targetLocationId,
        productId,
        txDate: "2026-10-13",
        quantity: 1,
      },
    },
  }]);
});

test("maps a stock identity conflict to HTTP 409", async () => {
  const route = loadRoute(async () => ({
    data: { status: "conflict", errorMessage: "Stock command identity conflict" },
    error: null,
  }));

  const response = await post(route, {
    action: "receive",
    entryId,
    locationId,
    productId,
    txDate: "2026-10-13",
    quantity: 1,
    amount: 0,
  });

  expect(response.status).toBe(409);
});

test("forwards identical concurrent commands without changing their identity", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const seenPayloads: unknown[] = [];
  const route = loadRoute(async (_name, args) => {
    calls += 1;
    seenPayloads.push(args);
    await gate;
    return {
      data: {
        status: "synced",
        id: entryId,
        serverBillNo: "AS-261013-0001",
        serverReceivedAt: "2026-10-13T01:02:03.000Z",
      },
      error: null,
    };
  });
  const payload = {
    action: "receive",
    entryId,
    locationId,
    productId,
    txDate: "2026-10-13",
    quantity: 1,
    amount: 0,
  };

  const first = post(route, payload);
  const second = post(route, payload);
  await expect.poll(() => calls).toBe(2);
  release();

  const responses = await Promise.all([first, second]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  expect(seenPayloads).toEqual([{ payload }, { payload }]);
});

test("does not expose an unexpected stock RPC exception", async () => {
  const diagnostic = "postgres://internal-secret@db.example/private";
  const route = loadRoute(async () => {
    throw new Error(diagnostic);
  });

  const response = await post(route, {
    action: "receive",
    entryId,
    locationId,
    productId,
    txDate: "2026-10-13",
    quantity: 1,
    amount: 0,
  });

  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain(diagnostic);
});

test("rejects a malformed successful stock RPC payload at the route boundary", async () => {
  const route = loadRoute(async () => ({ data: "unexpected", error: null }));

  const response = await post(route, {
    action: "receive",
    entryId,
    locationId,
    productId,
    txDate: "2026-10-13",
    quantity: 1,
    amount: 0,
  });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    status: "failed",
    errorMessage: "บันทึกสต็อกไม่สำเร็จ",
  });
});

test("rejects a synced stock result whose identity does not match the command", async () => {
  const diagnostic = "private-stock-diagnostic";
  const route = loadRoute(async () => ({
    data: {
      status: "synced",
      id: outId,
      serverBillNo: "AS-261013-0001",
      serverReceivedAt: "2026-10-13T01:02:03.000Z",
      diagnostic,
    },
    error: null,
  }));

  const response = await post(route, {
    action: "receive",
    entryId,
    locationId,
    productId,
    txDate: "2026-10-13",
    quantity: 1,
    amount: 0,
  });

  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain(diagnostic);
});

test("contains stock read RPC failures inside the route boundary", async () => {
  const diagnostic = "relation private.stock_secret does not exist";
  const route = loadRoute(async () => {
    throw new Error(diagnostic);
  });

  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/acid-stock?locationId=${locationId}&view=balances`),
  } as never);

  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain(diagnostic);
});

test("rejects malformed stock balance payloads at the route boundary", async () => {
  const route = loadRoute(async () => ({ data: { secret: "unexpected" }, error: null }));

  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/acid-stock?locationId=${locationId}&view=balances`),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "โหลดข้อมูลสต็อกไม่สำเร็จ" });
});

test("stock balance reads return only validated public fields", async () => {
  const expected = { productId, name: "กรด", unit: "กก.", balance: 12.5 };
  const route = loadRoute(async () => ({
    data: [{ ...expected, internalSecret: "must-not-cross-route-boundary" }],
    error: null,
  }));

  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/acid-stock?locationId=${locationId}&view=balances`),
  } as never);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ balances: [expected] });
});

test("rejects malformed stock movement rows at the route boundary", async () => {
  const route = loadRoute(async () => ({
    data: {
      rows: [{ movement_id: "stock-entry:bad", quantity_delta: "not-a-number" }],
      hasMore: false,
      nextTxDate: null,
      nextCreatedAt: null,
      nextMovementId: null,
    },
    error: null,
  }));

  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/acid-stock?locationId=${locationId}`),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "โหลดข้อมูลสต็อกไม่สำเร็จ" });
});

test("rejects stock movement rows outside the requested location", async () => {
  const page = validMovementPage();
  page.rows = [{ ...page.rows[0], location_id: targetLocationId }];
  const route = loadRoute(async () => ({ data: page, error: null }));

  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/acid-stock?locationId=${locationId}`),
  } as never);

  expect(response.status).toBe(500);
});

test("rejects a next movement cursor that does not match the final row", async () => {
  const route = loadRoute(async () => ({
    data: validMovementPage({ nextMovementId: `stock-entry:${outId}` }),
    error: null,
  }));

  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/acid-stock?locationId=${locationId}`),
  } as never);

  expect(response.status).toBe(500);
});

test("rejects a movement cursor reused with different filters", async () => {
  let calls = 0;
  const route = loadRoute(async () => {
    calls += 1;
    return { data: validMovementPage(), error: null };
  });
  const first = await route.GET({
    nextUrl: new URL(
      `http://local/api/lanflow/acid-stock?locationId=${locationId}&search=alpha&type=all`,
    ),
  } as never);
  const cursor = (await first.json()).nextCursor as string;

  const response = await route.GET({
    nextUrl: new URL(
      `http://local/api/lanflow/acid-stock?locationId=${locationId}&search=beta&type=sale&cursor=${cursor}`,
    ),
  } as never);

  expect(response.status).toBe(400);
  expect(calls).toBe(1);
});

test("rejects a non-ISO next movement timestamp", async () => {
  const route = loadRoute(async () => ({
    data: validMovementPage({ nextCreatedAt: "2026" }),
    error: null,
  }));

  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/acid-stock?locationId=${locationId}`),
  } as never);

  expect(response.status).toBe(500);
});
