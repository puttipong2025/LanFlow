import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";
import type { ApprovalSettingsInput } from "../src/lib/income-expense/approval-settings-mutations";

async function rejects(promise: Promise<unknown>, message: string) {
  const error = await Promise.resolve(promise).then(() => null, caught => caught);
  expect(error).not.toBeNull();
  expect(error.message).toContain(message);
}

const id = "74000000-0000-4000-8000-000000000001";
const settings = { applies_to: "both", approval_min_amount: 100, non_current_date_requires_approval: false, cash_transfer_delete_requires_approval: true };
const keyword = { id, keyword: "เบิก", applies_to: "expense", match_mode: "contains", is_active: true, approval_min_amount: null };
type Result = { data: unknown; error: { code: string; message?: string } | null; status: number };

function fixture({ online = true, role = "super_admin", active = true, result = { data: settings, error: null, status: 200 } as Result } = {}) {
  const writes: Array<{ table: string; values: Record<string, unknown>; filters: unknown[][] }> = [];
  let authReads = 0;
  const client = {
    auth: { getSession: async () => { authReads++; return { data: { session: { user: { id } } }, error: null }; } },
    from: (table: string) => {
      let write: typeof writes[number] | undefined;
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => { write?.filters.push(["eq", key, value]); return builder; },
        is: (key: string, value: unknown) => { write?.filters.push(["is", key, value]); return builder; },
        update: (values: Record<string, unknown>) => { write = { table, values, filters: [] }; writes.push(write); return builder; },
        insert: (values: Record<string, unknown>) => { write = { table, values, filters: [] }; writes.push(write); return builder; },
        single: async () => table === "profiles" ? { data: { id, name: "Super", phone: "0800000000", role, is_active: active }, error: null } : result,
        maybeSingle: async () => result,
      };
      return builder;
    },
  };
  const module = loadSourceModule<typeof import("../src/lib/income-expense/approval-settings-mutations")>("src/lib/income-expense/approval-settings-mutations.ts", {
    "@/lib/connectivity": { getConnectivitySnapshot: () => online },
  });
  return { module, client: client as unknown as Parameters<typeof module.saveApprovalSettings>[0], writes, authReads: () => authReads };
}

test("partial amount save uses a null comparison and cannot write date or cash rules", async () => {
  const f = fixture();
  const patch = await f.module.saveApprovalSettings(f.client, { kind: "amount", expected: { appliesTo: "both", approvalMinAmount: null }, value: { appliesTo: "both", approvalMinAmount: 100 } });
  expect(f.writes[0].filters).toContainEqual(["is", "approval_min_amount", null]);
  expect(f.writes[0].values).not.toHaveProperty("non_current_date_requires_approval");
  expect(f.writes[0].values).not.toHaveProperty("cash_transfer_delete_requires_approval");
  expect(f.writes[0].values).not.toHaveProperty("updated_at");
  expect(patch).toMatchObject({ approvalMinAmount: 100, appliesTo: "both" });
  expect(patch).not.toHaveProperty("nonCurrentDateRequiresApproval");
});

for (const [kind, column] of [["date", "non_current_date_requires_approval"], ["cashDelete", "cash_transfer_delete_requires_approval"]] as const) {
  test(`${kind} compares and updates only its own rule`, async () => {
    const f = fixture({ result: { data: { ...settings, [column]: true }, error: null, status: 200 } });
    await f.module.saveApprovalSettings(f.client, { kind, expected: false, value: true });
    expect(f.writes[0].filters).toContainEqual(["eq", column, false]);
    expect(Object.keys(f.writes[0].values).filter(key => !key.startsWith("updated_by"))).toEqual([column]);
  });
}

for (const value of [-1, 0.001, 10_000_000_000, Infinity, NaN]) {
  test(`rejects invalid amount ${value} before any I/O`, async () => {
    const f = fixture();
    await rejects(f.module.saveApprovalSettings(f.client, { kind: "amount", value: { appliesTo: "both", approvalMinAmount: value }, expected: { appliesTo: "both", approvalMinAmount: null } }), "ยอดเงิน");
    expect(f.authReads()).toBe(0);
    expect(f.writes).toHaveLength(0);
  });
}

test("offline settings and keyword actions fail immediately without queuing a write", async () => {
  const f = fixture({ online: false });
  for (const action of [() => f.module.saveApprovalSettings(f.client, { kind: "date", expected: false, value: true }),
    () => f.module.addApprovalKeyword(f.client, { id, keyword: "เบิก", appliesTo: "expense", matchMode: "contains", approvalMinAmount: null }),
    () => f.module.disableApprovalKeyword(f.client, id)]) await rejects(action(), "ออนไลน์เท่านั้น");
  expect(f.authReads()).toBe(0); expect(f.writes).toHaveLength(0);
});

test("an unknown section cannot fall through to the cash-delete rule", async () => {
  const f = fixture();
  await rejects(f.module.saveApprovalSettings(f.client, { kind: "unknown", value: true, expected: false } as unknown as ApprovalSettingsInput), "ส่วนการตั้งค่าไม่ถูกต้อง");
  expect(f.authReads()).toBe(0); expect(f.writes).toHaveLength(0);
});

for (const actor of [{ role: "admin", active: true }, { role: "super_admin", active: false }]) {
  test(`actor ${actor.role}/${actor.active} cannot start a config write`, async () => {
    const f = fixture(actor);
    await rejects(f.module.saveApprovalSettings(f.client, { kind: "date", expected: false, value: true }), "เฉพาะ Super Admin");
    expect(f.writes).toHaveLength(0);
  });
}

test("zero affected rows and missing settings never report success", async () => {
  const f = fixture({ result: { data: null, error: null, status: 200 } });
  await rejects(f.module.saveApprovalSettings(f.client, { kind: "date", expected: false, value: true }), "โหลดค่าล่าสุด");
  expect(() => f.module.readApprovalSettings(null)).toThrow("โหลดการตั้งค่าไม่สำเร็จ");
});

test("a lost write response is uncertain and is not retried", async () => {
  const f = fixture({ result: { data: null, error: { code: "", message: "Failed to fetch" }, status: 0 } });
  const error = await f.module.saveApprovalSettings(f.client, { kind: "date", expected: false, value: true }).catch(e => e);
  expect(error.uncertain).toBe(true); expect(f.writes).toHaveLength(1);
});

test("a mismatched acknowledgement cannot produce a success patch", async () => {
  const f = fixture();
  const error = await f.module.saveApprovalSettings(f.client, { kind: "date", expected: false, value: true }).catch(e => e);
  expect(error.uncertain).toBe(true);
});

test("keyword creation binds the acknowledgement to the client operation ID", async () => {
  const f = fixture({ result: { data: keyword, error: null, status: 201 } });
  const row = await f.module.addApprovalKeyword(f.client, { id, keyword: " เบิก ", appliesTo: "expense", matchMode: "contains", approvalMinAmount: null });
  expect(row.id).toBe(id); expect(f.writes[0].values.id).toBe(id); expect(f.writes[0].values.keyword).toBe("เบิก");
});

test("disable requires an active target and checks the resulting target and status", async () => {
  const f = fixture({ result: { data: { ...keyword, is_active: false }, error: null, status: 200 } });
  const row = await f.module.disableApprovalKeyword(f.client, id);
  expect(row.isActive).toBe(false); expect(f.writes[0].filters).toContainEqual(["eq", "is_active", true]);
  const missing = fixture({ result: { data: null, error: null, status: 200 } });
  await rejects(missing.module.disableApprovalKeyword(missing.client, id), "ถูกปิดแล้ว");
});

test("production hook merges out-of-order section acknowledgements without reverting the offline date cache", async () => {
  const mutations: Array<{ onSuccess: (patch: Record<string, unknown>) => Promise<unknown> }> = [];
  let cache: Record<string, unknown> = { appliesTo: "both", approvalMinAmount: null, nonCurrentDateRequiresApproval: false, cashTransferDeleteRequiresApproval: true };
  const dates: boolean[] = [];
  const hook = loadSourceModule<typeof import("../src/hooks/useIncomeExpenseApprovals")>("src/hooks/useIncomeExpenseApprovals.ts", {
    react: { useEffect: () => {} },
    "@tanstack/react-query": {
      useQuery: () => ({}), useMutation: (options: typeof mutations[number]) => { mutations.push(options); return {}; },
      useQueryClient: () => ({ cancelQueries: async () => {}, invalidateQueries: async () => {}, setQueryData: (_key: unknown, update: (current: typeof cache) => typeof cache) => { cache = update(cache); } }),
    },
    "@/lib/supabase/client": { createSupabaseBrowserClient: () => ({}) },
    "@/hooks/useActionableBadges": { ACTIONABLE_BADGES_QUERY_KEY: "actionableBadges" },
    "@/lib/connectivity": { getConnectivitySnapshot: () => true },
    "@/lib/income-expense/approval-cache": { saveIncomeExpenseApprovalSettingsCache: (date: boolean) => dates.push(date) },
  });
  hook.useIncomeExpenseApprovals();
  const save = mutations[2];
  await save.onSuccess({ nonCurrentDateRequiresApproval: true });
  const amount: ApprovalSettingsInput = { kind: "amount", value: { appliesTo: "expense", approvalMinAmount: 500 }, expected: { appliesTo: "both", approvalMinAmount: null } };
  const f = fixture();
  await save.onSuccess(f.module.approvalSettingsPatch(amount, { appliesTo: "expense", approvalMinAmount: 500, nonCurrentDateRequiresApproval: false, cashTransferDeleteRequiresApproval: true }));
  expect(cache).toMatchObject({ approvalMinAmount: 500, nonCurrentDateRequiresApproval: true });
  expect(dates).toEqual([true]);
});

test("opening a targeted approval waits for the count query before focusing the rendered card", () => {
  let loading = true;
  let focuses = 0;
  let effectIndex = 0;
  const previousDependencies: unknown[][] = [];
  const queued: Array<() => void> = [];
  const requests = [{ id, locationId: "branch" }];
  const none: never[] = [];
  const module = loadSourceModule<typeof import("../src/components/income-expense/IncomeExpenseApprovalModal")>("src/components/income-expense/IncomeExpenseApprovalModal.tsx", {
    react: {
      useEffect: (effect: () => void, dependencies: unknown[]) => {
        const index = effectIndex++;
        if (!previousDependencies[index] || dependencies.some((value, i) => value !== previousDependencies[index][i])) queued.push(effect);
        previousDependencies[index] = dependencies;
      },
      useMemo: (fn: () => unknown) => fn(), useRef: (current: unknown) => ({ current }), useState: (value: unknown) => [value, () => {}],
    },
    "@/hooks/useIncomeExpenseApprovals": { useIncomeExpenseApprovals: () => ({ requests, cashDeleteRequests: none, branchDeleteRequests: none, requestsLoading: loading }) },
    "@/hooks/useLocations": { useLocations: () => ({ locations: [] }) },
    "@/hooks/useInputDialog": { useInputDialog: () => ({}) },
    "@/components/shared/ModalShell": { ModalShell: () => null },
    "@/components/shared/AlertDialog": { AlertDialog: () => null },
    "./IncomeExpenseApprovalTable": { IncomeExpenseApprovalTable: () => null },
    "./IncomeExpenseApprovalSettings": { IncomeExpenseApprovalSettings: () => null },
  }, {
    document: { getElementById: (target: string) => !loading && target === `income-expense-approval-request-${id}` ? { scrollIntoView: () => {}, focus: () => { focuses++; } } : null },
  });
  function render() {
    effectIndex = 0;
    module.IncomeExpenseApprovalModal({ initialLocationId: "all", initialRequestId: id, canEditSettings: true, onClose: () => {} });
    queued.splice(0).forEach(effect => effect());
  }
  render(); expect(focuses).toBe(0);
  loading = false; render(); expect(focuses).toBe(1);
});
