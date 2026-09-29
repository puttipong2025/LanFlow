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
      "/sw.js",
      "/fonts/NotoSansThai-Regular.ttf",
    ]) {
      const response = await anonymous.get(publicPath, { maxRedirects: 0 });
      expect(response.status(), publicPath).toBe(200);
    }

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
