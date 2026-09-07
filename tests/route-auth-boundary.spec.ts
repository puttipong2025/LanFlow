import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const apiRoot = path.resolve(__dirname, "../src/app/api");
const fixtureId = "00000000-0000-4000-8000-999999999999";

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(filename) : entry.name === "route.ts" ? [filename] : [];
  });
}

// Enumerate the real route registrations so a new endpoint must preserve the
// authentication boundary before it can parse input or perform side effects.
for (const filename of routeFiles(apiRoot)) {
  const route = "/api/" + path.relative(apiRoot, path.dirname(filename)).replaceAll("\\", "/");
  const url = route.replace(/\[([^\]]+)\]/g, (_, parameter: string) => {
    if (parameter === "revisionNo") return "1";
    if (parameter === "role") return "rubber";
    if (parameter === "sourceType") return "withdrawal";
    return fixtureId;
  });
  const methods = [...readFileSync(filename, "utf8").matchAll(
    /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g,
  )].map((match) => match[1]);

  test(`${route} rejects anonymous and invalid sessions @route-audit-boundary`, async ({ request }) => {
    test.setTimeout(60_000);
    for (const method of methods) {
      for (const authorization of [undefined, "Bearer invalid-session"]) {
        const response = await request.fetch(url, {
          method,
          headers: authorization ? { Authorization: authorization } : {},
          ...(method !== "GET" ? { data: null } : {}),
        });
        expect(response.status(), `${method} ${route}`).toBe(401);
        expect(response.headers()["content-type"]).toContain("application/json");
        const body = await response.json();
        expect(body.error ?? body.errorMessage ?? body.message).toEqual(expect.any(String));
      }
    }
  });
}
