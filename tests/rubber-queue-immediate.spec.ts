import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";

type Worker = typeof import("../src/lib/server/rubber-queue-immediate");
function worker(env: Record<string, string>, before: () => Promise<void> = async () => {}) {
  const calls: { query: string; values?: string[] }[] = [];
  let connections = 0;
  const handlers = loadSourceModule<Worker>("src/lib/server/rubber-queue-immediate.ts", {
    "server-only": {},
    postgres: { default: () => { connections++; return { begin: async (run: (tx: { unsafe: (query: string, values?: string[]) => Promise<unknown> }) => Promise<boolean>) => {
      await before(); return run({ unsafe: async (query, values) => {
      calls.push({ query, values }); return [{ processed: 1 }];
    } }); } }; } },
  }, { process: { env } });
  return { ...handlers, calls, connections: () => connections };
}
const local = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55421", RUBBER_QUEUE_DATABASE_URL: "postgres://postgres:fixture@127.0.0.1:55422/postgres" };

test("missing, malformed and wrong-project configuration leaves work for cron without connecting", async () => {
  for (const env of [{}, { ...local, RUBBER_QUEUE_DATABASE_URL: "broken" },
    { ...local, RUBBER_QUEUE_DATABASE_URL: "postgres://postgres:fixture@db.other.supabase.co/postgres" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://one.supabase.co", RUBBER_QUEUE_DATABASE_URL: "postgres://postgres.two:fixture@aws.pooler.supabase.com/postgres" }]) {
    const instance = worker(env);
    expect(await instance.processRubberQueueImmediately("branch")).toBe(false);
    expect(instance.connections()).toBe(0);
  }
});

test("a bounded single attempt installs deadlines first and binds only the authenticated branch", async () => {
  const instance = worker(local);
  expect(await instance.processRubberQueueImmediately("branch")).toBe(true);
  expect(instance.calls.map(call => call.query)).toEqual([
    "select set_config('statement_timeout','2s',true),set_config('lock_timeout','250ms',true)",
    "select private.process_rubber_queue_batch(1,$1::uuid) as processed",
  ]);
  expect(instance.calls[1].values).toEqual(["branch"]);
});

test("concurrent acceleration skips rather than adding a memory backlog and recovers after failure", async () => {
  let release!: () => void;
  let attempts = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  const instance = worker(local, async () => { attempts++; if (attempts === 1) { await held; throw new Error("connection failed"); } });
  const first = instance.processRubberQueueImmediately("branch");
  expect(await instance.processRubberQueueImmediately("other")).toBe(false);
  release();
  expect(await first).toBe(false);
  expect(await instance.processRubberQueueImmediately("branch")).toBe(true);
  expect(attempts).toBe(2);
  expect(instance.connections()).toBe(1);
});
