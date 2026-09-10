import { expect, test, type Browser, type BrowserContext } from "@playwright/test";

async function context(browser: Browser, role: "user" | "admin" | "super_admin") {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

async function primaryLocationId(client: BrowserContext) {
  const response = await client.request.get("/api/auth/me");
  expect(response.ok()).toBe(true);
  return (await response.json() as { profile: { locationIds: string[] } }).profile.locationIds[0];
}

function cursor(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

test("payroll mutation routes reject null JSON bodies", async ({ browser }) => {
  const user = await context(browser, "user");
  const admin = await context(browser, "super_admin");
  try {
    for (const [client, path] of [
      [user, "/api/lanflow/time-tracking/user"],
      [admin, "/api/lanflow/time-tracking/admin"],
    ] as const) {
      const response = await client.request.post(path, {
        headers: { "Content-Type": "application/json" },
        data: null,
      });
      expect(response.status(), path).toBe(400);
    }
  } finally {
    await Promise.all([user.close(), admin.close()]);
  }
});

test("history routes reject incomplete and malformed keyset cursors", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  const locationId = await primaryLocationId(manager);
  const malformed = encodeURIComponent(cursor({
    version: 1,
    ownerUserId: "missing",
    locationId,
    view: "current",
    at: "not-a-time",
  }));
  try {
    for (const path of [
      `/api/lanflow/reports?locationId=${locationId}&cursor=${malformed}`,
      `/api/lanflow/rubber-exports?locationId=${locationId}&cursor=${malformed}`,
      `/api/lanflow/cash-counts?locationId=${locationId}&cursor=${malformed}`,
    ]) {
      const response = await manager.request.get(path);
      expect(response.status(), path).toBe(400);
    }
  } finally {
    await manager.close();
  }
});

test("report history canonicalizes parseable cursor timestamps before building filters", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  try {
    const authResponse = await manager.request.get("/api/auth/me");
    expect(authResponse.ok()).toBe(true);
    const { profile } = await authResponse.json() as {
      profile: { id: string; locationIds: string[] };
    };
    const parseableButUnsafe = encodeURIComponent(cursor({
      version: 1,
      ownerUserId: profile.id,
      locationId: profile.locationIds[0],
      view: "current",
      at: "Thu, 01 Jan 2026 00:00:00 GMT (cursor comment)",
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    }));

    const response = await manager.request.get(
      `/api/lanflow/reports?locationId=${profile.locationIds[0]}&cursor=${parseableButUnsafe}`,
    );
    expect(response.status()).toBe(200);
  } finally {
    await manager.close();
  }
});

test("slip OCR rejects missing and unsupported uploads before upstream work", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  try {
    const missing = await manager.request.post("/api/lanflow/ocr-slip", {
      multipart: {},
    });
    expect(missing.status()).toBe(400);

    const unsupported = await manager.request.post("/api/lanflow/ocr-slip", {
      multipart: {
        image: {
          name: "slip.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("not an image"),
        },
      },
    });
    expect(unsupported.status()).toBe(400);
  } finally {
    await manager.close();
  }
});

test("approval decision routes reject malformed request IDs before PostgreSQL", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  try {
    for (const path of [
      "/api/lanflow/income-expense/approval-requests/not-a-uuid/decide",
      "/api/lanflow/cash-branch-transfers/delete-requests/not-a-uuid/decide",
    ]) {
      const response = await manager.request.post(path, {
        data: { decision: "approved" },
      });
      expect(response.status(), path).toBe(400);
    }
  } finally {
    await manager.close();
  }
});

test("report detail routes reject malformed report IDs before PostgreSQL", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  try {
    const [detail, deletion] = await Promise.all([
      manager.request.get("/api/lanflow/reports/not-a-uuid"),
      manager.request.delete("/api/lanflow/reports/not-a-uuid"),
    ]);
    expect([detail.status(), deletion.status()]).toEqual([400, 400]);
  } finally {
    await manager.close();
  }
});

test("report collection routes reject malformed location IDs before PostgreSQL", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  try {
    const [list, create] = await Promise.all([
      manager.request.get("/api/lanflow/reports?locationId=not-a-uuid"),
      manager.request.post("/api/lanflow/reports", {
        data: { locationId: "not-a-uuid" },
      }),
    ]);
    expect([list.status(), create.status()]).toEqual([400, 400]);
  } finally {
    await manager.close();
  }
});
