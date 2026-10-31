import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";
import type { IncomeExpense } from "../src/types";

const requestId = "7e000000-0000-4000-8000-00000000000e";
const incomeExpenseId = "7e000000-0000-4000-8000-00000000000f";
const paths = {
  income: "src/app/api/lanflow/income-expense/approval-requests/[id]/decide/route.ts",
  cash: "src/app/api/lanflow/cash-branch-transfers/delete-requests/[id]/decide/route.ts",
  branch: "src/app/api/lanflow/money-transfers/delete-requests/[id]/decide/route.ts",
};
type Route = { POST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> };
function route(kind: keyof typeof paths, result: unknown, failure?: "auth" | "rpc") {
  const calls: unknown[] = [];
  const module = loadSourceModule<Route>(paths[kind], {
    "@/lib/server/auth": { requireSystemManager: async () => {
      if (failure === "auth") throw new Error("private transport diagnostic");
      return { ok: true, supabase: { rpc: async (_name: string, payload: unknown) => {
        calls.push(payload);
        if (failure === "rpc") throw new Error("private transport diagnostic");
        return { data: result, error: null };
      } } };
    } },
  });
  return { calls, post: (decision = "approved", id = requestId) => module.POST(new Request("http://local/decide", {
    method: "POST", body: JSON.stringify({ decision }),
  }), { params: Promise.resolve({ id }) }) };
}

for (const decision of ["approved", "rejected"] as const) {
  test(`income route refuses the opposite committed decision to ${decision}`, async () => {
    const response = await route("income", { requestId, incomeExpenseId, status: decision === "approved" ? "rejected" : "approved" }).post(decision);
    expect(response.status).toBe(500);
  });
}

test("income route accepts PostgreSQL UUID casing without reporting a committed decision as failed", async () => {
  const f = route("income", { requestId, incomeExpenseId, status: "approved" });
  expect((await f.post("approved", requestId.toUpperCase())).status).toBe(200);
  expect(f.calls[0]).toMatchObject({ p_request_id: requestId });
});

for (const kind of ["income", "cash", "branch"] as const) {
  for (const failure of ["auth", "rpc"] as const) test(`${kind} route contains a thrown ${failure} failure`, async () => {
    const response = await route(kind, null, failure).post().catch(() => undefined);
    expect(response?.status).toBe(503);
    expect(response?.headers.get("cache-control")).toContain("no-store");
    expect(JSON.stringify(await response?.json())).not.toContain("private transport diagnostic");
  });
  test(`${kind} route control preserves matching success`, async () => {
    expect((await route(kind, { requestId, incomeExpenseId, status: "approved" }).post()).status).toBe(200);
  });
}

function client(response: Response) {
  let invalidations = 0;
  const module = loadSourceModule<typeof import("../src/hooks/useIncomeExpenseApprovals")>("src/hooks/useIncomeExpenseApprovals.ts", {
    react: { useEffect: () => {} },
    "@tanstack/react-query": {
      useQuery: () => ({}),
      useMutation: (options: { mutationFn: (input: unknown) => Promise<unknown>; onSuccess: () => Promise<unknown> }) => ({
        mutateAsync: async (input: unknown) => { const result = await options.mutationFn(input); await options.onSuccess(); return result; },
      }),
      useQueryClient: () => ({ invalidateQueries: async () => { invalidations++; } }),
    },
    "@/lib/supabase/client": { createSupabaseBrowserClient: () => ({}) },
    "@/hooks/useActionableBadges": { ACTIONABLE_BADGES_QUERY_KEY: "actionableBadges" },
    "@/lib/auth-fetch": { authFetch: async () => response },
    "@/lib/connectivity": { getConnectivitySnapshot: () => true },
    "@/lib/income-expense/build-income-expense-payload": { buildIncomeExpensePayload: () => ({}) },
  });
  return { hook: module.useIncomeExpenseApprovals(), invalidations: () => invalidations };
}

for (const kind of ["decideRequest", "decideCashDeleteRequest", "decideBranchDeleteRequest"] as const) {
  for (const result of [{}, { requestId, status: "rejected" }, { requestId: incomeExpenseId, status: "approved" }]) {
    test(`${kind} does not accept a malformed 200 acknowledgement ${JSON.stringify(result)}`, async () => {
      const f = client(Response.json(result));
      const error = await f.hook[kind]({ id: requestId, decision: "approved" }).then(() => null, error => error);
      expect(error).not.toBeNull();
      expect(f.invalidations()).toBe(0);
    });
  }
  test(`${kind} control accepts its matching acknowledgement`, async () => {
    const f = client(Response.json({ requestId, incomeExpenseId, status: "approved" }));
    await f.hook[kind]({ id: requestId, decision: "approved" });
    expect(f.invalidations()).toBeGreaterThan(0);
  });
  test(`${kind} rejects an invalid JSON success without invalidation`, async () => {
    const f = client(new Response("<html>upstream</html>", { status: 200 }));
    const error = await f.hook[kind]({ id: requestId, decision: "approved" }).then(() => null, error => error);
    expect(error?.message).toContain("ยังยืนยันผล");
    expect(f.invalidations()).toBe(0);
  });
}

test("income client requires the approved transaction ID as well as the request and decision", async () => {
  const f = client(Response.json({ requestId, status: "approved" }));
  const error = await f.hook.decideRequest({ id: requestId, decision: "approved" }).then(() => null, error => error);
  expect(error?.message).toContain("ยังยืนยันผล");
  expect(f.invalidations()).toBe(0);
});

test("submission cannot fall through to direct saving after a malformed 200 acknowledgement", async () => {
  const f = client(Response.json({}));
  const error = await f.hook.submitForApprovalIfNeeded({ title: "ทดสอบ", txDate: "2026-10-31", cost: 100, type: "expense" } as IncomeExpense, "create")
    .then(() => null, error => error);
  expect(error).not.toBeNull();
});

for (const result of [{ status: "pending", requestId, matchedReasons: ["amount_threshold"] }, { status: "no_approval" }]) {
  test(`submission control preserves valid ${result.status}`, async () => {
    const f = client(Response.json(result));
    expect(await f.hook.submitForApprovalIfNeeded({ title: "ทดสอบ", txDate: "2026-10-31", cost: 100, type: "expense" } as IncomeExpense, "create"))
      .toEqual({ requiresApproval: result.status === "pending" });
  });
}
