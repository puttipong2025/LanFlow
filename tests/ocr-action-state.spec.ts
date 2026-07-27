import { expect, test } from "@playwright/test";

import { getOcrActionState } from "../src/lib/ocr-action-state";

test("OCR action state counts pending/error, separates processing, and ignores success", () => {
  expect(getOcrActionState([
    { status: "pending" },
    { status: "error" },
    { status: "processing" },
    { status: "success" },
  ])).toEqual({
    actionableCount: 2,
    processingCount: 1,
    errorCount: 1,
  });
});
