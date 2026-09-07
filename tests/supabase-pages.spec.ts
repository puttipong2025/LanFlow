import { expect, test } from "@playwright/test";

import { readAllSupabaseRows } from "../src/lib/supabase-pages";

test("reads every stable page beyond the Supabase row cap", async () => {
  const source = Array.from({ length: 1_203 }, (_, index) => index);
  const calls: Array<[number, number]> = [];

  const rows = await readAllSupabaseRows(async (from, to) => {
    calls.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  }, 500);

  expect(rows).toEqual(source);
  expect(calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
});

test("stops and exposes a page failure", async () => {
  await expect(readAllSupabaseRows(async (from) => from === 0
    ? { data: [1, 2], error: null }
    : { data: null, error: { message: "page unavailable" } }, 2))
    .rejects.toThrow("page unavailable");
});
