import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test.use({ storageState: "playwright/.auth/super_admin.json" });

test("real Bearer identity overrides another account's cookies and preserves branch access", async ({ request, playwright }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  expect(["localhost", "127.0.0.1"]).toContain(new URL(url).hostname);
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword({ phone: "+66810000001", password: process.env.TEST_PASSWORD ?? "password123" });
  expect(signedIn.error).toBeNull();
  const token = signedIn.data.session!.access_token;
  const actorId = signedIn.data.user!.id;
  const cookieMe = await request.get("/api/auth/me");
  expect((await cookieMe.json()).profile.id).not.toBe(actorId);
  const bare = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3000" });
  try {
    let locationIds: string[] = [];
    for (const context of [request, bare]) {
      for (const scheme of ["Bearer", "bearer", "BEARER", "bEaReR"]) {
        const response = await context.get("/api/auth/me", { headers: { authorization: `${scheme} ${token}` } });
        expect(response.status()).toBe(200);
        const profile = (await response.json()).profile;
        expect(profile.id).toBe(actorId);
        expect(profile.role).toBe("admin");
        if (locationIds.length) expect(profile.locationIds).toEqual(locationIds);
        locationIds = profile.locationIds;
        const forbidden = await context.get(`/api/lanflow/rubber-bills/feed?locationId=${crypto.randomUUID()}`, {
          headers: { authorization: `${scheme} ${token}` },
        });
        expect(forbidden.status()).toBe(403);
      }
    }
    expect(locationIds.length).toBeGreaterThan(0);
    const feed = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationIds[0]}&limit=1`, {
      headers: { authorization: `bearer ${token}` },
    });
    expect(feed.status()).toBe(200);
    for (const authorization of ["Bearer", "Basic ignored", "Bearer invalid-token"]) {
      const denied = await request.get("/api/auth/me", { headers: { authorization } });
      expect(denied.status()).toBe(401);
    }
  } finally {
    await bare.dispose();
  }
});
