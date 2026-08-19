import { expect, test } from "@playwright/test";
import { chunkUniqueIds } from "../../src/lib/server/chunk-ids";

test("report detail preserves every unique id across a fixture larger than 1,000 rows", () => {
  const ids = Array.from({ length: 1_001 }, (_, index) =>
    `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );

  const chunks = chunkUniqueIds([...ids, ids[500]]);

  expect(chunks).toHaveLength(11);
  expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
  expect(chunks.flat()).toEqual(ids);
});
