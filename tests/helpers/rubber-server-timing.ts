import postgres from 'postgres';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { loadSourceModule } from './load-source-module';
import { assertSafeIntegrationTarget } from '../support/integration-target';

const now = () => performance.timeOrigin + performance.now();
type Span = { kind: string; startMs: number; endMs: number };
type LockSample = { sampledAtMs: number; waiting: boolean };
type Transaction = { unsafe: (query: string, values?: string[]) => Promise<unknown> };
export type ServerTiming = { commandId?: string; spans: Span[]; locks: LockSample[]; synchronousCommit?: string; commitDispatchedMs?: number; commitAcknowledgedMs?: number };

/** Real production handlers/auth/RPC/driver. Only boundary timing is wrapped. */
export function rubberServerTiming(token: string, injectLock: boolean) {
  assertSafeIntegrationTarget(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const raw = process.env.RUBBER_QUEUE_DATABASE_URL;
  if (!raw || !['127.0.0.1', 'localhost'].includes(new URL(raw).hostname)) throw new Error('Local diagnostic DB connection required');
  const trace: ServerTiming = { spans: [], locks: [] };
  const clients: ReturnType<typeof postgres>[] = [];
  let stopSampling = false;
  let sampling = Promise.resolve();
  let releaseLock = () => {};
  let holding = Promise.resolve();
  const observer = postgres(raw, { max: 1, prepare: false, fetch_types: false, onnotice: () => {} });
  const holder = postgres(raw, { max: 1, prepare: false, fetch_types: false, onnotice: () => {} });
  clients.push(observer, holder);
  const timed = async <T>(kind: string, run: () => Promise<T>): Promise<T> => {
    const startMs = now();
    try { return await run(); } finally { trace.spans.push({ kind, startMs, endMs: now() }); }
  };
  const globals = { process, fetch, setTimeout, clearTimeout, TextEncoder, TextDecoder };
  const actualAuth = loadSourceModule<typeof import('../../src/lib/server/auth')>('src/lib/server/auth.ts', {}, globals);
  const auth = { requireAuth: (request: Request) => timed('auth', async () => {
    const result = await actualAuth.requireAuth(request);
    if (result.ok) result.supabase = new Proxy(result.supabase, { get(target, property, receiver) {
      if (property !== 'rpc') return Reflect.get(target, property, receiver);
      return (name: string, args: Record<string, unknown>) => timed(name, async () => await target.rpc(name, args));
    } });
    return result;
  }) };
  const worker = loadSourceModule<typeof import('../../src/lib/server/rubber-queue-immediate')>('src/lib/server/rubber-queue-immediate.ts', {
    'server-only': {}, postgres: { default: (url: string, options: postgres.Options<{}>) => {
      const sql = postgres(url, { ...options, debug: (_connection, query) => {
        if (query.trim().toLowerCase() === 'commit') trace.commitDispatchedMs = now();
      } });
      clients.push(sql);
      return { begin: async (run: (tx: Transaction) => Promise<boolean>) => {
        const [backend] = await sql.unsafe<{ pid: number; synchronous_commit: string }[]>("select pg_backend_pid() as pid,current_setting('synchronous_commit') as synchronous_commit");
        trace.synchronousCommit = backend.synchronous_commit;
        const result = await sql.begin(async tx => run({ unsafe: async (query, values) => {
          if (!query.includes('private.process_rubber_queue_batch')) return tx.unsafe(query, values);
          if (injectLock) {
            let acquired!: () => void;
            const ready = new Promise<void>(resolve => { acquired = resolve; });
            const gate = new Promise<void>(resolve => { releaseLock = resolve; });
            holding = holder.begin(async held => {
              await held.unsafe('select id from public.locations where id=$1::uuid for update', values);
              acquired(); await gate;
            }).then(() => {});
            await Promise.race([ready, holding]);
          }
          stopSampling = false;
          sampling = (async () => {
            let released = false;
            while (!stopSampling) {
              const [sample] = await observer.unsafe<{ sampledAtMs: string; waiting: boolean }[]>(
                'select extract(epoch from clock_timestamp())*1000 as "sampledAtMs",wait_event_type=\'Lock\' as waiting from pg_stat_activity where pid=$1', [backend.pid]);
              if (sample) {
                trace.locks.push({ sampledAtMs: Number(sample.sampledAtMs), waiting: sample.waiting === true });
                if (sample.waiting && injectLock && !released) { released = true; void delay(70).then(releaseLock); }
              }
              await delay(3);
            }
          })();
          const fallback = setTimeout(releaseLock, 180);
          try { return await timed('worker-statement', async () => await tx.unsafe(query, values)); }
          finally { stopSampling = true; clearTimeout(fallback); releaseLock(); }
        } }));
        trace.commitAcknowledgedMs = now();
        return result;
      } };
    } },
  }, globals);
  const routes = loadSourceModule<typeof import('../../src/app/api/lanflow/rubber-bills/queue/route')>(
    'src/app/api/lanflow/rubber-bills/queue/route.ts', { '@/lib/server/auth': auth, '@/lib/server/rubber-queue-immediate': worker }, globals);
  const context = loadSourceModule<typeof import('../../src/app/api/lanflow/rubber-bills/command-context/route')>(
    'src/app/api/lanflow/rubber-bills/command-context/route.ts', { '@/lib/server/auth': auth }, globals);
  return {
    trace,
    context: (url: string) => context.GET(new Request(url, { headers: { Authorization: `Bearer ${token}` } })),
    post: async (url: string, payload: Record<string, unknown>) => {
      trace.commandId = String(payload.commandId);
      return timed('post-handler', () => routes.POST(new Request(url, { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })));
    },
    close: async () => { stopSampling = true; releaseLock(); await Promise.allSettled([sampling, holding]); await Promise.all(clients.map(client => client.end({ timeout: 2 }))); },
  };
}
