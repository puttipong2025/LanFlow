import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

type Options = {
  enabled?: boolean;
  queryKey: readonly unknown[];
  queryFn: (context: { signal: AbortSignal; pageParam?: string | null }) => Promise<unknown>;
  refetchInterval: false | number | ((query: { state: { status: string; data?: unknown } }) => number | false);
};

function captureHook(file: string, online = true, payload: unknown = { transfers: [], total: 0 }, client?: QueryClient) {
  const queries: Options[] = [];
  const mutations: { onSuccess?: (data: unknown) => Promise<void> }[] = [];
  const invalidated: unknown[] = [];
  const module = loadSourceModule<Record<string, (...args: unknown[]) => unknown>>(file, {
    "@tanstack/react-query": {
      useQuery: (options: Options) => { queries.push(options); return { data: undefined, isError: false }; },
      useInfiniteQuery: (options: Options) => { queries.push(options); return { data: undefined }; },
      useMutation: (options: { onSuccess?: (data: unknown) => Promise<void> }) => { mutations.push(options); return {}; },
      useQueryClient: () => client ?? ({
        invalidateQueries: async (key: unknown) => { invalidated.push(key); },
        setQueryData: () => {},
      }),
    },
    "@/hooks/useOnlineStatus": { useOnlineStatus: () => online },
    "@/components/AuthProvider": { useAuthContext: () => ({ profile: { id: "owner" } }) },
    "@/lib/permissions": { canManageSystemFeatures: () => true },
    "@/lib/auth-fetch": {
      authFetch: async () => Response.json(payload),
      assertApiResponse: async () => {},
    },
    "@/hooks/useActionableBadges": { ACTIONABLE_BADGES_QUERY_KEY: "actionableBadges" },
    "@/hooks/useRubberBillApprovals": { RUBBER_BILL_APPROVAL_SETTINGS_KEY: "settings" },
    "@/hooks/useRubberBillEvidenceReview": { mapRubberBillEvidenceState: () => ({}) },
  });
  return { module, queries, mutations, invalidated };
}

function interval(options: Options, status: string, data?: unknown) {
  const value = options.refetchInterval;
  return typeof value === "function" ? value({ state: { status, data } }) : value;
}

test("cash uses total, slows errors with cached work, and respects offline/scope guards", () => {
  const { module, queries } = captureHook("src/hooks/useCashBranchTransfers.ts", false);
  module.useCashBranchTransfers("owner", "branch");
  expect(queries[0].enabled).toBe(false);
  expect(interval(queries[0], "pending")).toBe(60_000);
  expect(interval(queries[0], "success", { total: 21, transfers: [] })).toBe(15_000);
  expect(interval(queries[0], "success", { total: 0 })).toBe(60_000);
  expect(interval(queries[0], "error", { total: 21 })).toBe(60_000);
});

for (const queryKey of [
  ["actionableBadges", "owner"],
  ["incomeExpenseFeed", "owner", "branch", "operational", "latest", ""],
  ["incomeExpenseFeed", "owner", "other-branch", "operational", "latest", ""],
]) {
test(`cash mutations refresh active ${queryKey.join(":")} only once`, async () => {
  for (let index = 0; index < 4; index++) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    client.setQueryData(queryKey, {});
    let reads = 0;
    const observer = new QueryObserver(client, {
      queryKey,
      staleTime: Infinity,
      queryFn: async () => {
        reads++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {};
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      const { module, mutations } = captureHook("src/hooks/useCashBranchTransfers.ts", true, undefined, client);
      module.useCashBranchTransfers("owner", "branch");
      expect(mutations).toHaveLength(4);
      await mutations[index].onSuccess?.({});
      expect(reads).toBe(1);
    } finally {
      unsubscribe();
      observer.destroy();
      client.clear();
    }
  }
});
}

test("malformed cash summary fails rather than becoming an empty queue", async () => {
  for (const payload of [{}, { transfers: [], total: -1 }, { transfers: [], total: 1 }, { transfers: [{}], total: 1 }]) {
    const { module, queries } = captureHook("src/hooks/useCashBranchTransfers.ts", true, payload);
    module.useCashBranchTransfers("owner", "branch");
    const message = await queries[0].queryFn({ signal: new AbortController().signal }).then(() => "unexpected success", (error: Error) => error.message);
    expect(message).toContain("รูปแบบคิว");
  }
});

test("cash refresh replaces an older in-flight feed for another branch", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const queryKey = ["incomeExpenseFeed", "owner", "other-branch", "operational", "latest", ""];
  client.setQueryData(queryKey, { version: 0 });
  let reads = 0;
  let releaseOld: (() => void) | undefined;
  const observer = new QueryObserver(client, {
    queryKey, staleTime: Infinity,
    queryFn: () => ++reads === 1
      ? new Promise<{ version: number }>((resolve) => { releaseOld = () => resolve({ version: 0 }); })
      : Promise.resolve({ version: 1 }),
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    const oldFetch = observer.refetch();
    const { module, mutations } = captureHook("src/hooks/useCashBranchTransfers.ts", true, undefined, client);
    module.useCashBranchTransfers("owner", "branch");
    const refresh = mutations[0].onSuccess?.({});
    releaseOld?.();
    await Promise.all([oldFetch, refresh]);
    expect(client.getQueryData(queryKey)).toEqual({ version: 1 });
  } finally {
    unsubscribe(); observer.destroy(); client.clear();
  }
});

test("browser schedule depends on pending work, managing, error and ownership", () => {
  const { module, queries } = captureHook("src/hooks/useBrowserApprovals.ts");
  module.useBrowserApprovals();
  expect(interval(queries[0], "success", [])).toBe(60_000);
  expect(interval(queries[0], "success", [{ pending: [{}] }])).toBe(15_000);
  expect(interval(queries[0], "error", [{ pending: [{}] }])).toBe(60_000);
  module.useBrowserApprovals(true, true);
  expect(interval(queries[1], "success", [])).toBe(15_000);
  module.useBrowserApprovals(false);
  expect(interval(queries[2], "success", [{ pending: [{}] }])).toBe(false);
});

test("browser query rejects malformed successful JSON before it poisons polling and badges", async () => {
  for (const payload of [null, { users: {} }, { users: [{ pending: null }] }]) {
    const { module, queries } = captureHook("src/hooks/useBrowserApprovals.ts", true, payload);
    module.useBrowserApprovals();
    const result = await queries[0].queryFn({ signal: new AbortController().signal }).then(() => "unexpected success", () => "error");
    expect(result).toBe("error");
  }
});

test("history feed is manual while pending keeps its existing timer", async () => {
  const { module, queries } = captureHook("src/hooks/useRubberEvidenceFeed.ts", true, { rows: [], hasMore: false });
  module.useRubberEvidenceFeed({ ownerUserId: "owner", locationId: "branch", view: "history", search: "", billId: null });
  expect(interval(queries[0], "success")).toBe(false);
  expect(await queries[0].queryFn({ signal: new AbortController().signal })).toMatchObject({ cards: [], hasMore: false });
  module.useRubberEvidenceFeed({ ownerUserId: "owner", locationId: "branch", view: "pending", search: "", billId: null });
  expect(interval(queries[1], "success")).toBe(60_000);
});

test("reset toggles and locks refresh management state without periodic polling", async () => {
  const { module, queries, mutations, invalidated } = captureHook("src/hooks/useRubberApprovalGroups.ts");
  module.useRubberApprovalGroups();
  expect(interval(queries[0], "success")).toBe(false);
  for (const index of [6, 7]) {
    invalidated.length = 0;
    await mutations[index].onSuccess?.({ enabled: true, scope: "ungrouped", locked: true });
    expect(invalidated).toEqual([{ queryKey: ["rubberApprovalGroups"] }]);
  }
});
