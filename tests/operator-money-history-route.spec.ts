import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";
import { loadSourceModule } from "./helpers/load-source-module";

const actor = "b1900000-0000-4000-8000-000000000005";
const id = "c1900000-0000-4000-8000-000000000001";
const at = "2026-10-18T16:59:00.123456+00:00";
const payload = {
  actors: [], locations: [], routes: [], rows: [],
  counts: { all: 0, create: 0, update: 0, delete: 0 },
  selectedDate: "2026-10-18", availableFrom: "2026-10-05", availableTo: "2026-10-19",
  retentionDays: 15, latestAt: null, nextCursor: { at, id },
};

function harness(options: { denied?: boolean; error?: { code: string }; throws?: boolean; data?: unknown } = {}) {
  const calls: unknown[] = [];
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/dashboard/operator-history/route")>(
    "src/app/api/lanflow/dashboard/operator-history/route.ts", {
      "@/lib/server/auth": { requireRoleOrSystemManager: async () => options.denied
        ? { ok: false, response: new Response(null, { status: 403 }) }
        : { ok: true, supabase: { rpc: async (name: string, args: unknown) => {
          calls.push({ name, args });
          if (options.throws) throw new Error("private failure");
          return { data: Object.hasOwn(options, "data") ? options.data : payload, error: options.error || null };
        } } } },
    });
  return { calls, get: (query = "") => route.GET(new NextRequest(`http://localhost/api/lanflow/dashboard/operator-history?${query}`)) };
}

test("operator route forwards filters, preserves cursor precision and remains private", async () => {
  const { get, calls } = harness();
  const cursor = Buffer.from(`${at}|${id}`).toString("base64");
  const response = await get(new URLSearchParams({ actor, date: "2026-10-18", route: "rubber-bills", action: "create", cursor }).toString());
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("private, no-store");
  expect((await response.json()).nextCursor).toBe(cursor);
  expect(calls).toEqual([{ name: "get_operator_money_history", args: {
    p_actor_key: actor, p_location_id: null, p_route: "rubber-bills", p_event_date: "2026-10-18",
    p_action: "create", p_cursor_at: at, p_cursor_id: id,
  } }]);
});

test("operator route rejects invalid inputs before calling DB", async () => {
  const invalidCursor = Buffer.from(`2026-02-30T12:00:00Z|${id}`).toString("base64");
  for (const query of ["actor=invalid", "locationId=invalid", "route=__proto__", "action=bad", "date=2026-02-30", "date=bad", "cursor=bad", `cursor=${invalidCursor}`, "actor=", "route="]) {
    const { get, calls } = harness();
    expect((await get(query)).status, query).toBe(400);
    expect(calls).toHaveLength(0);
  }
});

test("operator route supports initial options and unknown actor without inventing an ID", async () => {
  const { get, calls } = harness();
  expect((await get()).status).toBe(200);
  expect((await get("actor=unknown")).status).toBe(200);
  expect(calls).toMatchObject([{ args: { p_actor_key: null } }, { args: { p_actor_key: "unknown" } }]);
});

test("operator route keeps authorization failures out of RPC", async () => {
  const { get, calls } = harness({ denied: true });
  expect((await get()).status).toBe(403);
  expect(calls).toHaveLength(0);
});

for (const [code, status] of [["42501", 403], ["22023", 400], ["22P02", 400], ["XX000", 500]] as const) {
  test(`operator route maps database ${code} to ${status}`, async () => {
    const response = await harness({ error: { code } }).get();
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toContain("private, no-store");
  });
}
test("operator route returns bounded errors for thrown or malformed responses", async () => {
  for (const options of [{ throws: true }, { data: null }, { data: {} },
    { data: { ...payload, counts: { all: "0" } } },
    { data: { ...payload, selectedDate: "invalid" } },
    { data: { ...payload, routes: [{ key: "bad", count: 1 }] } },
    { data: { ...payload, rows: [{}] } },
    { data: { ...payload, nextCursor: { at: "invalid", id } } }]) {
    const response = await harness(options).get();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private failure");
  }
});

test("operator query isolates account and all filters without reusing stale placeholders", async () => {
  const hook = loadSourceModule<{
    useOperatorMoneyHistory: (scope: string, online: boolean, filters: Record<string, string>) => {
      queryKey: unknown[]; enabled: boolean; gcTime: number; placeholderData?: unknown;
    };
  }>("src/hooks/useOperatorMoneyHistory.ts", {
    "@tanstack/react-query": { useQuery: (options: unknown) => options },
    "@/lib/auth-fetch": {},
  });
  const filters = { actor, locationId: id, route: "rubber-bills", date: "2026-10-18", action: "update", cursor: "next" };
  const first = hook.useOperatorMoneyHistory("account-A:scope-A", true, filters);
  const second = hook.useOperatorMoneyHistory("account-B:scope-B", true, filters);
  expect(first.queryKey).toEqual(["creatorMoneyHistory", "account-A:scope-A", filters]);
  expect(second.queryKey).not.toEqual(first.queryKey);
  expect(first.placeholderData).toBeUndefined();
  expect(first.gcTime).toBe(0);
  expect(hook.useOperatorMoneyHistory("account-A:scope-A", false, filters).enabled).toBe(false);
});

test("operator route rejects PostgreSQL-invalid year zero without querying DB", async () => {
  const { get, calls } = harness();
  expect((await get("date=0000-01-01")).status).toBe(400);
  expect(calls).toHaveLength(0);
});

test("operator response rejects array-shaped action and direction instead of coercing them", async () => {
  const row = {
    id, locationId: id, locationName: "Fixture", route: "income-expense",
    sourceType: "income_expense", kind: "income", number: "FIX", title: "Fixture",
    actorName: "Fixture", amount: 10, occurredAt: at, action: "create", direction: "income",
  };
  // Control: a canonical row is accepted. Only the enum value shape changes below.
  expect((await harness({ data: { ...payload, rows: [row] } }).get()).status).toBe(200);
  for (const patch of [{ action: ["create"] }, { direction: ["income"] }]) {
    const response = await harness({ data: { ...payload, rows: [{ ...row, ...patch }] } }).get();
    expect(response.status, JSON.stringify(patch)).toBe(500);
  }
});
