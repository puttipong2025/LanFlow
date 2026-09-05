import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const LANFLOW_API = path.join(ROOT, "src", "app", "api", "lanflow");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const userId = "00000000-0000-4000-8000-000000000003";

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(entryPath);
    return entry.name === "route.ts" ? [entryPath] : [];
  });
}

test("all LanFlow API routes use the shared authorization boundary", () => {
  const files = routeFiles(LANFLOW_API);
  expect(files).toHaveLength(72);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    expect(source, path.relative(ROOT, file)).toMatch(
      /requireAuth\(|requireRole\(|requireRoleOrSystemManager\(|requireSystemManager\(/,
    );
  }
});

test("User allowlist contains only bootstrap and time/payroll self-service routes", () => {
  const allowed = routeFiles(LANFLOW_API).filter((file) =>
    readFileSync(file, "utf8").includes("allowUserLanflow: true")
  ).map((file) => path.relative(LANFLOW_API, file).replaceAll("\\", "/")).sort();

  expect(allowed).toEqual([
    "route.ts",
    "time-tracking/documents/[sourceType]/[id]/route.ts",
    "time-tracking/user/route.ts",
  ]);
});

test("User shell is selected before business hooks and clears stale business state", () => {
  const source = readFileSync(path.join(ROOT, "src", "components", "LanFlowApp.tsx"), "utf8");
  expect(source.indexOf('auth.profile?.role === "user"')).toBeLessThan(
    source.indexOf("function BusinessLanFlowApp"),
  );
  expect(source).toContain("removeSyncEventsForOwner(data.profile.id)");
  expect(source).toContain("clearBusinessBootstrapCache(data.profile.id)");
  expect(source).toContain("<TimeTrackingModule profile={profile} online={online} locations={[]} />");
  expect(source.indexOf("if (!online)")).toBeLessThan(
    source.indexOf("<TimeTrackingModule profile={profile} online={online} locations={[]} />"),
  );
  expect(source).toContain("if (!profile.primaryLocationId)");
  expect(source.indexOf("function BusinessLanFlowApp")).toBeLessThan(
    source.indexOf("useLanFlowOfflineSyncCoordinator({"),
  );
});

test.describe.serial("User runtime boundary", () => {
  test.use({ storageState: "playwright/.auth/user.json" });

  test("allows self-service APIs and rejects business APIs", async ({ request }) => {
    const bootstrap = await request.get("/api/lanflow");
    expect(bootstrap.status()).toBe(200);
    expect((await bootstrap.json()).locations).toEqual([]);

    expect((await request.get("/api/lanflow/time-tracking/user?month=2026-09")).status()).toBe(200);
    expect((await request.get("/api/lanflow/dashboard")).status()).toBe(403);
    expect((await request.post("/api/lanflow/acid-stock", { data: {} })).status()).toBe(403);
  });

  test("renders only the time and payroll shell", async ({ page }) => {
    const businessRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (
        pathname.startsWith("/api/lanflow/")
        && !pathname.startsWith("/api/lanflow/time-tracking/user")
      ) {
        businessRequests.push(pathname);
      }
    });

    await page.goto("/?tab=rubber-evidence&bill=11111111-1111-4111-8111-111111111111");
    await expect(page.getByRole("heading", { name: "เวลาและเงินเดือน" })).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page).not.toHaveURL(/tab=rubber-evidence|bill=/);
    expect(businessRequests).toEqual([]);
  });

  test("keeps an offline User in the unavailable shell without self-service requests", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "ต้องเชื่อมต่ออินเทอร์เน็ต" })).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    expect(requests).not.toContain("/api/lanflow/time-tracking/user");
  });

  test("keeps self-service available when stale business queue cleanup fails", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", {
        configurable: true,
        value: undefined,
      });
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "ระบบเวลาและเงินเดือน (ของตนเอง)" }))
      .toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "โหลดสิทธิ์ไม่สำเร็จ" })).toHaveCount(0);
  });

  test("blocks a User whose active primary assignment is missing", async ({ browser }) => {
    expect(serviceRoleKey).toBeTruthy();
    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const original = await service
      .from("user_locations")
      .select("location_id, is_primary")
      .eq("user_id", userId);
    expect(original.error).toBeNull();
    expect((await service.from("user_locations").delete().eq("user_id", userId)).error).toBeNull();

    const context = await browser.newContext({ storageState: "playwright/.auth/user.json" });
    try {
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "ยังไม่ได้กำหนดสาขาหลัก" }))
        .toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("navigation")).toHaveCount(0);
    } finally {
      if ((original.data?.length ?? 0) > 0) {
        expect((await service.from("user_locations").insert(original.data!.map((assignment) => ({
          user_id: userId,
          location_id: assignment.location_id,
          is_primary: assignment.is_primary,
        })))).error).toBeNull();
      }
      await context.close();
    }
  });
});
