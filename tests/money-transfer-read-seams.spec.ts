import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const source = (path: string) => readFileSync(resolve(path), "utf8");

test("Money Transfer module uses paged summary/detail/source seams", () => {
  const module = source("src/components/MoneyTransferModule.tsx");
  const hook = source("src/hooks/useMoneyTransfers.ts");
  const picker = source("src/components/money-transfer/ItemPicker.tsx");
  expect(module).toContain("useMoneyTransferList");
  expect(module).toContain("loadMoneyTransferDetail");
  expect(module).not.toContain("useRubberBills");
  expect(module).not.toContain("useOcrTickets");
  expect(hook).toContain("get_money_transfer_list");
  expect(hook).toContain("get_money_transfer_detail");
  expect(picker).toContain("useMoneyTransferSources");
  expect(picker).not.toContain("usedSourceIds");
});

test("create and update use one atomic RPC while delete and merge keep their atomic contracts", () => {
  const hook = source("src/hooks/useMoneyTransfers.ts");
  const migration = source("supabase/migrations/20260819050000_atomic_money_transfer_save.sql");
  expect(hook).toContain('supabase.rpc("save_money_transfer"');
  expect(hook).not.toContain('.from("money_transfer_slips")');
  expect(hook).not.toContain('.from("money_transfer_items")');
  expect(migration).toContain("MT_REVISION_CONFLICT");
  expect(migration).toContain("MT_SOURCE_ALREADY_USED");
  expect(migration).toContain("for update");
  expect(migration).toContain("on conflict (id) do update");
});

test("legacy Evidence full read paginates parents and children past Data API max_rows", () => {
  const hook = source("src/hooks/useRubberBills.ts");
  expect(hook).toContain(".range(offset, offset + 999)");
  expect(hook).toContain("chunkStart += 100");
  expect(hook).toContain("itemsByBillId");
});
