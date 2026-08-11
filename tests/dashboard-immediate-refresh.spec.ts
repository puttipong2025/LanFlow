import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DashboardSummary } from "@/types/dashboard";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const password = process.env.TEST_PASSWORD ?? "password123";

type RefreshSnapshot = {
  status: "dirty" | "queued" | "running" | "ready" | "failed";
  sourceVersion: number;
  snapshotVersion: number;
  requestedVersion?: number;
  claimedVersion?: number | null;
  summary: unknown;
};

const summary: DashboardSummary = {
  purchaseToday: {
    billCount: 0,
    netWeight: 0,
    averagePrice: null,
    rubberValue: 0,
    deductionTotal: 0,
    unpricedBillCount: 0,
    pendingApprovalCount: 0,
    paidTotal: 0,
  },
  rubberRemaining: {
    billCount: 0,
    netWeight: 0,
    averagePrice: null,
    rubberValue: 0,
    deductionTotal: 0,
    unpricedBillCount: 0,
    pendingApprovalCount: 0,
  },
  cashToday: { income: 0, expense: 0, net: 0 },
  purchase7Days: {
    paidTotal: 0,
    dailyAverage: 0,
    netWeight: 0,
    averageCostPerKg: null,
  },
  netCashFlow: 0,
  operatingExpenseAccumulated: 0,
  payablePurchaseAccumulated: 0,
  operatingBurdenPercent: null,
  rubberInventoryWeight: 0,
  waterLoss7Days: { exportCount: 0, weight: 0, percent: null },
  stock: { inStockCount: 0, outOfStockCount: 0, items: [] },
};

const legacySummary = {
  purchaseToday: { billCount: 0, netWeight: 0, paidTotal: 0 },
  purchase7Days: summary.purchase7Days,
  netCashFlow: 0,
  operatingExpenseAccumulated: 0,
  payablePurchaseAccumulated: 0,
  operatingBurdenPercent: null,
  rubberInventoryWeight: 0,
  waterLoss7Days: summary.waterLoss7Days,
  stock: summary.stock,
};

function snapshot(
  status: RefreshSnapshot["status"],
  snapshotVersion: number,
) {
  return {
    status,
    sourceVersion: 2,
    snapshotVersion,
    summary,
    calculatedAt: "2026-08-02T05:00:00.000Z",
    manualRequestedAt:
      status === "queued" || status === "running"
        ? "2026-08-02T05:01:00.000Z"
        : null,
    lastError: status === "failed" ? "คำนวณ Dashboard ไม่สำเร็จ" : null,
  };
}

function service() {
  expect(serviceRoleKey).toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedIn(phone: string) {
  expect(publishableKey).toBeTruthy();
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ phone, password });
  expect(error).toBeNull();
  return client;
}

async function finishRefresh(
  client: SupabaseClient,
  locationId: string,
  requestedVersion: number,
) {
  const claimResult = await client.rpc("claim_dashboard_refresh_now", {
    p_location_id: locationId,
    p_requested_version: requestedVersion,
  });
  expect(claimResult.error).toBeNull();
  let snapshot = claimResult.data as RefreshSnapshot;
  if (snapshot.snapshotVersion >= requestedVersion) return snapshot;

  expect(snapshot.status).toBe("running");
  expect(Number(snapshot.claimedVersion)).toBeGreaterThanOrEqual(
    requestedVersion,
  );
  const rebuildResult = await client.rpc("rebuild_dashboard_refresh_now", {
    p_location_id: locationId,
    p_claimed_version: snapshot.claimedVersion,
  });
  expect(rebuildResult.error).toBeNull();
  snapshot = rebuildResult.data as RefreshSnapshot;
  return snapshot;
}

test.describe.serial("Dashboard immediate manual refresh", () => {
  test("keeps manager config restricted and scopes Admin refresh by branch", async () => {
    const db = service();
    const admin = await signedIn("+66810000001");
    const user = await signedIn("+66820000001");
    const manager = await signedIn("+66800000000");
    const marker = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
    const unassignedLocationId = crypto.randomUUID();
    const inactiveLocationId = crypto.randomUUID();

    const assignment = await db
      .from("user_locations")
      .select("location_id")
      .eq("user_id", "00000000-0000-4000-8000-000000000002")
      .limit(1)
      .single();
    expect(assignment.error).toBeNull();
    const assignedLocationId = assignment.data!.location_id;

    try {
      expect(
        (
          await db.from("locations").insert([
            {
              id: unassignedLocationId,
              name: `Dashboard unassigned ${marker}`,
              code: `DU${marker}`.slice(0, 12),
              is_active: true,
            },
            {
              id: inactiveLocationId,
              name: `Dashboard inactive ${marker}`,
              code: `DI${marker}`.slice(0, 12),
              is_active: false,
            },
          ])
        ).error,
      ).toBeNull();

      const adminConfig = await admin.rpc("get_dashboard_refresh_settings");
      expect(adminConfig.error).not.toBeNull();

      const userQueue = await user.rpc("queue_dashboard_refresh", {
        p_location_id: assignedLocationId,
      });
      expect(userQueue.error).not.toBeNull();

      const unassignedQueue = await admin.rpc("queue_dashboard_refresh", {
        p_location_id: unassignedLocationId,
      });
      expect(unassignedQueue.error).not.toBeNull();

      const inactiveQueue = await manager.rpc("queue_dashboard_refresh", {
        p_location_id: inactiveLocationId,
      });
      expect(inactiveQueue.error).not.toBeNull();

      const adminQueue = await admin.rpc("queue_dashboard_refresh", {
        p_location_id: assignedLocationId,
      });
      expect(adminQueue.error).toBeNull();
      const adminQueued = adminQueue.data as RefreshSnapshot;
      expect(adminQueued.status).toBe("queued");
      expect(adminQueued.requestedVersion).toBe(adminQueued.sourceVersion);

      const duplicateQueue = await admin.rpc("queue_dashboard_refresh", {
        p_location_id: assignedLocationId,
      });
      expect(duplicateQueue.error).toBeNull();
      expect(
        (duplicateQueue.data as RefreshSnapshot).requestedVersion,
      ).toBe(adminQueued.requestedVersion);

      const startedAt = Date.now();
      const completed = await finishRefresh(
        admin,
        assignedLocationId,
        adminQueued.requestedVersion!,
      );
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      expect(completed.snapshotVersion).toBeGreaterThanOrEqual(
        adminQueued.requestedVersion!,
      );
      expect(completed.summary).not.toBeNull();

      const managerQueue = await manager.rpc("queue_dashboard_refresh", {
        p_location_id: unassignedLocationId,
      });
      expect(managerQueue.error).toBeNull();
      const managerQueued = managerQueue.data as RefreshSnapshot;
      const managerCompleted = await finishRefresh(
        manager,
        unassignedLocationId,
        managerQueued.requestedVersion!,
      );
      expect(managerCompleted.snapshotVersion).toBeGreaterThanOrEqual(
        managerQueued.requestedVersion!,
      );
    } finally {
      await db
        .from("dashboard_branch_snapshots")
        .delete()
        .in("location_id", [unassignedLocationId, inactiveLocationId]);
      await db
        .from("dashboard_alert_thresholds")
        .delete()
        .in("location_id", [unassignedLocationId, inactiveLocationId]);
      await db
        .from("locations")
        .delete()
        .in("id", [unassignedLocationId, inactiveLocationId]);
    }
  });

  test("preserves target-version completion when newer source data arrives", async () => {
    const db = service();
    const admin = await signedIn("+66810000001");
    const assignment = await db
      .from("user_locations")
      .select("location_id")
      .eq("user_id", "00000000-0000-4000-8000-000000000002")
      .limit(1)
      .single();
    expect(assignment.error).toBeNull();
    const locationId = assignment.data!.location_id;

    const queuedResult = await admin.rpc("queue_dashboard_refresh", {
      p_location_id: locationId,
    });
    expect(queuedResult.error).toBeNull();
    const queued = queuedResult.data as RefreshSnapshot;
    const claimResult = await admin.rpc("claim_dashboard_refresh_now", {
      p_location_id: locationId,
      p_requested_version: queued.requestedVersion,
    });
    expect(claimResult.error).toBeNull();
    const claimed = claimResult.data as RefreshSnapshot;
    expect(claimed.status).toBe("running");

    expect(
      (
        await db
          .from("dashboard_branch_snapshots")
          .update({ source_version: claimed.sourceVersion + 1 })
          .eq("location_id", locationId)
      ).error,
    ).toBeNull();

    const rebuildResult = await admin.rpc("rebuild_dashboard_refresh_now", {
      p_location_id: locationId,
      p_claimed_version: claimed.claimedVersion,
    });
    expect(rebuildResult.error).toBeNull();
    const rebuilt = rebuildResult.data as RefreshSnapshot;
    expect(rebuilt.snapshotVersion).toBeGreaterThanOrEqual(
      queued.requestedVersion!,
    );
    expect(rebuilt.sourceVersion).toBeGreaterThan(rebuilt.snapshotVersion);
    expect(rebuilt.status).toBe("dirty");
  });
});

test.describe("Dashboard immediate refresh UI", () => {
  test.use({ storageState: "playwright/.auth/admin.json" });

  test("polls a dirty legacy snapshot until the new summary contract is ready", async ({
    page,
  }) => {
    let snapshotRequests = 0;
    await page.route("**/api/lanflow/dashboard/feed**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          selectedDate: "2026-08-12",
          availableFrom: "2026-07-29",
          availableTo: "2026-08-12",
          counts: { all: 0, create: 0, update: 0, delete: 0 },
          latestAt: null,
          rows: [],
          nextCursor: null,
        }),
      }),
    );
    await page.route("**/api/lanflow/dashboard/snapshot**", (route) => {
      snapshotRequests += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          snapshotRequests <= 2
            ? { ...snapshot("dirty", 1), summary: legacySummary }
            : snapshot("ready", 2),
        ),
      });
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: /กำลังเตรียม Dashboard/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("ภาพรวมบิลยาง", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    expect(snapshotRequests).toBeGreaterThan(1);
  });

  test("renders four compact trend cards with empty, signed-weight, and stock overflow states", async ({
    page,
  }) => {
    let renderedSummary = summary;
    const trendLabels = [
      "ยอดซื้อยางเฉลี่ย 7 วัน",
      "ต้นทุนซื้อเฉลี่ย 7 วัน",
      "ภาระดำเนินงานต่อยอดซื้อสะสม",
      "น้ำหนักสูญเสีย 7 วัน",
      "สต็อกสินค้า",
    ];

    await page.route("**/api/lanflow/dashboard/feed**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          selectedDate: "2026-08-12",
          availableFrom: "2026-07-29",
          availableTo: "2026-08-12",
          counts: { all: 0, create: 0, update: 0, delete: 0 },
          latestAt: null,
          rows: [],
          nextCursor: null,
        }),
      }),
    );
    await page.route("**/api/lanflow/dashboard/snapshot**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...snapshot("ready", 2),
          summary: renderedSummary,
        }),
      }),
    );

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "แนวโน้มและการดำเนินงาน" }),
    ).toBeVisible({ timeout: 15_000 });

    const cards = trendLabels.map((label) =>
      page.getByRole("region", { name: label })
    );
    for (const card of cards) await expect(card).toBeVisible();
    await expect(cards[0].getByText("฿0", { exact: true })).toBeVisible();
    await expect(cards[1].getByText("—", { exact: true })).toBeVisible();
    await expect(cards[2].getByText("—", { exact: true })).toBeVisible();
    await expect(cards[3].getByText("ไม่มีรายการส่งออก", { exact: true })).toBeVisible();
    await expect(cards[4].getByText("0 ชนิด", { exact: true })).toBeVisible();
    await expect(cards[4].getByText("ยังไม่มีสินค้า", { exact: true })).toBeVisible();
    await expect(page.getByText(/^สูตร:/)).toHaveCount(5);

    const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
    expect(boxes.every(Boolean)).toBeTruthy();
    const firstBox = boxes[0]!;
    for (const box of boxes.slice(1, 4)) {
      expect(Math.abs(box!.y - firstBox.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(box!.width - firstBox.width)).toBeLessThanOrEqual(1);
    }
    for (const box of boxes.slice(0, 4)) {
      expect(box!.height).toBeLessThan(boxes[4]!.height);
    }

    await page.setViewportSize({ width: 900, height: 1000 });
    const tabletBoxes = await Promise.all(cards.map((card) => card.boundingBox()));
    expect(Math.abs(tabletBoxes[0]!.y - tabletBoxes[1]!.y)).toBeLessThanOrEqual(1);
    expect(tabletBoxes[2]!.y).toBeGreaterThan(tabletBoxes[0]!.y);
    expect(Math.abs(tabletBoxes[2]!.x - tabletBoxes[0]!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(tabletBoxes[0]!.width - tabletBoxes[1]!.width))
      .toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 390, height: 1000 });
    const mobileBoxes = await Promise.all(cards.map((card) => card.boundingBox()));
    for (let index = 1; index < mobileBoxes.length; index += 1) {
      expect(mobileBoxes[index]!.y).toBeGreaterThan(mobileBoxes[index - 1]!.y);
      expect(Math.abs(mobileBoxes[index]!.width - mobileBoxes[0]!.width))
        .toBeLessThanOrEqual(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390);

    renderedSummary = {
      ...summary,
      waterLoss7Days: { exportCount: 2, weight: -15, percent: -5 },
      stock: {
        inStockCount: 9,
        outOfStockCount: 1,
        items: Array.from({ length: 10 }, (_, index) => ({
          productId: `product-${index}`,
          name: `สินค้าทดสอบ ${index + 1}`,
          unit: index % 2 === 0 ? "แผ่น" : "ลิตร",
          balance: index === 0 ? 0 : index + 1,
        })),
      },
    };
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "ภาพรวม", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "แนวโน้มและการดำเนินงาน" }),
    ).toBeVisible({ timeout: 15_000 });

    const waterCard = page.getByRole("region", { name: "น้ำหนักสูญเสีย 7 วัน" });
    await expect(waterCard.getByText("น้ำหนักเพิ่ม 15 กก.", { exact: true })).toBeVisible();
    await expect(waterCard.getByText("เพิ่ม 5% · 2 เที่ยว", { exact: true })).toBeVisible();
    const stockCard = page.getByRole("region", { name: "สต็อกสินค้า" });
    await expect(stockCard.getByText("9 ชนิด", { exact: true })).toBeVisible();
    await expect(stockCard.getByText("หมด 1 ชนิด", { exact: true })).toBeVisible();
    await expect(stockCard.getByText("สินค้าทดสอบ 1", { exact: true })).toBeVisible();
    await expect(stockCard.getByText("0 แผ่น", { exact: true })).toBeVisible();
    const stockList = page.getByLabel("ยอดคงเหลือแยกรายสินค้า");
    expect(await stockList.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(1440);
  });

  test("shows Admin only the branch refresh control and succeeds at the target version", async ({
    page,
  }) => {
    let refreshRequested = false;
    let snapshotPoll = 0;
    let configRequests = 0;

    await page.route("**/api/lanflow/dashboard/config**", async (route) => {
      configRequests += 1;
      await route.fulfill({ status: 403, body: "{}" });
    });
    await page.route("**/api/lanflow/dashboard/feed**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          selectedDate: "2026-08-02",
          availableFrom: "2026-07-19",
          availableTo: "2026-08-02",
          counts: { all: 0, create: 0, update: 0, delete: 0 },
          latestAt: null,
          rows: [],
          nextCursor: null,
        }),
      }),
    );
    await page.route("**/api/lanflow/dashboard/snapshot**", (route) => {
      if (!refreshRequested) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(snapshot("ready", 1)),
        });
      }
      snapshotPoll += 1;
      const next =
        snapshotPoll === 1
          ? snapshot("queued", 1)
          : snapshotPoll === 2
            ? snapshot("running", 1)
            : snapshot("ready", 2);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(next),
      });
    });
    await page.route("**/api/lanflow/dashboard/refresh", async (route) => {
      refreshRequested = true;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          ...snapshot("queued", 1),
          requestedVersion: 2,
        }),
      });
    });

    await page.goto("/");
    const refreshButton = page.getByRole("button", {
      name: "คำนวณสาขานี้ใหม่",
      exact: true,
    });
    await expect(refreshButton).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("รอบคำนวณกลางทั้งระบบ (นาที)", { exact: true }),
    ).toHaveCount(0);
    expect(configRequests).toBe(0);

    await refreshButton.click();
    await expect(
      page.getByRole("button", { name: "กำลังคำนวณ…", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("คำนวณ Dashboard ใหม่สำเร็จแล้ว", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(refreshButton).toBeEnabled();
    expect(snapshotPoll).toBeGreaterThanOrEqual(3);
  });

  test("keeps the previous result and re-enables retry after failure", async ({
    page,
  }) => {
    let refreshRequested = false;

    await page.route("**/api/lanflow/dashboard/feed**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          selectedDate: "2026-08-02",
          availableFrom: "2026-07-19",
          availableTo: "2026-08-02",
          counts: { all: 0, create: 0, update: 0, delete: 0 },
          latestAt: null,
          rows: [],
          nextCursor: null,
        }),
      }),
    );
    await page.route("**/api/lanflow/dashboard/snapshot**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          refreshRequested ? snapshot("failed", 1) : snapshot("ready", 1),
        ),
      }),
    );
    await page.route("**/api/lanflow/dashboard/refresh", async (route) => {
      refreshRequested = true;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          ...snapshot("queued", 1),
          requestedVersion: 2,
        }),
      });
    });

    await page.goto("/");
    const refreshButton = page.getByRole("button", {
      name: "คำนวณสาขานี้ใหม่",
      exact: true,
    });
    await expect(refreshButton).toBeVisible({ timeout: 15_000 });
    await refreshButton.click();
    await expect(
      page.locator("#dashboard-refresh-status"),
    ).toHaveText("คำนวณ Dashboard ไม่สำเร็จ", {
      timeout: 10_000,
    });
    await expect(
      page.getByText("คำนวณ Dashboard ไม่สำเร็จ", { exact: true }).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(refreshButton).toBeEnabled();
    await expect(page.getByText("ภาพรวมบิลยาง", { exact: true })).toBeVisible();
  });

  test("warns after two minutes without cancelling a running refresh", async ({
    page,
  }) => {
    let refreshRequested = false;
    await page.clock.install({ time: new Date("2026-08-02T05:00:00.000Z") });

    await page.route("**/api/lanflow/dashboard/feed**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          selectedDate: "2026-08-02",
          availableFrom: "2026-07-19",
          availableTo: "2026-08-02",
          counts: { all: 0, create: 0, update: 0, delete: 0 },
          latestAt: null,
          rows: [],
          nextCursor: null,
        }),
      }),
    );
    await page.route("**/api/lanflow/dashboard/snapshot**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          refreshRequested ? snapshot("running", 1) : snapshot("ready", 1),
        ),
      }),
    );
    await page.route("**/api/lanflow/dashboard/refresh", async (route) => {
      refreshRequested = true;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          ...snapshot("queued", 1),
          requestedVersion: 2,
        }),
      });
    });

    await page.goto("/");
    await page
      .getByRole("button", { name: "คำนวณสาขานี้ใหม่", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "กำลังคำนวณ…", exact: true }),
    ).toBeDisabled();

    await page.clock.fastForward(120_001);
    await expect(
      page.getByText("ใช้เวลานานกว่าปกติ ระบบยังคำนวณอยู่", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "กำลังคำนวณ…", exact: true }),
    ).toBeDisabled();
  });
});
