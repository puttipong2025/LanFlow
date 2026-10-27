import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";
import { loadSourceModule } from "./helpers/load-source-module";

const id = "11111111-1111-4111-8111-111111111111";
const cashPath = "src/app/api/lanflow/cash-branch-transfers/route.ts";
const evidencePath = "src/app/api/lanflow/evidence/feed/route.ts";
const browserPath = "src/app/api/lanflow/admin/browser-approvals/route.ts";

function route(file: string, data: unknown, { throws = false, allowed = true } = {}) {
  let calls = 0;
  let args: Record<string, unknown> = {};
  const rpc = async (_name: string, values: Record<string, unknown>) => {
    calls++;
    args = values;
    if (throws) throw new Error("private transport diagnostics");
    return { data, error: null };
  };
  const mod = loadSourceModule<{ GET: (request: NextRequest) => Promise<Response> }>(file, {
    "@/lib/server/auth": {
      requireAuth: async () => allowed ? { ok: true, auth: { sub: id, locationIds: [id] }, supabase: { rpc } }
        : { ok: false, response: Response.json({ error: "denied" }, { status: 401 }) },
      hasSystemManagerAccess: () => true,
    },
    "@/lib/server/supabase-admin": { createSupabaseAdminClient: () => ({ rpc }) },
    "@/lib/server/sms-otp": {
      SMS_HEADERS: { "Cache-Control": "private, no-store" },
      smsError: (error: string, status = 400) => Response.json({ error }, { status }),
    },
  }, { console: { error: () => {} } });
  return { get: (query = `locationId=${id}`) => mod.GET(new NextRequest(`http://localhost/api?${query}`)), calls: () => calls, args: () => args };
}

test("valid empty queues remain successful and unauthorized reads never reach RPC", async () => {
  for (const [file, data] of [[cashPath, { transfers: [], total: 0 }], [evidencePath, { rows: [], hasMore: false }], [browserPath, []]] as const) {
    expect((await route(file, data).get()).status).toBe(200);
    const denied = route(file, data, { allowed: false });
    expect((await denied.get()).status).toBe(401);
    expect(denied.calls()).toBe(0);
  }
});

test("browser list rejects malformed RPC data before publishing a successful response", async () => {
  for (const data of [null, {}, [{ userId: id, pending: null }]]) {
    expect((await route(browserPath, data).get()).status).toBe(503);
  }
});

test("evidence invalid UUIDs and cursor positions fail before RPC", async () => {
  const empty = { rows: [], hasMore: false };
  for (const query of ["locationId=broken", `locationId=${id}&billId=broken`]) {
    const target = route(evidencePath, empty);
    expect((await target.get(query)).status).toBe(400);
    expect(target.calls()).toBe(0);
  }
  const cursor = Buffer.from(JSON.stringify({ version: 1, ownerUserId: id, locationId: id, view: "pending", search: "", billId: null, sortAt: "not-a-date", cursorBillId: id })).toString("base64url");
  const target = route(evidencePath, empty);
  expect((await target.get(`locationId=${id}&cursor=${cursor}`)).status).toBe(400);
  expect(target.calls()).toBe(0);
});

test("evidence malformed rows and incomplete next-page metadata cannot become empty success", async () => {
  for (const data of [null, { rows: "broken", hasMore: false }, { rows: [{}], hasMore: false }, { rows: [], hasMore: true, nextSortAt: null, nextBillId: null }]) {
    expect((await route(evidencePath, data).get()).status).toBe(500);
  }
});

test("cash malformed summary cannot masquerade as an empty queue", async () => {
  for (const data of [null, {}, { transfers: [], total: 3 }, { transfers: [{}], total: 1 }]) {
    expect((await route(cashPath, data).get()).status).toBe(500);
  }
});

test("queue RPC exceptions produce opaque JSON errors rather than rejecting the route", async () => {
  for (const file of [cashPath, evidencePath]) {
    const response = await route(file, null, { throws: true }).get();
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).not.toContain("private transport diagnostics");
  }
});

test("evidence cursor round-trips database microseconds and rejects a foreign owner", async () => {
  const at = "2026-10-27T01:02:03.123456+00:00";
  const data = { rows: [{ id, revision_no: 1 }], hasMore: true, nextSortAt: at, nextBillId: id };
  const first = await route(evidencePath, data).get();
  expect(first.status).toBe(200);
  const { nextCursor } = await first.json();
  const next = route(evidencePath, { rows: [], hasMore: false });
  expect((await next.get(`locationId=${id}&cursor=${nextCursor}`)).status).toBe(200);
  expect(next.args().p_cursor_sort_at).toBe(at);
  const parsed = JSON.parse(Buffer.from(nextCursor, "base64url").toString("utf8"));
  parsed.ownerUserId = "22222222-2222-4222-8222-222222222222";
  const foreign = route(evidencePath, data);
  expect((await foreign.get(`locationId=${id}&cursor=${Buffer.from(JSON.stringify(parsed)).toString("base64url")}`)).status).toBe(400);
  expect(foreign.calls()).toBe(0);
});
