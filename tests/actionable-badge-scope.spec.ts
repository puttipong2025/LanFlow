import { expect, test } from "@playwright/test";
import { QueryClient, QueryObserver, type FetchQueryOptions } from "@tanstack/react-query";
import { loadSourceModule } from "./helpers/load-source-module";

type Result = { counts: Record<string, Record<string, number>> };
const location = "bc100000-0000-4000-8000-000000000010";

function scopeProbe(holdFirst = false) {
  let actor = "actor-a";
  let reads = 0;
  const signals: AbortSignal[] = [];
  let releaseFirst = () => {};
  const first = new Promise<void>(resolve => { releaseFirst = resolve; });
  // Capture the actual production query options without mounting a React tree.
  // The hook result is irrelevant here; useQuery receives the real key/queryFn.
  const captured: (FetchQueryOptions<Result> & { enabled: boolean })[] = [];
  const capture = loadSourceModule<Record<string, (...args: unknown[]) => unknown>>(
    "src/hooks/useActionableBadges.ts", {
      "@tanstack/react-query": { useQuery: (options: FetchQueryOptions<Result> & { enabled: boolean }) => {
        captured.push(options); return { data: undefined, isError: false };
      } },
      "@/lib/supabase/client": { createSupabaseBrowserClient: () => ({
        auth: { getSession: async () => ({ data: { session: { user: { id: actor } } }, error: null }) },
        rpc: (name: string) => ({ abortSignal: async (signal: AbortSignal) => {
          signals.push(signal);
          if (name !== "get_actionable_badge_counts") return { data: {}, error: null };
          const owner = actor;
          reads++;
          if (holdFirst && owner === "actor-a") await first;
          return { data: [{ location_id: location, module_id: "cash", item_count: owner === "actor-a" ? 9 : 1 }], error: null };
        } }),
      }) },
    },
  );
  return {
    capture(owner: string) {
      actor = owner;
      capture.useActionableBadges(owner, true);
      return captured.at(-1)!;
    },
    releaseFirst, reads: () => reads, signals, setActor: (owner: string) => { actor = owner; },
  };
}

test("a fresh badge cache cannot cross accounts sharing a branch", async () => {
  const probe = scopeProbe();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  try {
    expect((await client.fetchQuery(probe.capture("actor-a"))).counts[location].cash).toBe(9);
    expect((await client.fetchQuery(probe.capture("actor-a"))).counts[location].cash).toBe(9);
    expect(probe.reads()).toBe(1);
    expect((await client.fetchQuery(probe.capture("actor-b"))).counts[location].cash).toBe(1);
    expect(probe.reads()).toBe(2);
  } finally { client.clear(); }
});

test("missing identity disables automatic reads and rejects manual reads before network access", async () => {
  const probe = scopeProbe();
  const options = probe.capture("");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  try {
    expect(options.enabled).toBe(false);
    await expect(client.fetchQuery(options)).rejects.toThrow("ไม่พบบัญชี");
    expect(probe.reads()).toBe(0);
  } finally { client.clear(); }
});

test("switching an active observer cancels both old-account requests", async () => {
  const probe = scopeProbe(true);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const previous = probe.capture("actor-a");
  const observer = new QueryObserver(client, previous);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await expect.poll(() => probe.signals.length).toBe(2);
    const oldSignals = [...probe.signals];
    expect(oldSignals).toHaveLength(2);
    const current = probe.capture("actor-b");
    observer.setOptions(current);
    expect(oldSignals.every(signal => signal.aborted)).toBe(true);
    expect((await client.fetchQuery(current)).counts[location].cash).toBe(1);
    probe.releaseFirst();
    expect(client.getQueryData(previous.queryKey)).toBeUndefined();
  } finally { probe.releaseFirst(); unsubscribe(); observer.destroy(); client.clear(); }
});

test("an old account in-flight response cannot populate the new account badges", async () => {
  const probe = scopeProbe(true);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  try {
    const old = client.fetchQuery(probe.capture("actor-a"));
    const rejected = expect(old).rejects.toThrow("บัญชี");
    const current = client.fetchQuery(probe.capture("actor-b"));
    probe.releaseFirst();
    const [, next] = await Promise.all([rejected, current]);
    expect(next.counts[location].cash).toBe(1);
  } finally { probe.releaseFirst(); client.clear(); }
});

test("a session switch while the profile is still old cannot poison its cache", async () => {
  const probe = scopeProbe();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  try {
    const options = probe.capture("actor-a");
    probe.setActor("actor-b");
    await expect(client.fetchQuery(options)).rejects.toThrow("บัญชี");
    expect(probe.reads()).toBe(0);
    expect((await client.fetchQuery(probe.capture("actor-a"))).counts[location].cash).toBe(9);
  } finally { client.clear(); }
});

test("a session that changes during an RPC cannot cache that result under the old owner", async () => {
  const probe = scopeProbe(true);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  try {
    const options = probe.capture("actor-a");
    const pending = client.fetchQuery(options);
    const rejected = expect(pending).rejects.toThrow("บัญชี");
    await expect.poll(probe.reads).toBe(1);
    probe.setActor("actor-b");
    probe.releaseFirst();
    await rejected;
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
  } finally { probe.releaseFirst(); client.clear(); }
});
