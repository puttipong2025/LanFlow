import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";
import type { RubberExportDetails, RubberExportEditValues } from "../src/types/rubber-exports";

const details: RubberExportDetails = {
  id: "a1030000-0000-4000-8000-000000000001", exportNo: "REX-SAVE", locationId: "branch", locationName: "Test",
  status: "verified", originalWeightTotal: 1000, currentWeight: 1000, weightLossPercent: 0,
  paidTotal: 10000, rubberValueTotal: 10000, averagePrice: 10, workRate: 0.3, otherOperatingCost: 0, workTotal: 300,
  expenseDestination: "external", createdByName: "Test", createdAt: "2026-11-02T01:00:00Z", verifiedAt: "2026-11-02T02:00:00Z",
  itemCount: 0, items: [], ageCalculatedAt: null, averageAgeHours: null, oldestAgeHours: null, estimatedAgeItemCount: null,
};
const values: RubberExportEditValues = { currentWeight: 900, workRate: 0.3, otherOperatingCost: 0,
  adjustment: { expectedCurrentWeight: 1000, note: "" } };
function harness(options: { writeFails?: boolean; readFails?: boolean; refreshFailed?: boolean; signal?: AbortSignal; canonicalWeight?: number;
  pendingWrite?: Promise<void>; pendingRead?: Promise<void> } = {}) {
  const states: RubberExportDetails[] = [], messages: { kind: string; message: string }[] = [];
  let reads = 0, writes = 0;
  const { saveRubberExportDetails } = loadSourceModule<typeof import("../src/components/rubber-exports/save-rubber-export-details")>(
    "src/components/rubber-exports/save-rubber-export-details.ts", {
      sonner: { toast: Object.fromEntries(["success", "warning", "error"].map(kind => [kind, (message: string) => messages.push({ kind, message })])) },
    });
  const api = {
    update: async () => { writes++; await options.pendingWrite; if (options.writeFails) throw new Error("denied"); return { refreshFailed: options.refreshFailed ?? false }; },
    details: async () => { reads++; await options.pendingRead; if (options.readFails) throw new Error("read unavailable");
      const weight = options.canonicalWeight ?? 900; return { ...details, currentWeight: weight, weightLossPercent: (1000 - weight) / 10 }; },
  };
  return { states, messages, reads: () => reads, writes: () => writes,
    save: (source = details, input = values) => saveRubberExportDetails(api, source, input, next => states.push(next), options.signal) };
}

test("acknowledged weight remains visible when its follow-up read fails", async () => {
  const h = harness({ readFails: true }); await h.save();
  expect(h.states).toEqual([{ ...details, currentWeight: 900, weightLossPercent: 10 }]);
  expect(h.messages).toEqual([{ kind: "warning", message: "บันทึกน้ำหนักแล้ว แต่โหลดข้อมูลล่าสุดได้ไม่ครบ กรุณารีเฟรช" }]);
});
test("a write rejection never applies an optimistic value or attempts a read", async () => {
  const h = harness({ writeFails: true }); await expect(Promise.resolve(h.save())).rejects.toThrow("denied");
  expect(h.states).toHaveLength(0); expect(h.reads()).toBe(0); expect(h.messages.map(item => item.kind)).toEqual(["error"]);
});
test("a successful read replaces optimistic state with canonical details", async () => {
  const h = harness(); await h.save(); expect(h.states).toHaveLength(2);
  expect(h.states[1]).toEqual({ ...details, currentWeight: 900, weightLossPercent: 10 });
  expect(h.messages.map(item => item.kind)).toEqual(["success"]);
});
test("a newer canonical correction is forwarded unchanged to the details consumer", async () => {
  const h = harness({ canonicalWeight: 800 }); await h.save();
  expect(h.states.map(state => state.currentWeight)).toEqual([900, 800]);
  expect(h.states[1].weightLossPercent).toBe(20);
});
test("list refresh failures warn while keeping acknowledged data", async () => {
  const h = harness({ refreshFailed: true }); await h.save();
  expect(h.states[1].workTotal).toBe(300); expect(h.states[1].verifiedAt).toBe(details.verifiedAt);
  expect(h.messages.map(item => item.kind)).toEqual(["warning"]);
});
test("draft read failures retain the original draft workflow", async () => {
  const h = harness({ readFails: true });
  await expect(Promise.resolve(h.save({ ...details, status: "draft" }, { currentWeight: 900, workRate: 0.3, otherOperatingCost: 0 }))).rejects.toThrow("read unavailable");
  expect(h.states).toHaveLength(0); expect(h.messages.map(item => item.kind)).toEqual(["error"]);
});

test("an abandoned detail session cannot receive a late acknowledged save", async () => {
  let release!: () => void;
  const pendingWrite = new Promise<void>(resolve => { release = resolve; });
  const controller = new AbortController();
  const h = harness({ pendingWrite, signal: controller.signal });
  const pending = h.save(); controller.abort(); release(); await pending;
  expect(h.states).toHaveLength(0); expect(h.reads()).toBe(0); expect(h.messages).toHaveLength(0);
  expect(h.writes()).toBe(1);
});
test("an already closed detail session cannot initiate a write", async () => {
  const controller = new AbortController(); controller.abort();
  const h = harness({ signal: controller.signal }); await h.save();
  expect(h.writes()).toBe(0); expect(h.states).toHaveLength(0); expect(h.messages).toHaveLength(0);
});
test("a detail read completing after close cannot replace the newly opened view", async () => {
  let release!: () => void;
  const pendingRead = new Promise<void>(resolve => { release = resolve; });
  const controller = new AbortController();
  const h = harness({ pendingRead, signal: controller.signal });
  const pending = h.save(); await expect.poll(h.reads).toBe(1);
  expect(h.states).toHaveLength(1);
  controller.abort(); release(); await pending;
  expect(h.states).toHaveLength(1); expect(h.messages).toHaveLength(0);
});

for (const failure of ["list", "cache"] as const) {
  test(`post-commit ${failure} failure cannot reject the weight mutation`, async () => {
    const writes: unknown[] = [];
    const { useRubberExports } = loadSourceModule<typeof import("../src/hooks/useRubberExports")>("src/hooks/useRubberExports.ts", {
      react: { useRef: (current: unknown) => ({ current }), useState: (value: unknown) => [value, () => {}],
        useCallback: (fn: unknown) => fn, useEffect: () => {} },
      "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => { if (failure === "cache") throw new Error("offline"); } }) },
      "@/hooks/useActionableBadges": { ACTIONABLE_BADGES_QUERY_KEY: "badges" },
      "@/lib/auth-fetch": {
        authFetch: async (_url: string, init?: RequestInit) => {
          if (init?.method === "PATCH") { writes.push(JSON.parse(String(init.body))); return Response.json({ id: details.id }); }
          return failure === "list" ? Response.json({}, { status: 503 }) : Response.json({ exports: [], permissions: {} });
        },
        assertApiResponse: async (response: Response) => { if (!response.ok) throw new Error("read unavailable"); },
      },
    });
    const api = useRubberExports("branch", true, "active", "", "all");
    expect(await api.update(details.id, values)).toEqual({ refreshFailed: true });
    expect(writes).toEqual([{ currentWeight: 900, expectedCurrentWeight: 1000, note: "" }]);
  });
}

test("a late committed mutation cannot restart the list query of an abandoned branch", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let branchRef: { current: unknown } | undefined;
  const reads: string[] = [], invalidations: Record<string, unknown>[] = [];
  const { useRubberExports } = loadSourceModule<typeof import("../src/hooks/useRubberExports")>("src/hooks/useRubberExports.ts", {
    react: { useRef: (current: unknown) => { const ref = { current }; if (current === "branch") branchRef = ref; return ref; },
      useState: (value: unknown) => [value, () => {}], useCallback: (fn: unknown) => fn, useEffect: () => {} },
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async (filters: Record<string, unknown>) => { invalidations.push(filters); } }) },
    "@/hooks/useActionableBadges": { ACTIONABLE_BADGES_QUERY_KEY: "badges" },
    "@/lib/auth-fetch": {
      authFetch: async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") { await gate; return Response.json({ id: details.id }); }
        reads.push(url); return Response.json({ exports: [], permissions: {} });
      },
      assertApiResponse: async () => {},
    },
  });
  const api = useRubberExports("branch", true, "active", "", "all");
  const pending = api.update(details.id, values);
  expect(branchRef).toBeDefined(); branchRef!.current = "other-branch"; release(); await pending;
  expect(reads).toHaveLength(0);
  expect(invalidations).toHaveLength(4);
  expect(invalidations.every(filters => filters.refetchType === "none")).toBe(true);
});
