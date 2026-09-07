import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, test } from "@playwright/test";

const apiRoot = path.resolve(__dirname, "../src/app/api");
const missingId = "00000000-0000-4000-8000-999999999999";

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(filename) : entry.name === "route.ts" ? [filename] : [];
  });
}

test.use({ storageState: "playwright/.auth/super_admin.json" });

// Only JSON-consuming handlers participate. Bodyless commands and multipart
// uploads retain their separate contract tests; invented record IDs cannot
// address a fixture belonging to another test.
for (const filename of routeFiles(apiRoot)) {
  const source = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
  const route = "/api/" + path.relative(apiRoot, path.dirname(filename)).replaceAll("\\", "/");
  for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body) continue;
    const method = statement.name.text;
    if (!/^(POST|PUT|PATCH|DELETE)$/.test(method) || !/request\.json\(/.test(statement.body.getText(source))) continue;

    test(`${method} ${route} rejects malformed and non-object JSON @route-audit-boundary`, async ({ request }) => {
      test.setTimeout(60_000);
      const profileResponse = await request.get("/api/auth/me");
      expect(profileResponse.ok()).toBe(true);
      const { profile } = await profileResponse.json();
      const locationId = profile.primaryLocationId ?? profile.locationIds[0];
      const url = route.replace(/\[[^\]]+\]/g, missingId) + `?locationId=${locationId}`;
      for (const body of ["{", "null", "[]", "true"]) {
        const response = await request.fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          data: Buffer.from(body),
        });
        expect.soft(response.status(), `${method} ${route}, body=${body}`).toBeGreaterThanOrEqual(400);
        expect.soft(response.status(), `${method} ${route}, body=${body}`).toBeLessThan(500);
        expect.soft(response.headers()["content-type"]).toContain("application/json");
      }
    });
  }
}
