import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const RESET_TEST_CONTAINER = "supabase_db_lanflow-bill-reset-test";
export const RESET_TEST_URL = "http://127.0.0.1:55431";
export function resetTestEnvironment() {
  const status = JSON.parse(readFileSync(join(tmpdir(), "lanflow-bill-reset-integration", "status.json"), "utf8").replace(/^\uFEFF/, ""));
  if (status.API_URL !== RESET_TEST_URL || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
    throw new Error("Bulk reset tests require the dedicated lanflow-bill-reset-test instance on port 55431");
  }
  return { url: RESET_TEST_URL, anonKey: String(status.ANON_KEY), serviceKey: String(status.SERVICE_ROLE_KEY) };
}
export function resetTestSql(statement: string) {
  // No environment override: the ordinary Local database cannot be targeted.
  return execFileSync("docker", ["exec", RESET_TEST_CONTAINER, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1",
    "-U", "postgres", "-d", "postgres", "-c", statement], { encoding: "utf8", windowsHide: true }).trim();
}
export function restoreResetSeedActor() {
  resetTestSql(`update public.profiles set role='admin' where role='super_admin';
    insert into auth.users(id,aud,role) values('00000000-0000-4000-8000-000000000001','authenticated','authenticated') on conflict(id) do nothing;
    update public.profiles set role='super_admin',is_active=true where id='00000000-0000-4000-8000-000000000001';`);
}
