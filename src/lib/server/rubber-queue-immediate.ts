import "server-only";
import postgres from "postgres";

let connection: ReturnType<typeof postgres> | undefined;
let running = false;

function queueConnection() {
  const raw = process.env.RUBBER_QUEUE_DATABASE_URL;
  if (!raw) return undefined;
  const database = new URL(raw);
  const api = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const local = ["127.0.0.1", "localhost"].includes(api.hostname);
  if (!["postgres:", "postgresql:"].includes(database.protocol)) return undefined;
  if (local) {
    if (!["127.0.0.1", "localhost"].includes(database.hostname) || database.port !== "55422") return undefined;
  } else {
    const project = api.hostname.split(".")[0];
    if (!api.hostname.endsWith(".supabase.co") || !(database.hostname === `db.${project}.supabase.co`
      || (database.hostname.endsWith(".pooler.supabase.com") && decodeURIComponent(database.username).endsWith(`.${project}`)))) return undefined;
  }
  connection ??= postgres(raw, { max: 1, prepare: false, fetch_types: false, connect_timeout: 2, idle_timeout: 5,
    ssl: local ? false : { rejectUnauthorized: true, ca: process.env.RUBBER_QUEUE_DATABASE_CA },
    connection: { application_name: "lanflow-rubber-immediate" }, onnotice: () => {} });
  return connection;
}

/** Admission has already committed. Failure leaves that durable command for cron. */
export async function processRubberQueueImmediately(locationId: string): Promise<boolean> {
  if (running) return false; // Bound load; never build an in-memory worker backlog.
  running = true;
  try {
    const sql = queueConnection();
    if (!sql) return false;
    return await sql.begin(async tx => {
      // Separate SQL statement: the timer is installed before the kernel starts.
      await tx.unsafe("select set_config('statement_timeout','2s',true),set_config('lock_timeout','250ms',true)");
      const rows = await tx.unsafe("select private.process_rubber_queue_batch(1,$1::uuid) as processed", [locationId]);
      return Number(rows[0]?.processed) > 0;
    });
  } catch {
    // Do not leak connection strings, SQL diagnostics or customer rows.
    return false;
  } finally { running = false; }
}
