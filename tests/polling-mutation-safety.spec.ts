import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";
import { CASH_COUNT_OVERDUE_CODE } from "../src/lib/cash-count-lock";

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const payload = {
  id, sourceLocationId: id, targetLocationId: otherId, idempotencyKey: "stable-replay-key",
  sent: { coin1: 0, coin2: 0, coin5: 0, coin10: 0, banknote20: 1, banknote50: 0, banknote100: 0, banknote500: 0, banknote1000: 0 },
};

function cashCreate(data: unknown, error: { message: string } | null = null, throws = false) {
  let calls = 0;
  const mod = loadSourceModule<typeof import("../src/app/api/lanflow/cash-branch-transfers/route")>(
    "src/app/api/lanflow/cash-branch-transfers/route.ts", {
      "@/lib/server/auth": {
        requireAuth: async () => ({ ok: true, auth: { sub: id, locationIds: [id] }, supabase: {
          rpc: async () => { calls++; if (throws) throw new Error("private RPC failure"); return { data, error }; },
        } }),
      },
    }, { console: { error: () => {} } },
  );
  return { post: () => mod.POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify(payload) })), calls: () => calls };
}

test("cash create preserves valid result and canonical idempotent replay identity", async () => {
  for (const canonicalId of [id, otherId]) {
    const result = { id: canonicalId, status: "synced" };
    const response = await cashCreate(result).post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
  }
});

test("cash create cannot report success for an invalid RPC result", async () => {
  for (const result of [null, {}, { id: "broken", status: "synced" }, { id, status: "failed" }]) {
    const target = cashCreate(result);
    expect((await target.post()).status).toBe(500);
    expect(target.calls()).toBe(1);
  }
});

test("cash create catches RPC exceptions without exposing details or retrying the write", async () => {
  const target = cashCreate(null, null, true);
  const response = await target.post();
  expect(response.status).toBe(500);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.text()).not.toContain("private RPC failure");
  expect(target.calls()).toBe(1);
});

test("cash create preserves known authorization errors", async () => {
  const response = await cashCreate(null, { message: "ไม่มีสิทธิ์สร้างรายการสำหรับสาขานี้" }).post();
  expect(response.status).toBe(403);
});

for (const status of [401, 409]) {
  test(`authFetch accepts a JSON-null ${status} without crashing or emitting a false auth event`, async () => {
    const events: unknown[] = [];
    const mod = loadSourceModule<typeof import("../src/lib/auth-fetch")>("src/lib/auth-fetch.ts", {
      "@/lib/network-abort": { abortableFetch: async () => Response.json(null, { status }) },
    }, { window: { dispatchEvent: (event: unknown) => events.push(event), location: { pathname: "/", assign: () => events.push("redirect") } } });
    const response = await mod.authFetch("/api/lanflow/example");
    expect(response.status).toBe(status);
    expect(events).toEqual([]);
    expect(await response.json()).toBeNull();
  });
}

test("authFetch still emits session revocation and redirects for a valid auth error", async () => {
  const events: unknown[] = [];
  const mod = loadSourceModule<typeof import("../src/lib/auth-fetch")>("src/lib/auth-fetch.ts", {
    "@/lib/network-abort": { abortableFetch: async () => Response.json({ errorCode: "SESSION_REVOKED" }, { status: 401 }) },
  }, { CustomEvent, window: { dispatchEvent: (event: CustomEvent) => events.push(event.detail), location: { pathname: "/", assign: () => events.push("redirect") } } });
  expect((await mod.authFetch("/api/lanflow/example")).status).toBe(401);
  expect(events).toEqual(["SESSION_REVOKED", "redirect"]);
});

test("authFetch still announces a valid overdue cash-count lock", async () => {
  const events: string[] = [];
  const mod = loadSourceModule<typeof import("../src/lib/auth-fetch")>("src/lib/auth-fetch.ts", {
    "@/lib/network-abort": { abortableFetch: async () => Response.json({ errorCode: CASH_COUNT_OVERDUE_CODE }, { status: 409 }) },
  }, { Event, window: { dispatchEvent: (event: Event) => events.push(event.type) } });
  expect((await mod.authFetch("/api/lanflow/example")).status).toBe(409);
  expect(events).toEqual(["lanflow:cash-count-lock-changed"]);
});

function cashDecision(data: unknown, throws = false, authorized = true) {
  let calls = 0;
  const mod = loadSourceModule<typeof import("../src/app/api/lanflow/cash-branch-transfers/delete-requests/[id]/decide/route")>(
    "src/app/api/lanflow/cash-branch-transfers/delete-requests/[id]/decide/route.ts", {
      "@/lib/server/auth": { requireSystemManager: async () => authorized
        ? { ok: true, supabase: { rpc: async () => { calls++; if (throws) throw new Error("private decision failure"); return { data, error: null }; } } }
        : { ok: false, response: Response.json({ error: "forbidden" }, { status: 403 }) } },
    }, { console: { error: () => {} } },
  );
  return {
    post: (decision = "approved", requestId = id) => mod.POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ decision }) }) as import("next/server").NextRequest, { params: Promise.resolve({ id: requestId }) }),
    calls: () => calls,
  };
}

test("cash deletion decision preserves approved and rejected acknowledgements", async () => {
  for (const status of ["approved", "rejected"]) {
    const data = { status, requestId: id };
    const response = await cashDecision(data).post(status);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(data);
  }
});

test("cash deletion decision accepts UUID case normalization by PostgreSQL", async () => {
  const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  expect((await cashDecision({ status: "approved", requestId }).post("approved", requestId.toUpperCase())).status).toBe(200);
});

test("cash deletion decision rejects malformed or mismatched acknowledgements", async () => {
  for (const data of [null, {}, { status: "approved", requestId: otherId }, { status: "rejected", requestId: id }]) {
    const target = cashDecision(data);
    expect((await target.post()).status).toBe(500);
    expect(target.calls()).toBe(1);
  }
});

test("cash deletion decision converts RPC throw into opaque JSON without retry", async () => {
  const target = cashDecision(null, true);
  const response = await target.post();
  expect(response.status).toBe(500);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.text()).not.toContain("private decision failure");
  expect(target.calls()).toBe(1);
});

test("cash deletion decision blocks unauthorized and invalid requests before RPC", async () => {
  const denied = cashDecision(null, false, false);
  expect((await denied.post()).status).toBe(403);
  expect(denied.calls()).toBe(0);
  const invalid = cashDecision(null);
  expect((await invalid.post("deleted")).status).toBe(400);
  expect(invalid.calls()).toBe(0);
});

function cashReceive(data: unknown, throws = false) {
  let calls = 0;
  const mod = loadSourceModule<typeof import("../src/app/api/lanflow/cash-branch-transfers/[id]/receive/route")>(
    "src/app/api/lanflow/cash-branch-transfers/[id]/receive/route.ts", {
      "@/lib/server/auth": { requireAuth: async () => ({ ok: true, supabase: {
        rpc: async () => { calls++; if (throws) throw new Error("private receipt failure"); return { data, error: null }; },
      } }) },
    }, { console: { error: () => {} } },
  );
  return {
    post: (requestId = id, body: unknown = { received: payload.sent }) => mod.POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: requestId }) }),
    calls: () => calls,
  };
}

test("cash receipt preserves valid zero and negative differences and UUID normalization", async () => {
  const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const difference of [0, -20, 20]) {
    const data = { id: requestId, status: "synced", difference };
    const response = await cashReceive(data).post(requestId.toUpperCase());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(data);
  }
});

test("cash receipt rejects missing or mismatched RPC acknowledgements", async () => {
  for (const data of [null, {}, { id: otherId, status: "synced", difference: 0 }, { id, status: "failed", difference: 0 }, { id, status: "synced", difference: "wrong" }]) {
    const target = cashReceive(data);
    expect((await target.post()).status).toBe(500);
    expect(target.calls()).toBe(1);
  }
});

test("cash receipt catches RPC exceptions without exposing details or retrying", async () => {
  const target = cashReceive(null, true);
  const response = await target.post();
  expect(response.status).toBe(500);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.text()).not.toContain("private receipt failure");
  expect(target.calls()).toBe(1);
});

test("cash receipt rejects invalid input before calling RPC", async () => {
  const target = cashReceive(null);
  expect((await target.post("invalid")).status).toBe(400);
  expect((await target.post(id, { received: {} })).status).toBe(400);
  expect(target.calls()).toBe(0);
});

function cashEditOrDelete(data: unknown, error: { message: string } | null = null, throws = false, authorized = true) {
  let calls = 0;
  const mod = loadSourceModule<typeof import("../src/app/api/lanflow/cash-branch-transfers/[id]/route")>(
    "src/app/api/lanflow/cash-branch-transfers/[id]/route.ts", {
      "@/lib/server/auth": { requireAuth: async () => authorized
        ? { ok: true, supabase: { rpc: async () => { calls++; if (throws) throw new Error("private mutation failure"); return { data, error }; } } }
        : { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) } },
    }, { console: { error: () => {} } },
  );
  return {
    invoke: (method: "PATCH" | "DELETE", requestId = id) => mod[method](new Request("http://localhost/api", { method, ...(method === "PATCH" ? { body: JSON.stringify(payload) } : {}) }), { params: Promise.resolve({ id: requestId }) }),
    calls: () => calls,
  };
}

for (const method of ["PATCH", "DELETE"] as const) {
  test(`cash ${method} preserves valid response and normalized UUID`, async () => {
    const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const results = method === "PATCH" ? [{ id: requestId, status: "synced" }]
      : [{ id: requestId, status: "deleted" }, { id: requestId, status: "pending_approval", requestId: otherId }];
    for (const data of results) {
      const response = await cashEditOrDelete(data).invoke(method, requestId.toUpperCase());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(data);
    }
  });

  test(`cash ${method} rejects malformed acknowledgement`, async () => {
    const status = method === "PATCH" ? "synced" : "deleted";
    const results: unknown[] = [null, {}, { id: otherId, status }, { id, status: "wrong" }];
    if (method === "DELETE") results.push({ id, status: "pending_approval" }, { id, status: "pending_approval", requestId: "invalid" });
    for (const data of results) {
      const target = cashEditOrDelete(data);
      expect((await target.invoke(method)).status).toBe(500);
      expect(target.calls()).toBe(1);
    }
  });

  test(`cash ${method} catches exception without leaking or retrying`, async () => {
    const target = cashEditOrDelete(null, null, true);
    const response = await target.invoke(method);
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).not.toContain("private mutation failure");
    expect(target.calls()).toBe(1);
  });

  test(`cash ${method} preserves authorization, input and conflict errors`, async () => {
    const denied = cashEditOrDelete(null, null, false, false);
    expect((await denied.invoke(method)).status).toBe(401);
    expect(denied.calls()).toBe(0);
    const invalid = cashEditOrDelete(null);
    expect((await invalid.invoke(method, "invalid")).status).toBe(400);
    expect(invalid.calls()).toBe(0);
    expect((await cashEditOrDelete(null, { message: "คำขอนี้ถูกดำเนินการแล้ว" }).invoke(method)).status).toBe(409);
  });
}
