import { expect, test } from "@playwright/test";

import { readAllSupabaseRows, readAllSupabaseRowsByCreatedAt } from "../src/lib/supabase-pages";

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

test("checks the boundary of short approval pages without losing timestamp precision", async () => {
  const page = Array.from({ length: 500 }, (_, index) => ({
    id: `81000000-0000-4000-8000-${String(500 - index).padStart(12, "0")}`,
    created_at: "2026-11-09T00:00:00.000002Z",
  }));
  const read = (row: typeof page[number]) => readAllSupabaseRowsByCreatedAt(async (_limit, before) => ({
    data: before ? [row] : page,
    error: null,
  }));
  await expect(read({ ...page[0], created_at: "2026-11-09T07:00:00.000001+07:00" })).resolves.toHaveLength(501);
  await expect(read(page[499])).rejects.toThrow("Supabase page cursor did not advance");
  await expect(read({ ...page[499], created_at: "2026-11-09T07:00:00.000003+07:00" }))
    .rejects.toThrow("Supabase page cursor did not advance");
});
