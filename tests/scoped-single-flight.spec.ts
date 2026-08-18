import { expect, test } from "@playwright/test";

import { createScopedSingleFlight } from "../src/lib/scoped-single-flight";

test("reuses work in the same scope and keeps different scopes independent", async () => {
  const singleFlight = createScopedSingleFlight();
  let releaseA!: (value: string) => void;
  let runs = 0;
  const firstA = singleFlight("rubber:user-1:location-a", () => {
    runs += 1;
    return new Promise<string>((resolve) => { releaseA = resolve; });
  });
  const secondA = singleFlight("rubber:user-1:location-a", async () => {
    runs += 1;
    return "duplicate";
  });
  const locationB = singleFlight("rubber:user-1:location-b", async () => {
    runs += 1;
    return "location-b";
  });

  expect(secondA).toBe(firstA);
  await expect(locationB).resolves.toBe("location-b");
  expect(runs).toBe(2);
  releaseA("location-a");
  await expect(firstA).resolves.toBe("location-a");

  await expect(singleFlight("rubber:user-1:location-a", async () => {
    runs += 1;
    return "next";
  })).resolves.toBe("next");
  expect(runs).toBe(3);
});

test("clears a rejected scope so retry can run", async () => {
  const singleFlight = createScopedSingleFlight();
  await expect(singleFlight("income:user-1:location-a", async () => {
    throw new Error("failed");
  })).rejects.toThrow("failed");
  await expect(singleFlight("income:user-1:location-a", async () => "retried"))
    .resolves.toBe("retried");
});
