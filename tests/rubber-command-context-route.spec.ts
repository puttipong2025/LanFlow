import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";

const locationId = "71000000-0000-4000-8000-000000000021";
const context = { generation: 1, revisionNo: 0, recordStatus: null, serverId: null, ocrUploadId: null };
function load(rpc: () => Promise<unknown>, authThrows = false) {
  return loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/command-context/route")>(
    "src/app/api/lanflow/rubber-bills/command-context/route.ts", {
      "@/lib/server/auth": { requireAuth: async () => {
        if (authThrows) throw new Error("private authentication diagnostic");
        return { ok: true, supabase: { rpc } };
      } },
    },
  );
}
const request = () => new Request(`http://localhost/api/lanflow/rubber-bills/command-context?locationId=${locationId}&clientTempId=bill`);

test("command context returns validated current state without caching", async () => {
  const response = await load(async () => ({ data: context, error: null })).GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(context);
  expect(response.headers.get("cache-control")).toContain("no-store");
});

for (const failure of ["auth throw", "RPC throw", "RPC outage", "null success", "unsafe generation"]) {
  test(`command context contains ${failure} as an opaque retryable response`, async () => {
    const route = load(async () => {
      if (failure === "RPC throw") throw new Error("private database diagnostic");
      if (failure === "RPC outage") return { data: null, error: { code: "08006", message: "private database diagnostic" } };
      return { data: failure === "null success" ? null : { ...context, generation: Number.MAX_SAFE_INTEGER + 1 }, error: null };
    }, failure === "auth throw");
    const response = await route.GET(request()).catch(() => undefined);
    expect(response?.status).toBe(503);
    expect(JSON.stringify(await response!.json())).not.toContain("private");
    expect(response!.headers.get("cache-control")).toContain("no-store");
  });
}

test("command context preserves forbidden errors and rejects invalid references before RPC", async () => {
  let calls = 0;
  const route = load(async () => { calls++; return { data: null, error: { code: "P0001", message: "FORBIDDEN: private" } }; });
  expect((await route.GET(request())).status).toBe(403);
  expect((await route.GET(new Request("http://localhost/?locationId=bad&clientTempId=bill"))).status).toBe(400);
  expect(calls).toBe(1);
});

test("command context contains invalid optional queue versions as retryable failures", async () => {
  for (const queueVersion of [null, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
    const response = await load(async () => ({ data: { ...context, queueVersion }, error: null })).GET(request());
    expect(response.status, `queueVersion=${String(queueVersion)}`).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
  }
  for (const queueVersion of [0, 1]) {
    expect((await load(async () => ({ data: { ...context, queueVersion }, error: null })).GET(request())).status).toBe(200);
  }
});
