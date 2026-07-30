import { expect, test } from "@playwright/test";

import { isRetryableSyncResponse } from "@/lib/sync-response";

test("classifies transient sync responses without treating business failures as retryable", () => {
  expect([401, 408, 425, 429, 500, 503].map(isRetryableSyncResponse)).toEqual([
    true,
    true,
    true,
    true,
    true,
    true,
  ]);
  expect([400, 403, 409, 422].map(isRetryableSyncResponse)).toEqual([
    false,
    false,
    false,
    false,
  ]);
});
