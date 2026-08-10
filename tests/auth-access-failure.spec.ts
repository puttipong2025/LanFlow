import { expect, test } from "@playwright/test";

import {
  classifyAuthAccessFailure,
  classifyAuthClaimsFailure,
  summarizeUpstreamError,
} from "@/lib/server/auth-access-failure";

test("classifies Supabase profile lookup failures as retryable service outages", () => {
  expect(classifyAuthAccessFailure({
    assignmentsError: null,
    hasProfile: false,
    isActive: false,
    profileError: { message: "522 Connection timed out" },
  })).toEqual({
    message: "ระบบยืนยันสิทธิ์ชั่วคราวไม่พร้อมใช้งาน",
    status: 503,
  });

  expect(classifyAuthAccessFailure({
    assignmentsError: { message: "522 Connection timed out" },
    hasProfile: true,
    isActive: true,
    profileError: null,
  })).toEqual({
    message: "ระบบยืนยันสิทธิ์ชั่วคราวไม่พร้อมใช้งาน",
    status: 503,
  });
});

test("keeps missing and inactive profiles as authorization failures", () => {
  expect(classifyAuthAccessFailure({
    assignmentsError: null,
    hasProfile: false,
    isActive: false,
    profileError: null,
  })?.status).toBe(403);

  expect(classifyAuthAccessFailure({
    assignmentsError: null,
    hasProfile: true,
    isActive: false,
    profileError: null,
  })?.status).toBe(403);
});

test("keeps invalid claims unauthorized but treats claim network failures as retryable", () => {
  expect(classifyAuthClaimsFailure({
    claimsError: { name: "AuthRetryableFetchError", message: "fetch failed", status: 0 },
    hasUserId: false,
  })?.status).toBe(503);

  expect(classifyAuthClaimsFailure({
    claimsError: { name: "AuthApiError", message: "invalid JWT", status: 401 },
    hasUserId: false,
  })?.status).toBe(401);

  expect(classifyAuthClaimsFailure({
    claimsError: null,
    hasUserId: false,
  })?.status).toBe(401);
});

test("summarizes upstream HTML without writing the full error page to logs", () => {
  expect(summarizeUpstreamError({
    message: "<!DOCTYPE html><html><title>supabase.co | 522</title><body>large response</body></html>",
    status: 522,
  })).toEqual({
    code: undefined,
    message: "upstream returned an HTML error response",
    name: undefined,
    status: 522,
  });
});
