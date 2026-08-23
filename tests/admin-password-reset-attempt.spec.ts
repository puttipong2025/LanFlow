import { expect, test } from "@playwright/test";

import {
  createPasswordResetAttemptId,
  nextPasswordResetAttemptId,
} from "../src/components/admin/password-reset-attempt";

test.describe("Admin password reset attempt", () => {
  test("reuses the request id until a password input changes", () => {
    expect(nextPasswordResetAttemptId("attempt-a", false, () => "attempt-b")).toBe("attempt-a");
    expect(nextPasswordResetAttemptId("attempt-a", true, () => "attempt-b")).toBe("attempt-b");
    expect(createPasswordResetAttemptId(() => "attempt-c")).toBe("attempt-c");
  });
});
