import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";

const locationId = "71000000-0000-4000-8000-000000000021";
const policy = {
  locationId, groupId: null, ruleSource: "ungrouped", editWindowMinutes: 30,
  centralPrice: 42, priceAllowance: 1, effectivePriceCap: 43, priceRuleRevision: 1,
  nonCurrentDateRequiresApproval: true, updatedByName: "System", updatedByPhone: null,
  updatedAt: "2026-10-31T00:00:00.000Z",
};

const endpoints = [
  ["approval-settings", "GET"], ["approval-settings", "PUT"],
  ["approval-settings/central", "PUT"], ["approval-settings/max-price-allowance", "PUT"],
  ["approval-settings/price-allowance-auto-reset", "PUT"],
  ["approval-settings/price-allowance-auto-reset-lock", "PUT"],
  ["approval-settings/ungrouped", "PUT"],
  ["approval-groups", "GET"], ["approval-groups", "POST"],
  ["approval-groups/[id]", "PUT"], ["approval-groups/[id]", "DELETE"],
] as const;

for (const [path, method] of endpoints) {
  test(`${method} ${path} contains an unexpected authentication rejection`, async () => {
    const unavailable = async () => { throw new Error("private diagnostic"); };
    const route = loadSourceModule<Record<string, (request: never, context: { params: Promise<{ id: string }> }) => Promise<Response>>>(
      `src/app/api/lanflow/rubber-bills/${path}/route.ts`, {
        "@/lib/server/auth": { requireAuth: unavailable, requireRole: unavailable, requireSystemManager: unavailable },
      },
    );
    const response = await route[method]({} as never, { params: Promise.resolve({ id: locationId }) }).catch(() => undefined);
    expect(response?.status).toBe(503);
    expect(response!.headers.get("cache-control")).toContain("no-store");
    expect(JSON.stringify(await response!.json())).not.toContain("private diagnostic");
  });
}

test("date rule GET contains a rejected RPC", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/route.ts", {
      "@/lib/server/auth": { requireAuth: async () => ({ ok: true, supabase: { rpc: async () => { throw new Error("private database"); } } }) },
    },
  );
  const response = await route.GET({ nextUrl: new URL(`http://local/?locationId=${locationId}`) } as never).catch(() => undefined);
  expect(response?.status).toBe(503);
});

for (const ack of [null, false, {}, { data: true }]) {
  test(`date rule PUT rejects an invalid save acknowledgement ${JSON.stringify(ack)}`, async () => {
    const calls: string[] = [];
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/route")>(
      "src/app/api/lanflow/rubber-bills/approval-settings/route.ts", {
        "@/lib/server/auth": { requireRole: async () => ({ ok: true, supabase: { rpc: async (name: string) => {
          calls.push(name);
          return { data: name === "save_rubber_bill_date_approval_setting" ? ack : policy, error: null };
        } } }) },
      },
    );
    const response = await route.PUT({ nextUrl: new URL(`http://local/?locationId=${locationId}`), json: async () => ({ nonCurrentDateRequiresApproval: true }) } as never);
    expect(response.status).toBe(500);
    expect(calls).toHaveLength(2);
  });
}

async function savePolicy(response: Response, online = true) {
  let mutationIndex = 0;
  let mutationFn: (input: unknown) => Promise<unknown> = async () => { throw new Error("missing mutation"); };
  const module = loadSourceModule<typeof import("../src/hooks/useRubberBillApprovals")>("src/hooks/useRubberBillApprovals.ts", {
    react: { useState: (factory: () => unknown) => [factory(), () => {}], useEffect: () => {} },
    "@tanstack/react-query": {
      useQueryClient: () => ({}), useQuery: () => ({}),
      useMutation: (options: { mutationFn: typeof mutationFn }) => { if (mutationIndex++ === 0) mutationFn = options.mutationFn; return {}; },
    },
    "@/lib/auth-fetch": { authFetch: async () => response },
    "@/lib/connectivity": { getConnectivitySnapshot: () => online },
    "@/hooks/useActionableBadges": {}, "@/lib/idb-queue": {},
  });
  module.useRubberBillApprovals({ locationId, ownerUserId: "owner" });
  return mutationFn({ locationId, nonCurrentDateRequiresApproval: true });
}

for (const [name, body] of [
  ["empty", {}], ["null", null], ["wrong branch", { ...policy, locationId: "other" }],
  ["wrong date value", { ...policy, nonCurrentDateRequiresApproval: false }],
  ["invalid cap", { ...policy, effectivePriceCap: 999 }],
] as const) {
  test(`the date-rule save client rejects a 200 ${name} response`, async () => {
    await expect(savePolicy(Response.json(body))).rejects.toThrow("รูปแบบ");
  });
}

test("the date-rule save client accepts a confirmed current-branch policy", async () => {
  await expect(savePolicy(Response.json(policy))).resolves.toEqual(policy);
});

test("a non-JSON-shaped server failure retains the friendly save error", async () => {
  await expect(savePolicy(Response.json(null, { status: 503 }))).rejects.toThrow("บันทึกการตั้งค่าไม่สำเร็จ");
});

test("an explicit server rejection preserves its actionable save error", async () => {
  await expect(savePolicy(Response.json({ errorMessage: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 }))).rejects.toThrow("ไม่มีสิทธิ์เข้าถึง");
});

test("the date-rule save fails immediately when offline", async () => {
  await expect(savePolicy(Response.json(policy), false)).rejects.toThrow("ออนไลน์");
});

function dateRuleForm() {
  let current = { ...policy, nonCurrentDateRequiresApproval: false };
  const states: unknown[] = [], refs: { current: unknown }[] = [];
  const dependencies: (readonly unknown[] | undefined)[] = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  let effects: (() => unknown)[] = [];
  let checkbox: { checked: boolean; onChange: (event: { target: { checked: boolean } }) => void };
  const noop = () => {};
  const jsx = (type: unknown, props: { type?: string } & typeof checkbox) => {
    if (type === "input" && props.type === "checkbox") checkbox = props;
    return {};
  };
  const module = loadSourceModule<typeof import("../src/components/rubber-bills/RubberBillApprovalModal")>("src/components/rubber-bills/RubberBillApprovalModal.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useState: (initial: unknown) => { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], (value: unknown) => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
      useRef: (initial: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }),
      useMemo: (factory: () => unknown) => factory(),
      useEffect: (effect: () => unknown, deps: readonly unknown[]) => { const index = effectIndex++; if (!dependencies[index] || deps.some((value, key) => !Object.is(value, dependencies[index]![key]))) effects.push(effect); dependencies[index] = deps; },
    },
    sonner: { toast: { success: noop, message: noop, error: noop } },
    "@/components/shared/AlertDialog": { AlertDialog: noop }, "@/components/shared/ModalShell": { ModalShell: noop },
    "@/components/rubber-bills/RubberApprovalPolicyPanel": { RubberApprovalPolicyPanel: noop },
    "@/hooks/useLocations": { useLocations: () => ({ locations: [] }) },
    "@/hooks/useOnlineStatus": { useOnlineStatus: () => true },
    "@/hooks/useRubberBillApprovals": { useRubberBillApprovals: () => ({ settings: current }) },
    "@/hooks/useRubberBillList": { useRubberBillList: () => ({ bills: [] }), useRubberBillWorkCounts: () => ({}) },
    "@/lib/rubber-bills/central-sync": { rubberOwnerWork: async () => [] },
  }, { window: { setInterval: () => 0, clearInterval: noop } });
  const render = () => {
    stateIndex = 0; refIndex = 0; effectIndex = 0; effects = [];
    module.RubberBillApprovalModal({ locationId, profile: { id: "owner", role: "super_admin" } as never, onClose: noop });
    for (const effect of effects) effect();
    return checkbox!;
  };
  return { render, refresh: (next: typeof current) => { current = next; }, current };
}

test("an unrelated policy refresh preserves the edited global date rule", () => {
  const form = dateRuleForm();
  form.render();
  form.render().onChange({ target: { checked: true } });
  expect(form.render().checked).toBe(true);
  form.refresh({ ...form.current, centralPrice: 43, effectivePriceCap: 44 });
  form.render();
  expect(form.render().checked).toBe(true);
});

test("an authoritative date-rule change still refreshes a clean form", () => {
  const form = dateRuleForm();
  form.render();
  form.refresh({ ...form.current, nonCurrentDateRequiresApproval: true });
  form.render();
  expect(form.render().checked).toBe(true);
});
