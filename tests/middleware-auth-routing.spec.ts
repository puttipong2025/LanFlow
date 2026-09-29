import { expect, test } from "@playwright/test";

test("keeps public assets public and redirects anonymous pages to login", async ({
  playwright,
}) => {
  const anonymous = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:3000",
  });

  try {
    for (const publicPath of [
      "/favicon.ico",
      "/icon.svg",
      "/icons/icon.svg",
      "/login",
      "/offline.html",
      "/manifest.json",
      "/fonts/NotoSansThai-Regular.ttf",
    ]) {
      const response = await anonymous.get(publicPath, { maxRedirects: 0 });
      expect(response.status(), publicPath).toBe(200);
    }

    // next-pwa generates this file during a production build, so a clean dev
    // checkout may return 404. Either response proves middleware did not turn
    // the public service worker request into an authentication redirect.
    const serviceWorkerResponse = await anonymous.get("/sw.js", { maxRedirects: 0 });
    expect([200, 404], "/sw.js").toContain(serviceWorkerResponse.status());

    const pageResponse = await anonymous.get("/", { maxRedirects: 0 });
    expect(pageResponse.status()).toBe(307);
    expect(new URL(pageResponse.headers().location, "http://127.0.0.1:3000").pathname)
      .toBe("/login");

    const apiResponse = await anonymous.get("/api/auth/me", { maxRedirects: 0 });
    expect(apiResponse.status()).toBe(401);
    expect(apiResponse.headers().location).toBeUndefined();
  } finally {
    await anonymous.dispose();
  }
});
