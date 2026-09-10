import { expect, test } from "@playwright/test";

test.use({ storageState: "playwright/.auth/super_admin.json" });

test("Stock list API enforces parameters, cursor owner, branch scope, and inclusive dates", async ({ browser, request }) => {
  const meResponse = await request.get("/api/auth/me");
  expect(meResponse.ok()).toBeTruthy();
  const me = await meResponse.json() as { profile: { id: string; locationIds: string[] } };
  const locationId = me.profile.locationIds[0];

  expect((await request.get("/api/lanflow/acid-stock?locationId=not-a-uuid")).status()).toBe(400);
  expect((await request.get("/api/lanflow/rubber-exports?locationId=not-a-uuid")).status()).toBe(400);
  expect((await request.get(`/api/lanflow/acid-stock?locationId=${locationId}&search=%00`)).status()).toBe(400);
  expect((await request.get(`/api/lanflow/rubber-exports?locationId=${locationId}&search=%00`)).status()).toBe(400);
  expect((await request.get(`/api/lanflow/acid-stock?locationId=${locationId}&type=unknown`)).status()).toBe(400);
  expect((await request.get(`/api/lanflow/acid-stock?locationId=${locationId}&fromDate=2026-09-31`)).status()).toBe(400);
  expect((await request.get(`/api/lanflow/acid-stock?locationId=${locationId}&cursor=not-a-cursor`)).status()).toBe(400);
  const otherOwnerCursor = Buffer.from(JSON.stringify({
    version: 1,
    ownerUserId: "59000000-0000-4000-8000-000000000001",
    locationId,
    txDate: "2026-09-10",
    createdAt: "2026-09-10T01:00:00.000Z",
    movementId: "stock-entry:cursor-test",
  })).toString("base64url");
  expect((await request.get(`/api/lanflow/acid-stock?locationId=${locationId}&cursor=${otherOwnerCursor}`)).status()).toBe(400);
  const oversizedStockCursor = Buffer.from(JSON.stringify({
    version: 1,
    ownerUserId: me.profile.id,
    locationId,
    txDate: "2026-09-10",
    createdAt: "2026-09-10T01:00:00.000Z",
    movementId: "stock-entry:cursor-test",
    padding: "x".repeat(5000),
  })).toString("base64url");
  expect((await request.get(`/api/lanflow/acid-stock?locationId=${locationId}&cursor=${oversizedStockCursor}`)).status()).toBe(400);
  const oversizedRubberExportCursor = Buffer.from(JSON.stringify({
    version: 1,
    ownerUserId: me.profile.id,
    locationId,
    view: "active",
    createdAt: "2026-09-10T01:00:00.000Z",
    id: "59000000-0000-4000-8000-000000000001",
    padding: "x".repeat(5000),
  })).toString("base64url");
  expect((await request.get(`/api/lanflow/rubber-exports?locationId=${locationId}&cursor=${oversizedRubberExportCursor}`)).status()).toBe(400);
  const nonIsoDeletionCursor = Buffer.from(JSON.stringify({
    version: 1,
    ownerUserId: me.profile.id,
    locationId,
    view: "deletions",
    createdAt: "Wed, 09 Sep 2099 00:00:00 GMT",
    id: "ffffffff-ffff-4fff-bfff-ffffffffffff",
  })).toString("base64url");
  expect((await request.get(
    `/api/lanflow/rubber-exports?locationId=${locationId}&view=deletions&cursor=${nonIsoDeletionCursor}`,
  )).status()).toBe(400);
  const preciseDeletionCursor = Buffer.from(JSON.stringify({
    version: 1,
    ownerUserId: me.profile.id,
    locationId,
    view: "deletions",
    createdAt: "2099-09-09T00:00:00.123456+00:00",
    id: "ffffffff-ffff-4fff-bfff-ffffffffffff",
  })).toString("base64url");
  expect((await request.get(
    `/api/lanflow/rubber-exports?locationId=${locationId}&view=deletions&cursor=${preciseDeletionCursor}`,
  )).status()).toBe(200);
  expect((await request.get(`/api/lanflow/acid-stock?locationId=${locationId}&fromDate=2026-09-10&toDate=2026-09-10`)).status()).toBe(200);

  const admin = await browser.newContext({
    storageState: "playwright/.auth/admin.json",
    baseURL: "http://127.0.0.1:3000",
  });
  try {
    expect((await admin.request.get(
      "/api/lanflow/acid-stock?locationId=59000000-0000-4000-8000-000000000099",
    )).status()).toBe(403);
  } finally {
    await admin.close();
  }
});

function stockMovement(index: number) {
  return {
    movementId: `stock-entry:${String(index).padStart(8, "0")}-0000-4000-8000-000000000001`,
    sourceType: "stock_entry",
    sourceLabel: "รับเข้า",
    sourceId: `${String(index).padStart(8, "0")}-0000-4000-8000-000000000001`,
    sourceLineId: null,
    txDate: "2026-09-10",
    locationId: "00000000-0000-4000-8000-000000000101",
    productId: "00000000-0000-4000-8000-000000000201",
    productName: `สินค้าทดสอบ ${index}`,
    quantityDelta: index,
    amount: index * 10,
    displayBillNo: `ST-${String(index).padStart(4, "0")}`,
    txType: "receive",
    createdByName: "ผู้ทดสอบ",
    createdByPhone: "0800000000",
    createdAt: `2026-09-10T${String(12 - Math.floor(index / 10)).padStart(2, "0")}:00:00.000Z`,
    relationLockReason: null,
    reportLockNo: null,
  };
}

function rubberExport(index: number) {
  return {
    id: `${String(index).padStart(8, "0")}-0000-4000-8000-000000000101`,
    exportNo: `REX-UI-${String(index).padStart(3, "0")}`,
    locationId: "00000000-0000-4000-8000-000000000101",
    status: "draft",
    itemCount: 1,
    originalWeightTotal: 100,
    paidTotal: 1000,
    rubberValueTotal: 1000,
    averagePrice: 10,
    currentWeight: null,
    workTotal: null,
    otherOperatingCost: 0,
    createdByName: "ผู้ทดสอบ",
    createdAt: "2026-09-10T01:00:00.000Z",
    soldOutAt: null,
    receiptBillNo: null,
    reportLockNo: null,
    averageAgeHours: 1,
    oldestAgeHours: 2,
    estimatedAgeItemCount: 0,
  };
}

test("Stock tables search, filter, page 10/25/50, and keep mobile overflow inside the table", async ({ page }) => {
  const movementRequests: URL[] = [];
  await page.route(/\/api\/lanflow\/acid-stock\?.*$/, (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "balances") {
      return route.fulfill({ json: { balances: [
        { productId: "p1", name: "น้ำกรดทดสอบ", unit: "ถัง", balance: 125 },
        { productId: "p2", name: "สินค้าหมด", unit: "แพ็ค", balance: 0 },
      ] } });
    }
    movementRequests.push(url);
    const cursor = url.searchParams.get("cursor");
    const search = url.searchParams.get("search");
    const rows = search === "ST-0042"
      ? [stockMovement(42)]
      : cursor ? Array.from({ length: 5 }, (_, index) => stockMovement(index + 51))
      : Array.from({ length: 50 }, (_, index) => stockMovement(index + 1));
    return route.fulfill({ json: {
      movements: rows,
      hasMore: !cursor && search !== "ST-0042",
      nextCursor: !cursor && search !== "ST-0042" ? "next-stock-page" : null,
    } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^สต็อกสินค้า/ }).click();
  await expect(page.getByRole("heading", { name: "ยอดคงเหลือสินค้า" })).toBeVisible();
  await expect(page.getByText("แสดง 1 ถึง 10 จาก 50 รายการที่โหลดแล้ว")).toBeVisible();

  await page.getByLabel("จำนวนแถวต่อหน้า").nth(1).selectOption("25");
  await expect(page.getByText("แสดง 1 ถึง 25 จาก 50 รายการที่โหลดแล้ว")).toBeVisible();
  await page.getByLabel("จำนวนแถวต่อหน้า").nth(1).selectOption("50");
  await page.getByRole("button", { name: "ถัดไป" }).last().click();
  await expect(page.getByText("แสดง 51 ถึง 55 จาก 55 รายการที่โหลดแล้ว")).toBeVisible();
  expect(movementRequests.some((url) => url.searchParams.get("cursor") === "next-stock-page")).toBe(true);

  await page.getByLabel("ค้นหารายการ").fill("ST-0042");
  await expect.poll(() => movementRequests.some((url) => url.searchParams.get("search") === "ST-0042")).toBe(true);
  await expect(page.getByRole("cell", { name: "ST-0042" })).toBeVisible();
  await page.getByRole("button", { name: "ลบรายการสต็อก" }).click();
  await expect(page.getByRole("alertdialog", { name: "ส่งคำขอลบรายการสต็อก" })).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "ยกเลิก" }).click();

  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

});

test("Stock keeps the current page when a requested next cursor returns no rows", async ({ page }) => {
  let requestedEmptyPage = false;
  await page.route(/\/api\/lanflow\/acid-stock\?.*$/, (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "balances") {
      return route.fulfill({ json: { balances: [] } });
    }
    const cursor = url.searchParams.get("cursor");
    if (cursor) requestedEmptyPage = true;
    return route.fulfill({ json: {
      movements: cursor ? [] : Array.from({ length: 50 }, (_, index) => stockMovement(index + 1)),
      hasMore: !cursor,
      nextCursor: cursor ? null : "empty-stock-page",
    } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^สต็อกสินค้า/ }).click();
  await page.getByLabel("จำนวนแถวต่อหน้า").nth(1).selectOption("50");
  await page.getByRole("button", { name: "ถัดไป" }).last().click();

  await expect.poll(() => requestedEmptyPage).toBe(true);
  await expect(page.getByText("มีรายการเก่ากว่านี้")).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "ST-0001" })).toBeVisible();
  await expect(page.getByText("แสดง 1 ถึง 50 จาก 50 รายการที่โหลดแล้ว")).toBeVisible();
});

test("Rubber Export sends debounced search and status filter and paginates loaded rows", async ({ page }) => {
  const listRequests: URL[] = [];
  await page.route(/\/api\/lanflow\/rubber-exports\?.*$/, (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "deletions") {
      return route.fulfill({ json: { deletions: [], hasMore: false, nextCursor: null } });
    }
    listRequests.push(url);
    const search = url.searchParams.get("search");
    const rows = search === "REX-UI-042" ? [rubberExport(42)] : Array.from({ length: 50 }, (_, index) => rubberExport(index + 1));
    return route.fulfill({ json: {
      exports: rows,
      permissions: { canVerify: true, canDelete: true },
      hasMore: false,
      nextCursor: null,
    } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^ส่งออกยาง/ }).click();
  await expect(page.getByText("แสดง 1 ถึง 10 จาก 50 รายการที่โหลดแล้ว")).toBeVisible();
  await page.getByLabel("จำนวนแถวต่อหน้า").selectOption("25");
  await expect(page.getByText("แสดง 1 ถึง 25 จาก 50 รายการที่โหลดแล้ว")).toBeVisible();

  await page.getByLabel("ค้นหารายการส่งออก").fill("REX-UI-042");
  await expect.poll(() => listRequests.some((url) => url.searchParams.get("search") === "REX-UI-042")).toBe(true);
  await expect(page.getByRole("cell", { name: /^REX-UI-042 / })).toBeVisible();
  await page.getByLabel("กรองสถานะ").selectOption("draft");
  await expect.poll(() => listRequests.some((url) => url.searchParams.get("subfilter") === "draft")).toBe(true);

  await page.setViewportSize({ width: 393, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Rubber Export ignores a stale search response after the request scope changes", async ({ page }) => {
  let oldRequestStarted = false;
  let releaseOldRequest: () => void = () => {};
  const oldRequestGate = new Promise<void>((resolve) => {
    releaseOldRequest = () => resolve();
  });

  await page.route(/\/api\/lanflow\/rubber-exports\?.*$/, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "deletions") {
      return route.fulfill({ json: { deletions: [], hasMore: false, nextCursor: null } });
    }
    const search = url.searchParams.get("search");
    if (search === "REX-OLD") {
      oldRequestStarted = true;
      await oldRequestGate;
      await route.fulfill({ json: {
        exports: [{ ...rubberExport(901), exportNo: "REX-OLD" }],
        permissions: { canVerify: true, canDelete: true },
        hasMore: false,
        nextCursor: null,
      } }).catch(() => undefined);
      return;
    }
    const exports = search === "REX-NEW"
      ? [{ ...rubberExport(902), exportNo: "REX-NEW" }]
      : [];
    return route.fulfill({ json: {
      exports,
      permissions: { canVerify: true, canDelete: true },
      hasMore: false,
      nextCursor: null,
    } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^ส่งออกยาง/ }).click();
  await page.getByLabel("ค้นหารายการส่งออก").fill("REX-OLD");
  await expect.poll(() => oldRequestStarted).toBe(true);
  await page.getByLabel("ค้นหารายการส่งออก").fill("REX-NEW");
  await expect(page.getByRole("cell", { name: /^REX-NEW / })).toBeVisible();
  releaseOldRequest();
  await expect(page.getByText("REX-OLD", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: /^REX-NEW / })).toBeVisible();
});

test("Rubber Export keeps the current page when a requested next cursor returns no rows", async ({ page }) => {
  await page.route(/\/api\/lanflow\/rubber-exports\?.*$/, (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "deletions") {
      return route.fulfill({ json: { deletions: [], hasMore: false, nextCursor: null } });
    }
    const cursor = url.searchParams.get("cursor");
    return route.fulfill({ json: {
      exports: cursor ? [] : Array.from({ length: 50 }, (_, index) => rubberExport(index + 1)),
      permissions: { canVerify: true, canDelete: true },
      hasMore: !cursor,
      nextCursor: cursor ? null : "empty-rubber-export-page",
    } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^ส่งออกยาง/ }).click();
  await page.getByLabel("จำนวนแถวต่อหน้า").selectOption("50");
  await page.getByRole("button", { name: "ถัดไป" }).click();

  await expect(page.getByRole("cell", { name: /^REX-UI-001 / })).toBeVisible();
  await expect(page.getByText("แสดง 1 ถึง 50 จาก 50 รายการที่โหลดแล้ว")).toBeVisible();
});

test("Rubber Export returns to a valid page when refresh shrinks the loaded result", async ({ page }) => {
  let firstPageRequests = 0;
  let shrinkFirstPage = false;
  await page.route(/\/api\/lanflow\/rubber-exports\?.*$/, (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "deletions") {
      return route.fulfill({ json: { deletions: [], hasMore: false, nextCursor: null } });
    }
    const cursor = url.searchParams.get("cursor");
    if (!cursor) firstPageRequests += 1;
    return route.fulfill({ json: {
      exports: cursor
        ? Array.from({ length: 5 }, (_, index) => rubberExport(index + 51))
        : Array.from({ length: 50 }, (_, index) => rubberExport(index + 1)),
      permissions: { canVerify: true, canDelete: true },
      hasMore: !cursor && !shrinkFirstPage,
      nextCursor: !cursor && !shrinkFirstPage ? "next-rubber-export-page" : null,
    } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^ส่งออกยาง/ }).click();
  await page.getByLabel("จำนวนแถวต่อหน้า").selectOption("50");
  await page.getByRole("button", { name: "ถัดไป" }).click();
  await expect(page.getByRole("cell", { name: /^REX-UI-051 / })).toBeVisible();

  shrinkFirstPage = true;
  const requestsBeforeRefresh = firstPageRequests;
  await page.getByRole("button", { name: "รีเฟรช" }).click();

  await expect.poll(() => firstPageRequests).toBeGreaterThan(requestsBeforeRefresh);
  await expect(page.getByRole("cell", { name: /^REX-UI-001 / })).toBeVisible();
  await expect(page.getByText("แสดง 1 ถึง 50 จาก 50 รายการที่โหลดแล้ว")).toBeVisible();
});

test("Rubber Export clears load-more state when refresh supersedes the cursor request", async ({ page }) => {
  let cursorRequestStarted = false;
  let releaseCursorRequest: () => void = () => {};
  const cursorGate = new Promise<void>((resolve) => {
    releaseCursorRequest = resolve;
  });

  await page.route(/\/api\/lanflow\/rubber-exports\?.*$/, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "deletions") {
      return route.fulfill({ json: { deletions: [], hasMore: false, nextCursor: null } });
    }
    if (url.searchParams.has("cursor")) {
      cursorRequestStarted = true;
      await cursorGate;
      await route.fulfill({ json: {
        exports: Array.from({ length: 5 }, (_, index) => rubberExport(index + 51)),
        permissions: { canVerify: true, canDelete: true },
        hasMore: false,
        nextCursor: null,
      } }).catch(() => undefined);
      return;
    }
    return route.fulfill({ json: {
      exports: Array.from({ length: 50 }, (_, index) => rubberExport(index + 1)),
      permissions: { canVerify: true, canDelete: true },
      hasMore: true,
      nextCursor: "delayed-rubber-export-page",
    } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^ส่งออกยาง/ }).click();
  await page.getByLabel("จำนวนแถวต่อหน้า").selectOption("50");
  await page.getByRole("button", { name: "ถัดไป" }).click();
  await expect.poll(() => cursorRequestStarted).toBe(true);

  await page.getByRole("button", { name: "รีเฟรช" }).click();

  await expect(page.getByRole("button", { name: "ถัดไป" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "กำลังโหลด..." })).toHaveCount(0);
  releaseCursorRequest();
});

test("Rubber Export does not load an operational list while viewing deletion history", async ({ page }) => {
  const listRequests: URL[] = [];
  let deletionRequestSeen = false;
  await page.route(/\/api\/lanflow\/rubber-exports\?.*$/, (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "deletions") {
      deletionRequestSeen = true;
      return route.fulfill({ json: { deletions: [], hasMore: false, nextCursor: null } });
    }
    listRequests.push(url);
    const view = url.searchParams.get("view") ?? "active";
    const subfilter = url.searchParams.get("subfilter") ?? "all";
    const invalid = view === "active" && ["sold", "received"].includes(subfilter);
    return route.fulfill({
      status: invalid ? 400 : 200,
      json: invalid
        ? { error: "พารามิเตอร์รายการส่งออกไม่ถูกต้อง" }
        : {
            exports: Array.from({ length: 2 }, (_, index) => rubberExport(index + 1)),
            permissions: { canVerify: true, canDelete: true },
            hasMore: false,
            nextCursor: null,
          },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^ส่งออกยาง/ }).click();
  await page.getByRole("button", { name: "ประวัติ", exact: true }).click();
  await page.getByLabel("กรองสถานะ").selectOption("sold");
  await expect.poll(() => listRequests.some((url) => (
    url.searchParams.get("view") === "history" && url.searchParams.get("subfilter") === "sold"
  ))).toBe(true);
  const requestCountBeforeDeletionView = listRequests.length;

  await page.getByRole("button", { name: "ประวัติการลบ", exact: true }).click();

  await expect.poll(() => deletionRequestSeen).toBe(true);
  await page.waitForTimeout(100);
  expect(listRequests).toHaveLength(requestCountBeforeDeletionView);
  await expect(page.getByText("พารามิเตอร์รายการส่งออกไม่ถูกต้อง")).toHaveCount(0);
});

test("Rubber Export retains known permissions after refresh failure and clears list errors in deletion history", async ({ page }) => {
  let failList = false;
  await page.route(/\/api\/lanflow\/rubber-exports\?.*$/, (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "deletions") {
      return route.fulfill({ json: { deletions: [], hasMore: false, nextCursor: null } });
    }
    if (failList) {
      return route.fulfill({ status: 500, json: { error: "LIST_REFRESH_FAILED" } });
    }
    return route.fulfill({ json: {
      exports: [rubberExport(1)],
      permissions: { canVerify: true, canDelete: true },
      hasMore: false,
      nextCursor: null,
    } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^ส่งออกยาง/ }).click();
  await expect(page.getByRole("button", { name: "ประวัติการลบ", exact: true })).toBeVisible();

  failList = true;
  await page.getByRole("button", { name: "รีเฟรช" }).click();
  await expect(page.getByText("LIST_REFRESH_FAILED")).toBeVisible();
  await expect(page.getByRole("button", { name: "ประวัติการลบ", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "ประวัติการลบ", exact: true }).click();
  await expect(page.getByText("LIST_REFRESH_FAILED")).toHaveCount(0);
  await expect(page.getByText("ยังไม่มีประวัติการลบรายการส่งออกยาง")).toBeVisible();
});
