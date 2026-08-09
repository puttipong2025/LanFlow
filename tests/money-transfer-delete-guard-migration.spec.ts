import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260809040000_harden_atomic_money_transfer_delete_context.sql",
);

test("the atomic-delete guard requires an exact private transaction context", () => {
  const migration = readFileSync(migrationPath, "utf8");

  expect(migration).toContain("private.money_transfer_delete_context");
  expect(migration).toContain("pg_catalog.pg_backend_pid()");
  expect(migration).toContain("pg_catalog.txid_current()");
  expect(migration).toContain("c.transfer_id = new.id");
  expect(migration).not.toContain("app.money_transfer_delete_rpc");
  expect(migration).not.toContain("current_user");
});
