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
function route(data: unknown, error: unknown = null, authOk = true) {
  let calls = 0;
  const handlers = loadSourceModule<Routes>("src/app/api/lanflow/rubber-bills/queue/route.ts", {
    "@/lib/server/auth": { requireAuth: async () => authOk ? { ok: true, auth: { sub: owner },
      supabase: { rpc: async () => { calls++; return { data, error }; } } } : { ok: false, response: Response.json({}, { status: 401 }) } },
  });
  return { ...handlers, calls: () => calls };
}
const post = (value: unknown) => new Request("https://example.test/api/lanflow/rubber-bills/queue", {
  method: "POST", body: JSON.stringify(value), headers: { "Content-Type": "application/json" },
});
test("POST returns 202 admission without claiming business success and disables caching", async () => {
  const response = await route(accepted).POST(post(payload));
  expect(response.status).toBe(202);
  expect((await response.json()).state).toBe("queued");
  expect(response.headers.get("cache-control")).toContain("no-store");
});
for (const bad of [null, {}, { ...accepted, commandId: owner }, { ...accepted, locationId: owner },
  { ...accepted, actorUserId: branch }, { ...accepted, action: "delete" }, { ...accepted, state: "done", result: {} }]) {
  test(`POST contains malformed or mismatched central receipt ${JSON.stringify(bad)}`, async () => {
    const response = await route(bad).POST(post(payload)); expect(response.status).toBe(503);
  });
}
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
