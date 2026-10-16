import { expect, test } from "@playwright/test";
import { reportErrorResponse } from "../../src/lib/server/report-response";

test("report reads redact unexpected database diagnostics", async () => {
  const response = reportErrorResponse(
    'relation "private.report_secret" does not exist postgres://internal-secret@db.example/app',
  );
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "ระบบรายงานขัดข้อง กรุณาลองใหม่",
  });
});
