import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadSourceModule } from "../helpers/load-source-module";
import * as ocr from "../../src/lib/server/rubber-bill-ocr";

const locationId = "30000000-0000-4000-8000-000000000001";
const ownerId = "20000000-0000-4000-8000-000000000001";
const draft = { billDate: "2026-09-03", inWeight: 100, outWeight: 0, deductWeight: 0, ocrTotal: 1000, suggestedPrice: 10 };
type Scenario = "success" | "commit-lost" | "unknown" | "reject" | "duplicate" | "other-owner" | "reconcile-fails";

function fixture(scenario: Scenario) {
  let source: Record<string, unknown> | null = null;
  let uploads = 0;
  let inserts = 0;
  const deleted: string[] = [];
  const database = createClient("http://database.test", "fake-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/locations")) return Response.json({ id: locationId });
      if (url.pathname.endsWith("/rubber_bills")) return Response.json(null);
      if (init?.method === "POST") {
        inserts += 1;
        const row = JSON.parse(String(init.body));
        if (scenario === "reject") return Response.json({ code: "23514", message: "constraint rejected" }, { status: 400 });
        if (scenario === "unknown" || scenario === "reconcile-fails") throw new TypeError("fetch failed");
        const insertedSource = { id: crypto.randomUUID(), ...row };
        source = insertedSource;
        if (scenario === "duplicate" || scenario === "other-owner") {
          source = { ...source, id: crypto.randomUUID(), drive_file_id: "winner-file",
            owner_user_id: scenario === "other-owner" ? "another-owner" : ownerId };
          return Response.json({ code: "23505", message: "duplicate" }, { status: 409 });
        }
        if (scenario === "commit-lost") throw new TypeError("response lost after commit");
        return Response.json({ id: insertedSource.id }, { status: 201 });
      }
      if (scenario === "reconcile-fails" && inserts) return Response.json({ message: "unavailable" }, { status: 503 });
      const matched = source && [...url.searchParams].every(([key, value]) =>
        !value.startsWith("eq.") || String(source![key]) === value.slice(3));
      return Response.json(matched ? source : null);
    } },
  });
  const route = loadSourceModule<typeof import("../../src/app/api/lanflow/rubber-bills/ocr/route")>(
    "src/app/api/lanflow/rubber-bills/ocr/route.ts", {
      "@/lib/server/auth": {
        requireAuth: async () => ({ ok: true, auth: { sub: ownerId, locationIds: [locationId] }, supabase: database }),
        hasSystemManagerAccess: () => false,
      },
      "@/lib/server/supabase-admin": { createSupabaseAdminClient: () => database },
      "@/lib/server/rubber-bill-ocr": { ...ocr, readRubberBillOcrImage: async () => draft },
      "@/lib/server/google-drive": {
        uploadPrivateImageToDrive: async () => { uploads += 1; return { fileId: "attempt-file" }; },
        deleteImageFromDrive: async (id: string) => { deleted.push(id); },
      },
    },
  );
  const request = () => {
    const body = new FormData();
    body.set("locationId", locationId);
    body.set("image", new File([new Uint8Array([255, 216, 255, 224])], "fixture.jpg", { type: "image/jpeg" }));
    return route.POST(new Request("http://local/api/lanflow/rubber-bills/ocr", { method: "POST", body }));
  };
  return { request, deleted, source: () => source, uploads: () => uploads };
}

test("recovers a committed INSERT after its response is lost without deleting its image", async () => {
  const f = fixture("commit-lost");
  const first = await f.request();
  expect(f.deleted).toEqual([]);
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ uploadId: f.source()!.id, draft });
  const replay = await f.request();
  expect(await replay.json()).toEqual({ uploadId: f.source()!.id, draft });
  expect(f.uploads()).toBe(1);
});

for (const scenario of ["unknown", "reconcile-fails"] as const) {
  test(`keeps the attempt image when commit remains ${scenario}`, async () => {
    const f = fixture(scenario);
    const response = await f.request();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "OCR_STAGING_FAILED", retryable: true });
    expect(f.deleted).toEqual([]);
  });
}

test("keeps rejected attempt images for manual Drive cleanup", async () => {
  const f = fixture("reject");
  expect((await f.request()).status).toBe(503);
  expect(f.source()).toBeNull();
  expect(f.deleted).toEqual([]);
});

for (const scenario of ["duplicate", "other-owner"] as const) {
  test(`concurrent ${scenario} keeps both images for manual Drive cleanup`, async () => {
    const f = fixture(scenario);
    const response = await f.request();
    expect(response.status).toBe(scenario === "duplicate" ? 200 : 409);
    expect(f.deleted).toEqual([]);
    expect(f.source()!.drive_file_id).toBe("winner-file");
  });
}

test("a successful insert and replay leave the image intact", async () => {
  const f = fixture("success");
  const first = await f.request();
  expect(first.status).toBe(200);
  expect(await (await f.request()).json()).toEqual(await first.json());
  expect(f.deleted).toEqual([]);
  expect(f.uploads()).toBe(1);
});
