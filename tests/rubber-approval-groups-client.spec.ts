import { expect, test } from "@playwright/test";
import { MutationObserver, QueryClient, onlineManager } from "@tanstack/react-query";
import { loadSourceModule } from "./helpers/load-source-module";

const locationId = "71000000-0000-4000-8000-000000000021";
const groupId = "71000000-0000-4000-8000-000000000022";
const audit = { updatedByName: "System", updatedByPhone: null, updatedAt: "2026-10-31T00:00:00.000Z" };
const group = { id: groupId, locationIds: [locationId], editWindowMinutes: 30, priceAllowance: 1, priceAllowanceAutoResetLocked: false, revisionNo: 1, ...audit };
const settings = {
  groups: [], availableLocationIds: [locationId],
  centralPrice: { value: 42, revision: 1, ...audit },
  ungroupedDefaults: { locationIds: [locationId], editWindowMinutes: 30, priceAllowance: 1, priceAllowanceAutoResetLocked: false, revision: 1, ...audit },
  maxPriceAllowance: { value: 10, ...audit }, priceAllowanceAutoResetEnabled: false,
  canEditMaxPriceAllowance: true, canEditPriceAllowanceAutoReset: true,
};
const cases = [
  { name: "create", input: { locationIds: [locationId], editWindowMinutes: 30, priceAllowance: 1 }, valid: { group, affectedLocationIds: [locationId] } },
  { name: "update", input: { id: groupId, revisionNo: 1, sourceGroupRevisions: {}, locationIds: [locationId], editWindowMinutes: 30, priceAllowance: 1 }, valid: { group: { ...group, revisionNo: 2 }, affectedLocationIds: [locationId] } },
  { name: "delete", input: { id: groupId, revisionNo: 1, locationIds: [locationId] }, valid: { success: true, releasedLocationIds: [locationId] } },
  { name: "central", input: { centralPrice: 43, expectedRevision: 1 }, valid: { ...settings, centralPrice: { ...settings.centralPrice, value: 43, revision: 2 } } },
  { name: "ungrouped", input: { editWindowMinutes: 31, priceAllowance: 2, expectedRevision: 1 }, valid: { ...settings, ungroupedDefaults: { ...settings.ungroupedDefaults, editWindowMinutes: 31, priceAllowance: 2, revision: 2 } } },
  { name: "maximum", input: { maxPriceAllowance: 11, expectedMaxPriceAllowance: 10 }, valid: { status: "saved", setting: { value: 11, ...audit } } },
  { name: "auto reset", input: { enabled: true, expectedEnabled: false }, valid: { status: "saved", enabled: true } },
  { name: "reset lock", input: { scope: "group", groupId, locked: true, expectedLocked: false }, valid: { status: "saved", scope: "group", groupId, locked: true } },
] as const;
type Mutation = { mutationFn: (input: unknown) => Promise<unknown>; networkMode?: "always" | "online" | "offlineFirst" };

function load(response: () => Response, online = true) {
  const mutations: Mutation[] = [];
  let query: () => Promise<unknown> = async () => undefined;
  let requests = 0;
  const module = loadSourceModule<typeof import("../src/hooks/useRubberApprovalGroups")>("src/hooks/useRubberApprovalGroups.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => ({ invalidateQueries: async () => {}, setQueryData: () => {} }),
      useQuery: (options: { queryFn: typeof query }) => { query = options.queryFn; return {}; },
      useMutation: (options: Mutation) => { mutations.push(options); return {}; },
    },
    "@/lib/auth-fetch": { authFetch: async () => { requests++; return response(); } },
    "@/lib/connectivity": { getConnectivitySnapshot: () => online },
    "@/hooks/useRubberBillApprovals": { RUBBER_BILL_APPROVAL_SETTINGS_KEY: "settings" },
  });
  module.useRubberApprovalGroups();
  return { mutations, query: async () => query(), requests: () => requests };
}

async function invoke(mutation: Mutation, input: unknown) { return mutation.mutationFn(input); }

cases.forEach((entry, index) => {
  test(`${entry.name} rejects an empty successful response`, async () => {
    const loaded = load(() => Response.json({}));
    await expect(invoke(loaded.mutations[index], entry.input)).rejects.toThrow("รูปแบบ");
  });
  test(`${entry.name} preserves a friendly error for HTTP 503 null`, async () => {
    const loaded = load(() => Response.json(null, { status: 503 }));
    await expect(invoke(loaded.mutations[index], entry.input)).rejects.toThrow("ไม่สำเร็จ");
  });
  test(`${entry.name} accepts its valid acknowledgement`, async () => {
    const loaded = load(() => Response.json(entry.valid));
    await expect(invoke(loaded.mutations[index], entry.input)).resolves.toEqual(entry.valid);
  });
  test(`${entry.name} fails immediately offline rather than resuming a settings write later`, async () => {
    const loaded = load(() => Response.json(entry.valid), false);
    const client = new QueryClient();
    onlineManager.setOnline(false);
    const observer = new MutationObserver(client, { mutationFn: loaded.mutations[index].mutationFn, networkMode: loaded.mutations[index].networkMode });
    const result = observer.mutate(entry.input).catch(error => error);
    try {
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(observer.getCurrentResult().isPaused).toBe(false);
      expect(await result).toBeInstanceOf(Error);
      expect(loaded.requests()).toBe(0);
    } finally {
      onlineManager.setOnline(true);
      await client.resumePausedMutations();
      await result;
      client.clear();
    }
  });
});

test("the group query rejects malformed 200 JSON", async () => {
  await expect(load(() => Response.json({ groups: {}, ...{ centralPrice: { value: 42 } } })).query()).rejects.toThrow("รูปแบบ");
});
test("the group query accepts complete settings", async () => {
  await expect(load(() => Response.json(settings)).query()).resolves.toEqual(settings);
});
test("the group query uses a friendly error for a null failure", async () => {
  await expect(load(() => Response.json(null, { status: 503 })).query()).rejects.toThrow("ไม่สำเร็จ");
});
