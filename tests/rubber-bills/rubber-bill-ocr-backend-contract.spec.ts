import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadSourceModule } from "../helpers/load-source-module";
import { requireAuth, hasSystemManagerAccess } from "../../src/lib/server/auth";

import {
  detectRubberBillOcrImage,
  hashRubberBillOcrImage,
  normalizeRubberBillOcrResult,
  readRubberBillOcrImage,
  resolveRubberBillOcrExistingSource,
  rubberBillOcrSuccess,
} from "../../src/lib/server/rubber-bill-ocr";

const migrationPath = resolve(
  "supabase/migrations/20260824010000_rubber_bill_ocr_cutover.sql",
);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

test("accepts only matching JPEG and PNG signatures within 8 MB", () => {
  expect(detectRubberBillOcrImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg", 4))
    .toEqual({ mimeType: "image/jpeg", extension: "jpg" });
  expect(detectRubberBillOcrImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png", 8))
    .toEqual({ mimeType: "image/png", extension: "png" });
  expect(detectRubberBillOcrImage(Buffer.from([0xff, 0xd8, 0xff]), "image/png", 3)).toBeNull();
  expect(detectRubberBillOcrImage(Buffer.from([0x47, 0x49, 0x46]), "image/gif", 3)).toBeNull();
  expect(detectRubberBillOcrImage(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg", 8 * 1024 * 1024 + 1)).toBeNull();
});

test("normalizes nullable weigh-ticket fields and computes a two-decimal price hint", () => {
  expect(normalizeRubberBillOcrResult({
    bill_date: "2026-08-24",
    weight_in: "2,760",
    weight_out: 2425,
    weight_deducted: "5",
    total_amount: "3,300",
  })).toEqual({
    billDate: "2026-08-24",
    inWeight: 2760,
    outWeight: 2425,
    deductWeight: 5,
    ocrTotal: 3300,
    suggestedPrice: 10,
  });

  expect(normalizeRubberBillOcrResult({
    bill_date: "not-a-date",
    weight_in: 100,
    weight_out: 100,
    weight_deducted: 0,
    total_amount: 500,
  })).toEqual({
    billDate: null,
    inWeight: 100,
    outWeight: 100,
    deductWeight: 0,
    ocrTotal: 500,
    suggestedPrice: null,
  });
});

test("returns the frozen success envelope and resolves same-owner staged recovery", async () => {
  const draft = {
    billDate: "2026-08-24",
    inWeight: 2760,
    outWeight: 2425,
    deductWeight: 5,
    ocrTotal: 3300,
    suggestedPrice: 10,
  };
  const staged = {
    id: "10000000-0000-4000-8000-000000000001",
    owner_user_id: "20000000-0000-4000-8000-000000000001",
    location_id: "30000000-0000-4000-8000-000000000001",
    state: "staged",
    bill_date: draft.billDate,
    in_weight: draft.inWeight,
    out_weight: draft.outWeight,
    deduct_weight: draft.deductWeight,
    ocr_total: draft.ocrTotal,
    suggested_price: draft.suggestedPrice,
  };

  expect(resolveRubberBillOcrExistingSource(
    staged,
    staged.owner_user_id,
    staged.location_id,
  )).toEqual({ kind: "replay", uploadId: staged.id, draft });
  expect(resolveRubberBillOcrExistingSource(
    { ...staged, state: "reserved" },
    staged.owner_user_id,
    staged.location_id,
  )).toEqual({ kind: "conflict" });
  expect(resolveRubberBillOcrExistingSource(
    staged,
    "20000000-0000-4000-8000-000000000002",
    staged.location_id,
  )).toEqual({ kind: "conflict" });
  expect(resolveRubberBillOcrExistingSource(
    staged,
    staged.owner_user_id,
    "30000000-0000-4000-8000-000000000002",
  )).toEqual({ kind: "conflict" });

  const response = rubberBillOcrSuccess(staged.id, draft);
  expect(await response.json()).toEqual({ uploadId: staged.id, draft });

  const routeSource = readFileSync(
    resolve("src/app/api/lanflow/rubber-bills/ocr/route.ts"),
    "utf8",
  );
  expect(routeSource.indexOf("const existingSource = resolveRubberBillOcrExistingSource"))
    .toBeLessThan(routeSource.indexOf("draft = await readRubberBillOcrImage"));
  expect(routeSource.indexOf("const existingSource = resolveRubberBillOcrExistingSource"))
    .toBeLessThan(routeSource.indexOf("await uploadPrivateImageToDrive"));
});

test("marks unreadable and invalid OCR results retryable", async () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: "not-json" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    await expect(readRubberBillOcrImage(Buffer.from("image"), "image/jpeg"))
      .rejects.toMatchObject({ status: 422, code: "OCR_INVALID_RESPONSE", retryable: true });

    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        bill_date: null,
        weight_in: null,
        weight_out: null,
        weight_deducted: null,
        total_amount: null,
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    await expect(readRubberBillOcrImage(Buffer.from("image"), "image/jpeg"))
      .rejects.toMatchObject({ status: 422, code: "OCR_UNREADABLE", retryable: true });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
  }
});

test("cutover migration aborts before DDL and enforces private source provenance", () => {
  const sql = readFileSync(migrationPath, "utf8");
  const firstDo = sql.indexOf("do $$");
  const firstDdl = Math.min(
    ...["create table", "alter table", "create or replace function"]
      .map((token) => sql.indexOf(token))
      .filter((index) => index >= 0),
  );

  expect(firstDo).toBeGreaterThanOrEqual(0);
  expect(firstDo).toBeLessThan(firstDdl);
  expect(sql).toContain("from public.ocr_tickets");
  expect(sql).toContain("source_type = 'ocr_ticket'");
  expect(sql).toContain("entity_type = 'ocr_ticket'");
  expect(sql).toContain("create table public.rubber_bill_ocr_sources");
  expect(sql).toContain("enable row level security");
  expect(sql).toContain("revoke all on table public.rubber_bill_ocr_sources from public, anon, authenticated");
  expect(sql).toContain("drop table public.ocr_tickets;");
  expect(sql).not.toContain("cascade");
  expect(sql).toContain("rubber_bills_active_ocr_hash_unique");
  expect(sql).toContain("rubber_bill_ocr_sources_enforce_update");
  expect(sql).toContain("ห้ามแก้ไขข้อมูลอ้างอิงต้นทาง OCR ของบิลยาง");
  expect(sql).toContain("old.state = 'staged' and new.state = 'reserved'");
  expect(sql).toContain("old.state = 'reserved' and new.state in ('attached', 'abandoned')");
  expect(sql).toContain("'public.approve_rubber_bill_approval_request(uuid)'::regprocedure");
  expect(sql).toContain("s.owner_user_id = v_request.requested_by_user_id");
  expect(sql).toContain("if v_source.state = 'attached' then");
  expect(sql).toContain("OCR_REPLAY_ATTACHMENT_MISMATCH");
  expect(sql).toContain("notify pgrst, 'reload schema'");
});

test("legacy standalone OCR routes are retired", () => {
  expect(existsSync(resolve("src/app/api/lanflow/ocr-ticket/route.ts"))).toBe(false);
  expect(existsSync(resolve("src/app/api/lanflow/ocr-tickets/upload-image/route.ts"))).toBe(false);
});

test("OCR upload rejects unauthenticated requests with the stable error envelope", async ({ request }) => {
  const response = await request.post("/api/lanflow/rubber-bills/ocr", {
    multipart: { locationId: crypto.randomUUID() },
  });
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({
    code: "UNAUTHORIZED",
    message: "กรุณาเข้าสู่ระบบ",
    retryable: false,
  });
});

test.describe("ordinary user OCR boundary", () => {
  test.use({ storageState: "playwright/.auth/user.json" });

  test("rejects a role without LanFlow access", async ({ request }) => {
    const response = await request.post("/api/lanflow/rubber-bills/ocr", {
      multipart: { locationId: crypto.randomUUID() },
    });
    expect(response.status()).toBe(403);
  });
});

test.describe("authenticated OCR upload boundary", () => {
  test.use({ storageState: "playwright/.auth/admin.json" });

  test("requires one image and keeps the stable error envelope", async ({ request }) => {
    const response = await request.post("/api/lanflow/rubber-bills/ocr", {
      multipart: { locationId: crypto.randomUUID() },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({
      code: "IMAGE_REQUIRED",
      message: "กรุณาเลือกรูปใบชั่ง",
      retryable: false,
    });
  });

  test("recovers a same-owner staged upload and rejects its reserved replay", async ({ request }) => {
    test.skip(!serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required");
    const meResponse = await request.get("/api/auth/me");
    expect(meResponse.ok()).toBeTruthy();
    const me = await meResponse.json() as {
      profile: { id: string; locationIds: string[] };
    };
    const locationId = me.profile.locationIds[0];
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...crypto.getRandomValues(new Uint8Array(16))]);
    const imageSha256 = hashRubberBillOcrImage(image);
    const uploadId = crypto.randomUUID();
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const draft = {
      billDate: "2026-08-24",
      inWeight: 2760,
      outWeight: 2425,
      deductWeight: 5,
      ocrTotal: 3300,
      suggestedPrice: 10,
    };

    try {
      const inserted = await admin.from("rubber_bill_ocr_sources").insert({
        id: uploadId,
        owner_user_id: me.profile.id,
        location_id: locationId,
        state: "staged",
        image_sha256: imageSha256,
        drive_file_id: `staged-recovery-${uploadId}`,
        image_mime_type: "image/jpeg",
        image_size_bytes: image.length,
        original_file_name: "staged-recovery.jpg",
        bill_date: draft.billDate,
        in_weight: draft.inWeight,
        out_weight: draft.outWeight,
        deduct_weight: draft.deductWeight,
        ocr_total: draft.ocrTotal,
        suggested_price: draft.suggestedPrice,
      });
      expect(inserted.error).toBeNull();

      const recovered = await request.post("/api/lanflow/rubber-bills/ocr", {
        multipart: {
          locationId,
          image: { name: "staged-recovery.jpg", mimeType: "image/jpeg", buffer: image },
        },
      });
      expect(recovered.status()).toBe(200);
      expect(await recovered.json()).toEqual({ uploadId, draft });

      const reserved = await admin.from("rubber_bill_ocr_sources").update({
        state: "reserved",
        reserved_client_temp_id: `client-${uploadId}`,
        reserved_idempotency_key: `create:${uploadId}:0`,
        reserved_at: new Date().toISOString(),
      }).eq("id", uploadId);
      expect(reserved.error).toBeNull();

      const conflict = await request.post("/api/lanflow/rubber-bills/ocr", {
        multipart: {
          locationId,
          image: { name: "staged-recovery.jpg", mimeType: "image/jpeg", buffer: image },
        },
      });
      expect(conflict.status()).toBe(409);
      expect(await conflict.json()).toEqual({
        code: "OCR_UPLOAD_IDENTITY_CONFLICT",
        message: "รูปใบชั่งนี้อยู่ในคิวของคำขออื่นแล้ว",
        retryable: false,
      });
    } finally {
      await admin.from("rubber_bill_ocr_sources").delete().eq("id", uploadId);
    }
  });

  test("replays an attached upload idempotently without creating or attaching again", async ({ request }) => {
    test.skip(!serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required");
    const meResponse = await request.get("/api/auth/me");
    expect(meResponse.ok()).toBeTruthy();
    const me = await meResponse.json() as {
      profile: { id: string; locationIds: string[]; name: string; phone: string };
    };
    const locationId = me.profile.locationIds[0];
    const uploadId = crypto.randomUUID();
    const clientTempId = crypto.randomUUID();
    const imageSha256 = hashRubberBillOcrImage(Buffer.from(`attached-${uploadId}`));
    const idempotencyKey = `create:${clientTempId}:0`;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let billId: string | null = null;
    const now = new Date().toISOString();
    const payload = {
      operation: "create",
      formulaVersion: 2,
      expectedRevisionNo: 0,
      clientTempId,
      idempotencyKey,
      locationId,
      recordStatus: "active",
      localBillNo: `OCR-REPLAY-${clientTempId.slice(0, 8)}`,
      billDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date()),
      customerId: null,
      customerName: "ทดสอบ OCR replay",
      configuredPriceSnapshot: 0,
      billType: "บิลเครื่องชั่งเล็ก",
      deductWeight: 0,
      weight: 10,
      netWeight: 10,
      rubberValue: 0,
      netRubberValue: 0,
      averagePrice: 0,
      deductionTotal: 0,
      payableBeforeRounding: 0,
      netTotal: 0,
      acidPackCount: 0,
      createdByUserId: me.profile.id,
      createdByName: me.profile.name,
      createdByPhone: me.profile.phone,
      clientRecordedAt: now,
      clientCreatedAt: now,
      inputMethod: "ocr",
      ocrUploadId: uploadId,
      items: [{
        itemType: "weigh",
        title: "OCR",
        description: "OCR",
        inWeight: 100,
        outWeight: 90,
        netWeight: 10,
        unitPrice: 0,
        totalAmount: 0,
        sequenceNo: 1,
      }],
    };

    try {
      expect((await admin.from("rubber_bill_ocr_sources").insert({
        id: uploadId,
        owner_user_id: me.profile.id,
        location_id: locationId,
        state: "staged",
        image_sha256: imageSha256,
        drive_file_id: `attached-replay-${uploadId}`,
        image_mime_type: "image/jpeg",
        image_size_bytes: 4,
        original_file_name: "attached-replay.jpg",
      })).error).toBeNull();

      const first = await request.post("/api/lanflow/rubber-bills", { data: payload });
      expect(first.status()).toBe(200);
      const firstResult = await first.json() as { status: string; id: string };
      expect(firstResult.status).toBe("synced");
      billId = firstResult.id;
      const attachedBefore = await admin.from("rubber_bill_ocr_sources")
        .select("state, attached_at")
        .eq("id", uploadId)
        .single();
      expect(attachedBefore.error).toBeNull();
      expect(attachedBefore.data?.state).toBe("attached");

      const replay = await request.post("/api/lanflow/rubber-bills", { data: payload });
      expect(replay.status()).toBe(200);
      expect(await replay.json()).toMatchObject({ status: "synced", id: billId });
      const attachedAfter = await admin.from("rubber_bill_ocr_sources")
        .select("state, attached_at")
        .eq("id", uploadId)
        .single();
      expect(attachedAfter.data).toEqual(attachedBefore.data);
      const bills = await admin.from("rubber_bills")
        .select("id", { count: "exact" })
        .eq("client_temp_id", clientTempId);
      expect(bills.count).toBe(1);

      // Exercise real local auth, RLS and attached-source lookup; only Drive media is synthetic.
      expect(["localhost", "127.0.0.1"]).toContain(new URL(supabaseUrl).hostname);
      const actor = createClient(supabaseUrl,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } });
      const signedIn = await actor.auth.signInWithPassword({
        phone: "+66810000001", password: process.env.TEST_PASSWORD ?? "password123",
      });
      expect(signedIn.error).toBeNull();
      expect(signedIn.data.user?.id).toBe(me.profile.id);
      const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      const sourceImage = loadSourceModule<typeof import("../../src/app/api/lanflow/rubber-bills/[billId]/ocr-source-image/route")>(
        "src/app/api/lanflow/rubber-bills/[billId]/ocr-source-image/route.ts", {
          "@/lib/server/auth": { requireAuth, hasSystemManagerAccess },
          "@/lib/server/supabase-admin": { createSupabaseAdminClient: () => admin },
          "@/lib/server/google-drive": { downloadPrivateImageFromDrive: async (fileId: string) => {
            expect(fileId).toBe(`attached-replay-${uploadId}`);
            return new Response(imageBytes);
          } },
        });
      const imageResponse = await sourceImage.GET(new Request(
        `http://localhost/api/lanflow/rubber-bills/${billId}/ocr-source-image`, {
          headers: { authorization: `bearer ${signedIn.data.session!.access_token}` },
        }), { params: Promise.resolve({ billId }) });
      expect(imageResponse.status).toBe(200);
      expect(imageResponse.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
      expect(new Uint8Array(await imageResponse.arrayBuffer())).toEqual(imageBytes);
    } finally {
      if (billId) {
        await admin.from("dashboard_money_events").delete()
          .eq("source_type", "rubber_bill")
          .eq("source_id", billId);
        await admin.from("rubber_bills").delete().eq("id", billId);
      }
      await admin.from("rubber_bill_ocr_sources").delete().eq("id", uploadId);
    }
  });
});
