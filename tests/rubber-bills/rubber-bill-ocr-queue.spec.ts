import { expect, test } from "@playwright/test";

import {
  isRetryableOcrFailure,
  nextPendingRubberBillOcrItem,
  requeueRubberBillOcrItem,
  type RubberBillOcrQueueItem,
} from "../../src/hooks/useRubberBillOcrQueue";

function item(id: string, status: RubberBillOcrQueueItem["status"]): RubberBillOcrQueueItem {
  return {
    id,
    locationId: "location-1",
    file: {} as File,
    previewUrl: `blob:${id}`,
    status,
  };
}

test("network failures remain retryable unless the stable API error explicitly forbids retry", () => {
  expect(isRetryableOcrFailure(new Error("network interrupted"))).toBe(true);
  expect(isRetryableOcrFailure(Object.assign(new Error("temporary"), { retryable: true }))).toBe(true);
  expect(isRetryableOcrFailure(Object.assign(new Error("invalid image"), { retryable: false }))).toBe(false);
});

test("manual retry requeues every error behind the single active OCR worker without overlapping it", () => {
  const current = item("first", "processing");
  const failed = { ...item("second", "error"), retryable: false, errorMessage: "invalid image" };
  const retried = requeueRubberBillOcrItem([current, failed], failed.id);

  expect(retried[1]).toMatchObject({ id: "second", status: "pending" });
  expect(nextPendingRubberBillOcrItem(retried, true)).toBeNull();

  const afterCurrentCompletes = [{ ...retried[0], status: "ready" as const }, retried[1]];
  expect(nextPendingRubberBillOcrItem(afterCurrentCompletes, false)?.id).toBe("second");
});
