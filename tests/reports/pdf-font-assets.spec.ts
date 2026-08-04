import { expect, test } from "@playwright/test";

const fontPaths = [
  "/fonts/NotoSansThai-Regular.ttf",
  "/fonts/NotoSansThai-Bold.ttf",
];

test("serves PDF fonts as anonymous static assets", async ({ request }) => {
  for (const path of fontPaths) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toMatch(/font|octet-stream/i);
    const body = await response.body();
    expect(Array.from(body.subarray(0, 4)), path).toEqual([0x00, 0x01, 0x00, 0x00]);
  }
});
