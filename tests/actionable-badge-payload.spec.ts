import { expect, test } from "@playwright/test";
import { QueryClient, type FetchQueryOptions } from "@tanstack/react-query";
import { loadSourceModule } from "./helpers/load-source-module";
import { parseActionableBadgeCounts } from "../src/lib/actionable-badge-counts";

const location = "bc100000-0000-4000-8000-000000000010";
const valid = { location_id: location, module_id: "cash", item_count: 3 };
const actor = "bc100000-0000-4000-8000-000000000001";

function captureQuery(payload: unknown) {
  let options: FetchQueryOptions<unknown> | undefined;
  const module = loadSourceModule<typeof import("../src/hooks/useActionableBadges")>(
    "src/hooks/useActionableBadges.ts", {
      "@tanstack/react-query": { useQuery: (incoming: FetchQueryOptions<unknown>) => {
        options = incoming; return { isError: false };
      } },
      "@/lib/supabase/client": { createSupabaseBrowserClient: () => ({
        auth: { getSession: async () => ({ data: { session: { user: { id: actor } } }, error: null }) },
        rpc: (name: string) => ({ abortSignal: async () => ({ data: name === "get_actionable_badge_counts" ? payload : {}, error: null }) }),
      }) },
    },
  );
  module.useActionableBadges(actor, true);
  if (!options) throw new Error("Query was not captured");
  return options;
}

for (const [name, payload] of [
  ["missing data", null],
  ["non-array", {}],
  ["negative count", [{ ...valid, item_count: -1 }]],
  ["null count", [{ ...valid, item_count: null }]],
  ["string count", [{ ...valid, item_count: "3" }]],
  ["unknown module", [{ ...valid, module_id: "unknown" }]],
  ["invalid location", [{ ...valid, location_id: "not-a-location" }]],
  ["duplicate branch/module", [valid, valid]],
  ["overflowing branch total", [{ ...valid, item_count: Number.MAX_SAFE_INTEGER }, { ...valid, module_id: "rubber", item_count: 1 }]],
  ["prototype key as location", [{ ...valid, location_id: "__proto__" }]],
  ["prototype key as module", [{ ...valid, module_id: "constructor" }]],
  ["partial success followed by malformed row", [valid, null]],
] as const) {
  test(`malformed successful badge payload rejects rather than becoming a valid count: ${name}`, async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    try {
      const options = captureQuery(payload);
      await expect(client.fetchQuery(options)).rejects.toThrow();
      expect(client.getQueryData(options.queryKey)).toBeUndefined();
    } finally { client.clear(); }
  });
}

test("empty results, zero counts and legacy PostgreSQL UUIDs remain valid", () => {
  expect(parseActionableBadgeCounts([])).toEqual({});
  expect(parseActionableBadgeCounts([
    { ...valid, item_count: 0 },
    { ...valid, location_id: "00000000-0000-0000-0000-000000000000" },
    { ...valid, location_id: "11111111-1111-1111-1111-111111111111" },
  ])).toEqual({
    [location]: { cash: 0 },
    "00000000-0000-0000-0000-000000000000": { cash: 3 },
    "11111111-1111-1111-1111-111111111111": { cash: 3 },
  });
});

test("UUID case normalization preserves different modules and rejects duplicate identities", () => {
  expect(parseActionableBadgeCounts([valid, { ...valid, location_id: location.toUpperCase(), module_id: "rubber" }]))
    .toEqual({ [location]: { cash: 3, rubber: 3 } });
  expect(() => parseActionableBadgeCounts([valid, { ...valid, location_id: location.toUpperCase() }])).toThrow();
});

test("safe integer maximum is retained exactly", () => {
  expect(parseActionableBadgeCounts([{ ...valid, item_count: Number.MAX_SAFE_INTEGER }]))
    .toEqual({ [location]: { cash: Number.MAX_SAFE_INTEGER } });
});
