import { expect, test } from "@playwright/test";
import { focusManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  millisecondsUntilNextActionableBadgeRefresh,
  millisecondsUntilNextPayrollCutoff,
  millisecondsUntilNextPayrollRefresh,
} from "@/lib/time-tracking/payroll-cutoff-refresh";

const actionableBadgeSource = readFileSync(resolve("src/hooks/useActionableBadges.ts"), "utf8");

test("schedules the manager refresh at the Bangkok month-end cutoff", () => {
  expect(millisecondsUntilNextPayrollCutoff(
    new Date("2026-09-30T15:00:00+07:00"),
    "16:00",
  )).toBe(3_601_000);
});

test("moves the refresh to next month after the current cutoff", () => {
  const now = new Date("2026-09-30T16:00:02+07:00");
  const next = new Date("2026-10-31T16:00:01+07:00");
  expect(millisecondsUntilNextPayrollCutoff(now, "16:00")).toBe(next.getTime() - now.getTime());
});

test("ignores an invalid cutoff instead of starting a busy timer", () => {
  expect(millisecondsUntilNextPayrollCutoff(new Date("2026-09-30T15:00:00+07:00"), "bad")).toBeNull();
});

test("refreshes at midnight when a scheduled END becomes effective before month-end", () => {
  const now = new Date("2026-09-14T23:59:00+07:00");
  expect(millisecondsUntilNextPayrollRefresh(now, "16:00", ["2026-09-15"]))
    .toBe(new Date("2026-09-15T00:00:01+07:00").getTime() - now.getTime());
});

test("refreshes when a pending cutoff setting becomes effective", () => {
  const now = new Date("2026-09-29T23:59:00+07:00");
  expect(millisecondsUntilNextPayrollRefresh(now, "16:00", [], "2026-09-30"))
    .toBe(new Date("2026-09-30T00:00:01+07:00").getTime() - now.getTime());
});

test("shortens the global badge poll to the exact payroll boundary", () => {
  expect(millisecondsUntilNextActionableBadgeRefresh(
    new Date("2026-09-30T15:59:51+07:00"),
    "16:00",
  )).toBe(10_000);
  expect(millisecondsUntilNextActionableBadgeRefresh(
    new Date("2026-09-30T15:00:00+07:00"),
    "16:00",
  )).toBe(60_000);
  expect(actionableBadgeSource).toContain('supabase.rpc("get_time_payroll_settings")');
  expect(actionableBadgeSource).toContain("millisecondsUntilNextActionableBadgeRefresh");
});

test("refreshes a fresh actionable-badge query whenever the page regains focus", async () => {
  const configuredFocusMode = actionableBadgeSource.match(
    /refetchOnWindowFocus:\s*("always"|true|false)/,
  )?.[1];
  expect(configuredFocusMode).toBeDefined();
  const refetchOnWindowFocus = configuredFocusMode === '"always"'
    ? "always" as const
    : configuredFocusMode === "true";
  let fetchCount = 0;
  const queryKey = ["actionableBadgeFocusContract"] as const;
  const queryFn = async () => ++fetchCount;
  const client = new QueryClient();
  client.mount();

  try {
    await client.fetchQuery({ queryKey, queryFn, staleTime: 60_000 });
    const observer = new QueryObserver(client, {
      queryKey,
      queryFn,
      staleTime: 60_000,
      refetchOnWindowFocus,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      expect(fetchCount).toBe(1);
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await expect.poll(() => fetchCount).toBe(2);
    } finally {
      unsubscribe();
    }
  } finally {
    focusManager.setFocused(undefined);
    client.unmount();
    client.clear();
  }
});

test("does not expose cached actionable badges after a refresh error", async () => {
  expect(actionableBadgeSource).toMatch(
    /counts:\s*query\.isError\s*\?\s*\{\}\s*:\s*query\.data\?\.counts\s*\?\?\s*\{\}/,
  );

  let shouldFail = false;
  const queryKey = ["actionableBadgeErrorContract"] as const;
  const queryFn = async () => {
    if (shouldFail) throw new Error("badge RPC unavailable");
    return { counts: { branch: { "time-tracking": 1 } } };
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const observer = new QueryObserver(client, { queryKey, queryFn, staleTime: 60_000 });
  const unsubscribe = observer.subscribe(() => {});

  try {
    await expect.poll(() => observer.getCurrentResult().isSuccess).toBe(true);
    shouldFail = true;
    await observer.refetch({ throwOnError: false });
    const failedResult = observer.getCurrentResult();
    expect(failedResult.isError).toBe(true);
    expect(failedResult.data).toEqual({ counts: { branch: { "time-tracking": 1 } } });
  } finally {
    unsubscribe();
    client.clear();
  }
});
