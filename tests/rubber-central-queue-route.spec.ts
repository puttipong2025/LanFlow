import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";

const owner = "ae000000-0000-4000-8000-000000000001";
const branch = "ae000000-0000-4000-8000-000000000002";
const commandId = "ae000000-0000-4000-8000-000000000003";
const payload = { contractVersion: 2, centralQueue: true, actorUserId: owner, commandId, idempotencyKey: commandId,
  locationId: branch, clientTempId: "local", operation: "create", expectedCommandGeneration: 0, expectedQueueVersion: 0, expectedRevisionNo: 0 };
const accepted = { commandId, actorUserId: owner, locationId: branch, clientTempId: "local", action: "create", state: "queued",
  acceptedAt: "2026-10-28T00:00:00Z", version: 1, attempts: 0, nextAttemptAt: "2026-10-28T00:00:00Z",
  errorCode: null, result: null, completedAt: null, canRetire: false };
type Routes = typeof import("../src/app/api/lanflow/rubber-bills/queue/route");
function route(data: unknown, error: unknown = null, authOk = true,
  immediate: () => Promise<boolean> = async () => false, refreshed: unknown = data) {
  let calls = 0; const names: string[] = [];
  const handlers = loadSourceModule<Routes>("src/app/api/lanflow/rubber-bills/queue/route.ts", {
    "@/lib/server/rubber-queue-immediate": { processRubberQueueImmediately: immediate },
    "@/lib/server/auth": { requireAuth: async () => authOk ? { ok: true, auth: { sub: owner },
      supabase: { rpc: async (name: string) => { names.push(name); calls++; return { data: calls === 1 ? data : typeof refreshed === 'function' ? await refreshed() : refreshed, error }; } } } : { ok: false, response: Response.json({}, { status: 401 }) } },
  });
  return { ...handlers, calls: () => calls, names };
}
const post = (value: unknown) => new Request("https://example.test/api/lanflow/rubber-bills/queue", {
  method: "POST", body: JSON.stringify(value), headers: { "Content-Type": "application/json" },
});

test("numbering validation rejection identifies the unchanged command instead of masquerading as an outage", async () => {
  const numbered = { ...payload, localBillNo: "2610310001-D01", billNumbering: { version: 1, issuerId: branch, date: "2026-10-31", sequence: 1 } };
  const response = await route(null, { message: "INVALID_BILL_NUMBER" }).POST(post(numbered));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ errorCode: "NUMBERING_REJECTED", commandId, clientTempId: "local", operation: "create" });
});
for (const metadata of [null, false, { version: 1, issuerId: "bad", date: "2026-10-31", sequence: 1 }]) {
  test(`malformed numbering is a bound permanent rejection before RPC: ${JSON.stringify(metadata)}`, async () => {
    const h = route(accepted);
    const response = await h.POST(post({ ...payload, billNumbering: metadata }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errorCode: "NUMBERING_REJECTED", commandId, clientTempId: "local", operation: "create" });
    expect(h.calls()).toBe(0);
  });
}
test("malformed numbering cannot bind a failure to another actor or an invalid command envelope", async () => {
  for (const change of [{ actorUserId: branch }, { commandId: "invalid" }]) {
    const h = route(accepted), response = await h.POST(post({ ...payload, ...change, billNumbering: null }));
    expect([400, 403]).toContain(response.status);
    expect((await response.json()).errorCode).toBeUndefined(); expect(h.calls()).toBe(0);
  }
});

test("a missing numbered backend cannot silently allocate a legacy bill number", async () => {
  const numbered = { ...payload, localBillNo: "2610310001-D01", billNumbering: { version: 1, issuerId: branch, date: "2026-10-31", sequence: 1 } };
  const handlers = route(null, { code: "PGRST202", message: "Function not found" });
  expect((await handlers.POST(post(numbered))).status).toBe(503);
  expect(handlers.names).toEqual(["submit_numbered_rubber_queue"]);
});

test("GET accepts UUID case variations without losing a valid admitted receipt", async () => {
  const handlers = route(accepted);
  const response = await handlers.GET(new Request(`https://example.test/api/lanflow/rubber-bills/queue?locationId=${branch.toUpperCase()}&commandId=${commandId.toUpperCase()}`));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(accepted);
  expect(handlers.calls()).toBe(1);
});

test("POST accepts equivalent UUID casing without reporting an already committed admission as unavailable", async () => {
  for (const changed of [{ commandId: commandId.toUpperCase(), idempotencyKey: commandId.toUpperCase() },
    { actorUserId: owner.toUpperCase(), locationId: branch.toUpperCase() }]) {
    const handlers = route(accepted);
    const response = await handlers.POST(post({ ...payload, ...changed }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(accepted);
    expect(handlers.calls()).toBe(1);
  }
});

test("PATCH accepts a canonical receipt for a differently cased UUID", async () => {
  const response = await route(accepted).PATCH(new Request("https://example.test", {
    method: "PATCH", body: JSON.stringify({ commandId: commandId.toUpperCase(), version: 1, action: "retry" }),
  }));
  expect(response.status).toBe(200);
});

test("POST returns 202 admission without claiming business success and disables caching", async () => {
  const response = await route(accepted).POST(post(payload));
  expect(response.status).toBe(202);
  expect((await response.json()).state).toBe("queued");
  expect(response.headers.get("cache-control")).toContain("no-store");
});

test("an immediate attempt cannot replace the admitted command with another receipt", async () => {
  for (const refreshed of [null, {}, { ...accepted, commandId: owner }, { ...accepted, locationId: owner }]) {
    const handlers = route(accepted, null, true, async () => true, refreshed);
    const response = await handlers.POST(post(payload));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(accepted);
    expect(handlers.calls()).toBe(2);
  }
});

test("only verified committed business success can return 200 from immediate processing", async () => {
  const done = { ...accepted, state: "done", completedAt: accepted.acceptedAt,
    result: { status: "synced", commandId, id: branch, revisionNo: 1, serverBillNo: "S-1", serverReceivedAt: accepted.acceptedAt } };
  const response = await route(accepted, null, true, async () => true, done).POST(post(payload));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(done);
});

test("failed acceleration keeps durable admission and unauthorized requests never run a worker", async () => {
  let starts = 0;
  const immediate = async () => { starts++; return false; };
  expect((await route(accepted, null, false, immediate).POST(post(payload))).status).toBe(401);
  expect((await route(accepted, null, true, immediate).POST(post({ ...payload, actorUserId: branch }))).status).toBe(403);
  expect(starts).toBe(0);
  expect((await route(accepted, null, true, immediate).POST(post(payload))).status).toBe(202);
  expect(starts).toBe(1);
});

test("optional acceleration and receipt-read exceptions cannot erase a validated durable admission", async () => {
  const unavailable = async () => { throw new Error('transport unavailable'); };
  for (const handlers of [route(accepted, null, true, unavailable), route(accepted, null, true, async () => true, unavailable)]) {
    const response = await handlers.POST(post(payload));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(accepted);
  }
});

test("non-central envelopes are rejected before RPC", async () => {
  for (const centralQueue of [undefined, false, 'true', 1]) {
    const handlers = route(accepted);
    expect((await handlers.POST(post({ ...payload, centralQueue }))).status).toBe(400);
    expect(handlers.calls()).toBe(0);
  }
});
test("malformed timestamp cursors are rejected before RPC while ISO cursors remain valid", async () => {
  for (const before of ['0', '2026-02-30T00:00:00Z', '2026-10-29']) {
    const handlers = route(accepted);
    expect((await handlers.GET(new Request(`https://example.test?locationId=${branch}&before=${encodeURIComponent(before)}`))).status).toBe(400);
    expect(handlers.calls()).toBe(0);
  }
  const handlers = route({ rows: [], counts: { pending: 0, attention: 0 } });
  expect((await handlers.GET(new Request(`https://example.test?locationId=${branch}&before=2026-10-29T00:00:00Z`))).status).toBe(200);
  expect(handlers.calls()).toBe(1);
});
for (const bad of [null, {}, { ...accepted, commandId: owner }, { ...accepted, locationId: owner },
  { ...accepted, actorUserId: branch }, { ...accepted, action: "delete" }, { ...accepted, state: "done", result: {} }]) {
  test(`POST contains malformed or mismatched central receipt ${JSON.stringify(bad)}`, async () => {
    const response = await route(bad).POST(post(payload)); expect(response.status).toBe(503);
  });
}
test("local staging markers cannot reach admission RPC", async () => {
  for (const localContextPending of [true, false, null]) {
    const handlers = route(accepted);
    expect((await handlers.POST(post({ ...payload, localContextPending }))).status).toBe(400);
    expect(handlers.calls()).toBe(0);
  }
});

test("account mismatch and oversized body are rejected before RPC", async () => {
  const handlers = route(accepted);
  expect((await handlers.POST(post({ ...payload, actorUserId: branch }))).status).toBe(403);
  expect((await handlers.POST(post({ ...payload, items: "x".repeat(1024 * 1024) }))).status).toBe(400);
  expect(handlers.calls()).toBe(0);
});
test("authentication and database details never become success receipts", async () => {
  expect((await route(accepted, null, false).POST(post(payload))).status).toBe(401);
  const response = await route(null, { message: 'relation private.secret does not exist' }).POST(post(payload));
  expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("secret");
});
test("shared feed rejects another branch and invalid counts", async () => {
  for (const data of [{ rows: [{ ...accepted, locationId: owner }], counts: { pending: 1, attention: 0 } },
    { rows: [accepted], counts: { pending: -1, attention: 0 } }]) {
    expect((await route(data).GET(new Request(`https://example.test?locationId=${branch}`))).status).toBe(503);
  }
  const response = await route({ rows: [accepted], counts: { pending: 1, attention: 0 } }).GET(new Request(`https://example.test?locationId=${branch}`));
  expect(response.status).toBe(200);
});
test("queue actions bind the exact row version and contain changed-row conflicts", async () => {
  const handlers = route(null, { message: "QUEUE_CHANGED" });
  const response = await handlers.PATCH(new Request("https://example.test", { method: "PATCH", body: JSON.stringify({ commandId, version: 1, action: "retire" }) }));
  expect(response.status).toBe(409);
  expect((await route(accepted).PATCH(new Request("https://example.test", { method: "PATCH", body: JSON.stringify({ commandId, version: 0, action: "retry" }) }))).status).toBe(400);
});

test("malformed command actions are rejected before admission", async () => {
  for (const change of [{ operation: ["create"] }, { queueAction: "unknown" },
    { queueAction: "delete" }, { queueAction: ["approve"] }]) {
    const handlers = route(accepted);
    expect((await handlers.POST(post({ ...payload, ...change }))).status).toBe(400);
    expect(handlers.calls()).toBe(0);
  }
});

test("PATCH rejects array actions before invoking management RPC", async () => {
  const handlers = route(accepted);
  const response = await handlers.PATCH(new Request("https://example.test", {
    method: "PATCH", body: JSON.stringify({ commandId, version: 1, action: ["retry"] }),
  }));
  expect(response.status).toBe(400);
  expect(handlers.calls()).toBe(0);
});

test("shared feed rejects array actions and states rather than trusting string coercion", async () => {
  for (const change of [{ action: ["create"] }, { state: ["done"] }]) {
    const handlers = route({ rows: [{ ...accepted, ...change }], counts: { pending: 1, attention: 0 } });
    expect((await handlers.GET(new Request(`https://example.test?locationId=${branch}`))).status).toBe(503);
  }
});

test("manager receipts require a string business operation while valid approvals remain readable", async () => {
  const result = { status: "approved", commandId, requestId: owner, billId: branch, operation: "delete",
    syncResult: { status: "synced", id: branch, revisionNo: 2, serverBillNo: "S-1", serverReceivedAt: accepted.acceptedAt } };
  for (const operation of ["delete", ["delete"]]) {
    const manager = { ...accepted, clientTempId: `request:${owner}`, action: "approve", state: "done",
      completedAt: accepted.acceptedAt, result: { ...result, operation } };
    const handlers = route({ rows: [manager], counts: { pending: 0, attention: 0 } });
    expect((await handlers.GET(new Request(`https://example.test?locationId=${branch}`))).status)
      .toBe(typeof operation === "string" ? 200 : 503);
  }
});
