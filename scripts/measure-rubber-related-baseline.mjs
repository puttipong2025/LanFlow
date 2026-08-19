import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [
  "node_modules/@playwright/test/cli.js",
  "test",
  "tests/rubber-bill-feed-api.spec.ts",
  "tests/rubber-evidence-loading.spec.ts",
  "tests/reports/report-pagination-contract.spec.ts",
  "--reporter=line",
]);

const paritySql = readFileSync("tests/sql/rubber_evidence_projection_parity.sql", "utf8");
run("docker", [
  "exec", "-i", "supabase_db_webapp", "psql", "-U", "postgres", "-d", "postgres",
  "-X", "-v", "ON_ERROR_STOP=1",
], { input: paritySql, stdio: ["pipe", "inherit", "inherit"] });
