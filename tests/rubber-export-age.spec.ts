import { expect, test } from "@playwright/test";
import { formatRubberAge } from "@/lib/rubber-exports/rubber-export-presentation";

test("formats server-calculated rubber age in Thai days and hours", () => {
  expect(formatRubberAge(49.5)).toBe("2 วัน 2 ชั่วโมง (2.06 วัน)");
  expect(formatRubberAge(23.49)).toBe("0 วัน 23 ชั่วโมง (0.98 วัน)");
});

test("uses an em dash when a deleted draft has no official cutoff", () => {
  expect(formatRubberAge(null)).toBe("—");
});
