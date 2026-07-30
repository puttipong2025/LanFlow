import { expect, test } from "@playwright/test";
import {
  selectAppLocation,
  selectedAppLocationId,
} from "./helpers/select-app-location";

test.describe("last location preference", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("locks the current location and its pending queue partition immediately when offline", async ({
    page,
    context,
  }) => {
    const response = await page.request.get("/api/lanflow");
    expect(response.ok(), await response.text()).toBeTruthy();
    const data = await response.json() as {
      locations: Array<{ id: string; name: string; active: boolean }>;
      profile: { id: string; locationIds: string[] };
    };
    const accessibleLocations = data.locations.filter((location) =>
      location.active && data.profile.locationIds.includes(location.id)
    );
    expect(accessibleLocations.length).toBeGreaterThan(0);

    const currentLocationId = accessibleLocations[0].id;
    const blockedLocation = accessibleLocations[1] ?? {
      ...accessibleLocations[0],
      id: "phase-1-2-secondary-location",
      name: "สาขาทดสอบ Phase 1.2",
    };
    const blockedLocationId = blockedLocation.id;
    let queueId: number | null = null;

    if (accessibleLocations.length === 1) {
      await page.route(/\/api\/lanflow(?:\?.*)?$/, async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            locations: [...data.locations, blockedLocation],
            profile: {
              ...data.profile,
              locationIds: [...data.profile.locationIds, blockedLocationId],
            },
          }),
        });
      });
    }

    await page.goto("/");
    const locationButton = page.getByLabel(/^เลือกสาขา/);
    await expect(locationButton).toBeVisible({ timeout: 15_000 });
    if (await selectedAppLocationId(page) !== currentLocationId) {
      await selectAppLocation(page, currentLocationId);
    }
    await expect.poll(() => selectedAppLocationId(page)).toBe(currentLocationId);
    await expect.poll(() =>
      page.evaluate(
        ({ userId }) => localStorage.getItem(`lanflow:last-location:${userId}`),
        { userId: data.profile.id },
      )
    ).toBe(currentLocationId);

    queueId = await page.evaluate(
      ({ locationId, ownerUserId }) => new Promise<number>((resolve, reject) => {
        const openRequest = indexedDB.open("lanflow_sync_db");
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = () => {
          const db = openRequest.result;
          const transaction = db.transaction("sync_queue", "readwrite");
          const addRequest = transaction.objectStore("sync_queue").add({
            id: "phase-1-2-location-lock",
            entity: "rubber_bills",
            ownerUserId,
            locationId,
            operation: "create",
            payload: {
              clientTempId: "phase-1-2-location-lock",
              idempotencyKey: "phase-1-2-location-lock",
              locationId,
            },
            timestamp: Date.now(),
            status: "pending",
          });
          addRequest.onerror = () => reject(addRequest.error);
          addRequest.onsuccess = () => resolve(addRequest.result as number);
          transaction.oncomplete = () => db.close();
        };
      }),
      { locationId: currentLocationId, ownerUserId: data.profile.id },
    );

    await locationButton.click();
    await expect(page.getByRole("listbox", { name: "สาขาที่เข้าถึงได้" })).toBeVisible();
    await page.evaluate((targetLocationId) => {
      const target = document.querySelector<HTMLButtonElement>(
        `[role="option"][data-location-id="${targetLocationId}"]`,
      );
      if (!target) throw new Error("Target location option is not open");
      window.addEventListener("offline", () => target.click(), { once: true });
    }, blockedLocationId);

    try {
      await context.setOffline(true);

      await expect.soft(locationButton).toBeDisabled({ timeout: 1_000 });
      await expect.soft(
        page.getByRole("listbox", { name: "สาขาที่เข้าถึงได้" }),
      ).toBeHidden();
      await expect.soft.poll(
        () => selectedAppLocationId(page),
        { timeout: 1_000 },
      ).toBe(currentLocationId);
      await expect.soft.poll(() =>
        page.evaluate(
          ({ userId }) => localStorage.getItem(`lanflow:last-location:${userId}`),
          { userId: data.profile.id },
        )
      , { timeout: 1_000 }).toBe(currentLocationId);
      await expect.soft.poll(() =>
        page.evaluate(
          ({ userId }) => {
            const raw = localStorage.getItem(`lanflow_bootstrap_cache:${userId}`);
            return raw ? JSON.parse(raw).selectedLocationId : null;
          },
          { userId: data.profile.id },
        )
      , { timeout: 1_000 }).toBe(currentLocationId);
      await expect.soft.poll(() =>
        page.evaluate(
          ({ pendingQueueId, locationId }) => new Promise<boolean>((resolve, reject) => {
            const openRequest = indexedDB.open("lanflow_sync_db");
            openRequest.onerror = () => reject(openRequest.error);
            openRequest.onsuccess = () => {
              const db = openRequest.result;
              const transaction = db.transaction("sync_queue", "readonly");
              const getRequest = transaction.objectStore("sync_queue").get(pendingQueueId);
              getRequest.onerror = () => reject(getRequest.error);
              getRequest.onsuccess = () => {
                db.close();
                resolve(
                  getRequest.result?.status === "pending"
                  && getRequest.result?.locationId === locationId
                );
              };
            };
          }),
          { pendingQueueId: queueId, locationId: currentLocationId },
        )
      , { timeout: 1_000 }).toBe(true);
    } finally {
      if (queueId !== null) {
        await page.evaluate((pendingQueueId) => new Promise<void>((resolve, reject) => {
          const openRequest = indexedDB.open("lanflow_sync_db");
          openRequest.onerror = () => reject(openRequest.error);
          openRequest.onsuccess = () => {
            const db = openRequest.result;
            const transaction = db.transaction("sync_queue", "readwrite");
            transaction.objectStore("sync_queue").delete(pendingQueueId);
            transaction.onerror = () => reject(transaction.error);
            transaction.oncomplete = () => {
              db.close();
              resolve();
            };
          };
        }), queueId).catch(() => {});
      }
      await context.setOffline(false).catch(() => {});
    }
  });

  test("does not switch locations when bootstrap finishes after the device goes offline", async ({
    page,
    context,
  }) => {
    const response = await page.request.get("/api/lanflow");
    expect(response.ok(), await response.text()).toBeTruthy();
    const data = await response.json() as {
      locations: Array<{ id: string; name: string; active: boolean }>;
      profile: { id: string; locationIds: string[] };
    };
    const currentLocation = data.locations.find((location) =>
      location.active && location.id === data.profile.locationIds[0]
    );
    expect(currentLocation).toBeTruthy();
    const blockedLocation = {
      ...currentLocation!,
      id: "phase-1-2-delayed-bootstrap-location",
      name: "สาขาทดสอบ delayed bootstrap",
    };

    await page.addInitScript(
      ({ userId, preferredLocationId, cachedLocationId, locations, profile }) => {
        localStorage.setItem(`lanflow:last-location:${userId}`, preferredLocationId);
        localStorage.setItem(`lanflow_bootstrap_cache:${userId}`, JSON.stringify({
          locations,
          profile,
          selectedLocationId: cachedLocationId,
        }));
      },
      {
        userId: data.profile.id,
        preferredLocationId: blockedLocation.id,
        cachedLocationId: currentLocation!.id,
        locations: data.locations,
        profile: data.profile,
      },
    );

    let releaseBootstrap!: () => void;
    const bootstrapBlocked = new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    });
    let bootstrapRequested = false;
    await page.route(/\/api\/lanflow(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      bootstrapRequested = true;
      await bootstrapBlocked;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          locations: [...data.locations, blockedLocation],
          profile: {
            ...data.profile,
            locationIds: [...data.profile.locationIds, blockedLocation.id],
          },
        }),
      });
    });

    try {
      await page.goto("/");
      await expect.poll(() => bootstrapRequested).toBe(true);
      await expect.poll(() => page.evaluate(
        ({ userId }) => localStorage.getItem(`lanflow:auth-profile:${userId}`) !== null,
        { userId: data.profile.id },
      )).toBe(true);
      await context.setOffline(true);
      releaseBootstrap();

      const locationButton = page.getByLabel(/^เลือกสาขา/);
      await expect(locationButton).toBeVisible({ timeout: 15_000 });
      await expect(locationButton).toBeDisabled();
      await expect.poll(() => selectedAppLocationId(page)).toBe(currentLocation!.id);
      await expect.poll(() =>
        page.evaluate(
          ({ userId }) => {
            const raw = localStorage.getItem(`lanflow_bootstrap_cache:${userId}`);
            return raw ? JSON.parse(raw).selectedLocationId : null;
          },
          { userId: data.profile.id },
        )
      ).toBe(currentLocation!.id);
    } finally {
      releaseBootstrap();
      await context.setOffline(false).catch(() => {});
    }
  });

  test("does not switch to a cached preference when bootstrap fails after going offline", async ({
    page,
    context,
  }) => {
    const response = await page.request.get("/api/lanflow");
    expect(response.ok(), await response.text()).toBeTruthy();
    const data = await response.json() as {
      locations: Array<{ id: string; name: string; active: boolean }>;
      profile: { id: string; locationIds: string[] };
    };
    const currentLocation = data.locations.find((location) =>
      location.active && location.id === data.profile.locationIds[0]
    );
    expect(currentLocation).toBeTruthy();
    const preferredLocation = {
      ...currentLocation!,
      id: "phase-1-2-cached-preference-location",
      name: "สาขาทดสอบ cached preference",
    };
    const cachedLocations = [...data.locations, preferredLocation];
    const cachedProfile = {
      ...data.profile,
      locationIds: [...data.profile.locationIds, preferredLocation.id],
    };

    await page.addInitScript(
      ({ userId, preferredLocationId, currentLocationId, locations, profile }) => {
        localStorage.setItem(`lanflow:last-location:${userId}`, preferredLocationId);
        localStorage.setItem(`lanflow_bootstrap_cache:${userId}`, JSON.stringify({
          locations,
          profile,
          selectedLocationId: currentLocationId,
        }));
      },
      {
        userId: data.profile.id,
        preferredLocationId: preferredLocation.id,
        currentLocationId: currentLocation!.id,
        locations: cachedLocations,
        profile: cachedProfile,
      },
    );

    let releaseBootstrap!: () => void;
    const bootstrapBlocked = new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    });
    let bootstrapRequested = false;
    await page.route(/\/api\/lanflow(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      bootstrapRequested = true;
      await bootstrapBlocked;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "service unavailable" }),
      }).catch(() => {});
    });

    try {
      await page.goto("/");
      await expect.poll(() => bootstrapRequested).toBe(true);
      await context.setOffline(true);
      releaseBootstrap();

      const locationButton = page.getByLabel(/^เลือกสาขา/);
      await expect(locationButton).toBeVisible({ timeout: 15_000 });
      await expect(locationButton).toBeDisabled();
      await expect.poll(() => selectedAppLocationId(page)).toBe(currentLocation!.id);
    } finally {
      releaseBootstrap();
      await context.setOffline(false).catch(() => {});
    }
  });

  test("restores the latest location after reload and logout/login", async ({ page }) => {
    await page.route("**/auth/v1/logout**", (route) =>
      route.fulfill({ status: 204, body: "" })
    );
    const response = await page.request.get("/api/lanflow");
    expect(response.ok(), await response.text()).toBeTruthy();
    const data = await response.json() as {
      locations: Array<{ id: string }>;
      profile: { id: string; locationIds: string[] };
    };
    const accessibleLocations = data.locations.filter((location) =>
      data.profile.locationIds.includes(location.id)
    );
    expect(accessibleLocations.length).toBeGreaterThan(0);

    if (accessibleLocations.length === 1) {
      const onlyLocationId = accessibleLocations[0].id;

      await page.goto("/");
      await expect(page.getByLabel(/^เลือกสาขา/)).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => selectedAppLocationId(page)).toBe(onlyLocationId);

      await page.evaluate(
        ({ userId }) => localStorage.setItem(
          `lanflow:last-location:${userId}`,
          "retired-location",
        ),
        { userId: data.profile.id },
      );
      await page.reload();

      await expect.poll(() => selectedAppLocationId(page)).toBe(onlyLocationId);
      return;
    }

    const targetLocationId = accessibleLocations[accessibleLocations.length - 1].id;

    await page.goto("/");
    await expect(page.getByLabel(/^เลือกสาขา/)).toBeVisible({ timeout: 15_000 });
    await selectAppLocation(page, targetLocationId);
    await expect.poll(() => selectedAppLocationId(page)).toBe(targetLocationId);

    await page.reload();
    await expect.poll(() => selectedAppLocationId(page)).toBe(targetLocationId);

    await page.getByRole("button", { name: "ออกจากระบบ", exact: true }).click();
    await page.getByRole("button", { name: "ออกจากระบบ", exact: true }).last().click();
    await expect(page.getByRole("button", { name: "เข้าสู่ระบบ" })).toBeVisible({
      timeout: 10_000,
    });
    await expect.poll(() =>
      page.evaluate(
        ({ userId }) => localStorage.getItem(`lanflow:last-location:${userId}`),
        { userId: data.profile.id },
      )
    ).toBe(targetLocationId);

    await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
    await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();

    await expect(page.getByLabel(/^เลือกสาขา/)).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => selectedAppLocationId(page)).toBe(targetLocationId);
  });
});
