import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";

const locationId = "71000000-0000-4000-8000-000000000021";
type Confirmation = { kind: "central"; value: number; previousValue: number; expectedRevision: number };
type Action = "group" | "ungrouped" | "confirmation" | "toggle" | "lock";

function panel(action: Action, offlineFailure = false, onlineFailure = false) {
  const states: unknown[] = [], refs: { current: unknown }[] = [];
  let stateIndex = 0, refIndex = 0;
  const calls: string[] = [], errors: string[] = [];
  let refreshes = 0, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let invoke: () => void = () => { throw new Error("missing action"); };
  const noop = () => {};
  const alert = () => null, toggle = () => null, lock = () => null;
  const centralConfirmation: Confirmation = { kind: "central", value: 43, previousValue: 42, expectedRevision: 1 };
  states[4] = [locationId]; states[8] = action === "confirmation" ? centralConfirmation : null;
  states[3] = action === "group"; states[9] = action === "ungrouped";
  states[12] = 1;
  const mutation = async (name: string) => {
    calls.push(name);
    if (offlineFailure) throw new Error("การตั้งค่าบิลยางใช้ได้เมื่อออนไลน์เท่านั้น");
    if (onlineFailure) throw new Error("บันทึกไม่สำเร็จ");
    await held;
  };
  const jsx = (type: unknown, props: { onSubmit?: (event: { preventDefault: () => void }) => unknown; onConfirm?: () => void; onChange?: (value: boolean) => void }) => {
    if (type === "form" && props.onSubmit) invoke = () => { void props.onSubmit!({ preventDefault: noop }); };
    if (type === alert && action === "confirmation") invoke = props.onConfirm!;
    if (type === toggle && action === "toggle") invoke = () => props.onChange!(false);
    if (type === lock && action === "lock") invoke = () => props.onChange!(true);
    return {};
  };
  const module = loadSourceModule<typeof import("../src/components/rubber-bills/RubberApprovalPolicyPanel")>("src/components/rubber-bills/RubberApprovalPolicyPanel.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useRef: (initial: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }),
      useState: (initial: unknown) => { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], (value: unknown) => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
    },
    sonner: { toast: { success: noop, info: noop, error: (message: string) => errors.push(message) } },
    "@/components/shared/AlertDialog": { AlertDialog: alert },
    "@/components/rubber-bills/RubberApprovalSystemSettings": { RubberApprovalSystemSettings: noop },
    "@/components/rubber-bills/RubberAutoResetLockControl": { RubberAutoResetToggleControl: toggle, RubberAutoResetLockControl: lock },
    "@/hooks/useOnlineStatus": { useOnlineStatus: () => !offlineFailure },
    "@/lib/connectivity": { getConnectivitySnapshot: () => !offlineFailure },
    "@/hooks/useRubberApprovalGroups": {
      RubberMaxPriceAllowanceError: class extends Error {},
      useRubberApprovalGroups: () => ({
        centralPrice: { value: 42, revision: 1, updatedAt: "2026-10-31T00:00:00.000Z" }, maxPriceAllowance: { value: 10 },
        ungroupedDefaults: { editWindowMinutes: 30, priceAllowance: 1, revision: 1, locationIds: [locationId], updatedAt: "2026-10-31T00:00:00.000Z" },
        groups: [], availableLocationIds: [locationId], isSaving: false,
        createGroup: () => mutation("group"), saveUngroupedDefaults: () => mutation("ungrouped"),
        saveCentralPrice: () => mutation("confirmation"), savePriceAllowanceAutoReset: () => mutation("toggle"),
        savePriceAllowanceAutoResetLock: () => mutation("lock"),
        refetch: async () => { refreshes++; await held; return {}; },
      }),
    },
  }, { requestAnimationFrame: noop });
  const render = () => {
    stateIndex = 0; refIndex = 0;
    module.RubberApprovalPolicyPanel({ locations: [{ id: locationId, name: "Branch", active: true, code: "T" }], locationsLoading: false, locationsError: null, dateRule: null });
  };
  render();
  return { invoke: () => invoke(), render, calls, errors, refreshes: () => refreshes, release };
}

for (const action of ["group", "ungrouped", "confirmation", "toggle", "lock"] as const) {
  test(`${action} ignores duplicate submissions before mutation state rerenders`, async () => {
    const form = panel(action);
    try {
      form.invoke(); form.invoke();
      expect(form.calls).toEqual([action]);
      form.render(); form.invoke();
      expect(form.calls).toEqual([action]);
    } finally { form.release(); await new Promise(resolve => setTimeout(resolve, 0)); }
  });
  test(`${action} reports an offline save failure without awaiting a paused read`, async () => {
    const form = panel(action, true);
    try {
      form.invoke();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(form.errors).toEqual(["การตั้งค่าบิลยางใช้ได้เมื่อออนไลน์เท่านั้น"]);
      expect(form.refreshes()).toBe(0);
    } finally { form.release(); await new Promise(resolve => setTimeout(resolve, 0)); }
  });
}

test("a completed settings action releases its immediate lock for the next action", async () => {
  const form = panel("toggle");
  form.invoke(); form.release();
  await new Promise(resolve => setTimeout(resolve, 0));
  form.render(); form.invoke();
  expect(form.calls).toEqual(["toggle", "toggle"]);
});

test("online failures still refresh authoritative data before reporting the error", async () => {
  const form = panel("confirmation", false, true);
  form.invoke();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(form.refreshes()).toBe(1);
  expect(form.errors).toEqual([]);
  form.release();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(form.errors).toEqual(["บันทึกไม่สำเร็จ"]);
});

test("an offline failure releases its lock for a deliberate retry", async () => {
  const form = panel("toggle", true);
  try {
    form.invoke();
    await new Promise(resolve => setTimeout(resolve, 0));
    form.render(); form.invoke();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(form.calls).toEqual(["toggle", "toggle"]);
    expect(form.errors).toHaveLength(2);
  } finally { form.release(); await new Promise(resolve => setTimeout(resolve, 0)); }
});
