import { expect, test } from "@playwright/test";

import {
  classifyAuthAccessFailure,
  classifyAuthClaimsFailure,
  summarizeUpstreamError,
} from "@/lib/server/auth-access-failure";

test("classifies Supabase profile lookup failures as retryable service outages", () => {
  expect(classifyAuthAccessFailure({
    hasProfile: false,
    isActive: false,
    locationScopeError: null,
    profileError: { message: "522 Connection timed out" },
  })).toEqual({
    message: "ระบบยืนยันสิทธิ์ชั่วคราวไม่พร้อมใช้งาน",
    status: 503,
  });

  expect(classifyAuthAccessFailure({
    hasProfile: true,
    isActive: true,
    locationScopeError: { message: "522 Connection timed out" },
    profileError: null,
  })).toEqual({
    message: "ระบบยืนยันสิทธิ์ชั่วคราวไม่พร้อมใช้งาน",
    status: 503,
  });
});

test("keeps missing and inactive profiles as authorization failures", () => {
  expect(classifyAuthAccessFailure({
    hasProfile: false,
    isActive: false,
    locationScopeError: null,
    profileError: null,
  })?.status).toBe(403);

  expect(classifyAuthAccessFailure({
    hasProfile: true,
    isActive: false,
    locationScopeError: null,
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
