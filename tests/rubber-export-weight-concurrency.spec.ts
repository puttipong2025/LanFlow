import { expect, test } from "@playwright/test";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const container = "supabase_db_webapp";
const actor = "a1010000-0000-4000-8000-000000000001";
const branch = "a1020000-0000-4000-8000-000000000001";
const exportId = "a1030000-0000-4000-8000-000000000008";
const auth = `select set_config('request.jwt.claim.sub','${actor}',true);`;
const psql = (db: string) => ["exec", "-i", container, "psql", "-X", "-q", "-At", "-U", "supabase_admin", "-d", db,
  "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const sql = (db: string, query: string) => execFileSync("docker", [...psql(db), "-c", query], { encoding: "utf8" }).trim();

function session(db: string) {
  const child = spawn("docker", psql(db));
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
  child.stdin.write(`begin; set statement_timeout='5s'; set deadlock_timeout='100ms'; ${auth}\n`);
  return {
    send: (query: string) => child.stdin.write(query + "\n"),
    finish: (query: string) => child.stdin.end(query + "\n"), done,
    wait: async (marker: string) => {
      const deadline = Date.now() + 5000;
      while (!stdout.includes(marker)) {
        if (Date.now() > deadline) throw new Error(`Lock barrier not reached: ${stderr}`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    },
  };
}

test("weight contention cannot deadlock a concurrent sale and succeeds after release", async () => {
  test.setTimeout(60_000);
  // Clone schema only: concurrency fixtures and their cleanup never touch application data.
  const db = `rex_weight_test_${crypto.randomUUID().replaceAll("-", "")}`;
  let created = false;
  try {
    execFileSync("docker", ["exec", container, "createdb", "-U", "postgres", db]); created = true;
    const schema = execFileSync("docker", ["exec", container, "pg_dump", "-U", "postgres", "-d", "postgres",
      "--schema-only", "--no-owner", "--no-privileges", "--exclude-extension=pg_cron", "--exclude-extension=pg_net"],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    const restored = spawnSync("docker", psql(db), { input: schema, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    expect(restored.status, restored.stderr).toBe(0);
    const fixture = readFileSync("supabase/tests/rubber_export_weight_adjustment_test.sql", "utf8");
    const seeded = spawnSync("docker", psql(db), {
      input: fixture.slice(0, fixture.indexOf("set constraints all immediate;")) + "\nset constraints all immediate; commit;",
      encoding: "utf8",
    });
    expect(seeded.status, seeded.stderr).toBe(0);
    const adjust = `select public.adjust_rubber_export_weight('${exportId}',80,90,null);`;
    expect(sql(db, `begin; ${auth} ${adjust} rollback;`)).toContain('"currentWeight": 80');
    const sale = session(db), weight = session(db);
    sale.send(`select id from public.rubber_exports where id='${exportId}' for update; select 'SALE_LOCKED';`);
    await sale.wait("SALE_LOCKED");
    weight.send(`select pg_advisory_xact_lock(hashtextextended('${branch}',0)); select 'WEIGHT_LOCKED';`);
    await weight.wait("WEIGHT_LOCKED");
    weight.finish(`${adjust} rollback;`);
    sale.finish(`select public.set_rubber_export_sold_out('${exportId}',true); rollback;`);
    const [saleResult, weightResult] = await Promise.all([sale.done, weight.done]);
    expect(saleResult.code, saleResult.stderr).toBe(0);
    expect(weightResult.code).not.toBe(0);
    expect(weightResult.stderr).toContain("RUBBER_EXPORT_WEIGHT_CONFLICT:");
    expect(saleResult.stderr + weightResult.stderr).not.toContain("40P01");
    expect(sql(db, `select current_weight=90 and sold_out_at is null from public.rubber_exports where id='${exportId}'`)).toBe("t");
    expect(sql(db, `select count(*) from public.rubber_export_weight_adjustments where export_id='${exportId}'`)).toBe("0");
    expect(sql(db, `begin; ${auth} ${adjust} rollback;`)).toContain('"currentWeight": 80');
  } finally {
    if (created) {
      if (!/^rex_weight_test_[a-f0-9]{32}$/.test(db)) throw new Error("Unexpected disposable database name");
      sql("postgres", `select pg_terminate_backend(pid) from pg_stat_activity where datname='${db}'`);
      execFileSync("docker", ["exec", container, "dropdb", "-U", "postgres", db]);
    }
  }
});
