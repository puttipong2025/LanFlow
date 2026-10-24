import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { loadSourceModule } from "../helpers/load-source-module";
import { bankImage } from "../../src/lib/server/cash-count-bank-ocr";
import type { prepareCashCountSubmission } from "../../src/lib/server/submit-cash-count";
import type { uploadPrivateImageToDrive } from "../../src/lib/server/google-drive";

const owner = "cc270000-0000-4000-8000-000000000001";
const sessionId = "cc270000-0000-4000-8000-000000000002";
const evidenceId = "cc270000-0000-4000-8000-000000000003";
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nT8AAAAASUVORK5CYII=", "base64");
function request(confirmed = "true") {
  const form = new FormData(); form.set("sessionId", sessionId); form.set("evidenceId", evidenceId);
  form.set("confirmed", confirmed); form.set("actualCounts", JSON.stringify({ "1000": 1, "500": 0, "100": 0, "50": 0, "20": 0, "10": 0, "5": 0, "2": 0, "1": 0 }));
  form.set("image", new File([bytes], "bank.png", { type: "image/png" }));
  return new Request("http://localhost", { method: "POST", body: form });
}
function harness() {
  const state = { drive_file_id: null as string | null, drive_uploaded_at: null as string | null,
    upload_started_at: null as string | null, image_sha256: createHash("sha256").update(bytes).digest("hex") };
  const session = { status: "active", expires_at: "2099-01-01T00:00:00Z" };
  let loseMark = false; let failDrive = false; let reservations = 0;
  const uploadedIds: string[] = [];
  const db = { from(table: string) {
    let patch: Record<string, unknown> | null = null;
    let onlyNull: string | null = null;
    const builder = {
      select() { return builder; }, eq() { return builder; },
      is(key: string) { onlyNull = key; return builder; },
      update(value: Record<string, unknown>) { patch = value; return builder; },
      single: async () => ({ data: table === "cash_count_sessions" ? { ...session } : { ...state }, error: null }),
      then(resolve: (result: unknown) => unknown) {
        if (patch?.drive_uploaded_at && loseMark) { loseMark = false; return Promise.resolve({ error: { message: "lost response" } }).then(resolve); }
        if (patch && (!onlyNull || state[onlyNull as keyof typeof state] === null)) Object.assign(state, patch);
        return Promise.resolve({ error: null }).then(resolve);
      },
    }; return builder;
  } };
  const module = loadSourceModule<{ prepareCashCountSubmission: typeof prepareCashCountSubmission }>("src/lib/server/submit-cash-count.ts", {
    "./supabase-admin": { createSupabaseAdminClient: () => db },
    "./cash-count-bank-ocr": { bankImage }, "./management-route-error": { isUuid: (value: unknown) => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value) },
    "./google-drive": { reservePrivateDriveFileId: async () => { reservations++; return "reserved-id"; },
      uploadPrivateImageToDrive: async (_bytes: Buffer, _mime: string, _name: string, id: string) => {
        uploadedIds.push(id); if (failDrive) { failDrive = false; throw new Error("Drive unavailable"); } return { fileId: id };
      } },
  });
  return { prepare: module.prepareCashCountSubmission, state, session, uploadedIds,
    reservations: () => reservations, loseNextMark: () => { loseMark = true; }, failNextDrive: () => { failDrive = true; } };
}
test("lost database acknowledgement reuses the reserved Drive file on retry", async () => {
  const h = harness(); h.loseNextMark();
  expect(await h.prepare(request(), owner).then(() => null, (error: Error) => error.message)).toContain("บันทึกหลักฐานไม่สำเร็จ");
  expect(h.state.drive_uploaded_at).toBeNull();
  expect((await h.prepare(request(), owner)).evidenceIds).toEqual([evidenceId]);
  expect(h.reservations()).toBe(1); expect(h.uploadedIds).toEqual(["reserved-id", "reserved-id"]);
  expect(h.state.drive_uploaded_at).toBeTruthy();
});
test("Drive failure leaves the same evidence available for retry", async () => {
  const h = harness(); h.failNextDrive();
  expect(await h.prepare(request(), owner).then(() => null, (error: Error) => error.message)).toContain("Drive unavailable");
  expect(h.state.drive_uploaded_at).toBeNull();
  await h.prepare(request(), owner); expect(h.reservations()).toBe(1);
});
test("unconfirmed, swapped-image and expired requests never upload", async () => {
  const h = harness();
  expect(await h.prepare(request("false"), owner).then(() => null, (error: Error) => error.message)).toContain("ยืนยันยอด");
  h.state.image_sha256 = "b".repeat(64);
  expect(await h.prepare(request(), owner).then(() => null, (error: Error) => error.message)).toContain("รูปไม่ตรง");
  h.session.expires_at = "2000-01-01T00:00:00Z";
  expect(await h.prepare(request(), owner).then(() => null, (error: Error) => error.message)).toContain("หมดเวลา");
  expect(h.reservations()).toBe(0); expect(h.uploadedIds).toHaveLength(0);
});
test("Drive duplicate ID replay verifies that the existing private file is not trashed", async () => {
  const calls: string[] = [];
  const module = loadSourceModule<{ uploadPrivateImageToDrive: typeof uploadPrivateImageToDrive }>("src/lib/server/google-drive.ts", {}, {
    process: { env: { GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test", GOOGLE_REFRESH_TOKEN: "test", GOOGLE_DRIVE_FOLDER_ID: "test" } },
    fetch: async (url: string) => { calls.push(url);
      if (url.includes("oauth2")) return Response.json({ access_token: "test-token", expires_in: 3600 });
      if (url.includes("upload/drive")) return Response.json({}, { status: 409 });
      return Response.json({ id: "reserved-id", trashed: false });
    },
  });
  expect(await module.uploadPrivateImageToDrive(bytes, "image/png", "test.png", "reserved-id")).toEqual({ fileId: "reserved-id" });
  expect(calls.some((url) => url.includes("permissions"))).toBe(false);
});

test("four uploads retry only the failed account after three successful files", async () => {
  const ids = Array.from({ length: 4 }, (_, index) => `cc290000-0000-4000-8000-00000000000${index + 1}`);
  const rows = new Map(ids.map((id) => [id, { slot_id: id, image_sha256: createHash("sha256").update(bytes).digest("hex"),
    drive_file_id: null as string | null, drive_uploaded_at: null as string | null }]));
  const uploads: string[] = []; let failLast = true; let reservations = 0;
  const db = { from(table: string) {
    let id = ""; let patch: Record<string, unknown> | null = null;
    const builder = { select() { return builder; }, eq(key: string, value: string) { if (key === "id") id = value; return builder; },
      is() { return builder; }, update(value: Record<string, unknown>) { patch = value; return builder; },
      single: async () => ({ data: table === "cash_count_sessions" ? { status: "active", expires_at: "2099-01-01T00:00:00Z" } : { ...rows.get(id) }, error: null }),
      then(resolve: (result: unknown) => unknown) { Object.assign(rows.get(id)!, patch); return Promise.resolve({ error: null }).then(resolve); },
    }; return builder;
  } };
  const module = loadSourceModule<{ prepareCashCountSubmission: typeof prepareCashCountSubmission }>("src/lib/server/submit-cash-count.ts", {
    "./supabase-admin": { createSupabaseAdminClient: () => db }, "./cash-count-bank-ocr": { bankImage },
    "./management-route-error": { isUuid: (value: unknown) => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value) },
    "./google-drive": { reservePrivateDriveFileId: async () => `file-${++reservations}`,
      uploadPrivateImageToDrive: async (_b: Buffer, _m: string, _n: string, id: string) => {
        uploads.push(id); if (id === "file-4" && failLast) { failLast = false; throw new Error("fourth upload failed"); } return { fileId: id };
      } },
  });
  async function multiRequest(extra = false) {
    const form = await request().formData(); form.delete("evidenceId"); form.delete("image"); form.delete("confirmed");
    for (const id of [...ids, ...(extra ? ["cc290000-0000-4000-8000-000000000005"] : [])]) {
      form.append("evidenceId", id); form.append("image", new File([bytes], "bank.png", { type: "image/png" })); form.append("confirmed", "true");
    }
    return new Request("http://localhost", { method: "POST", body: form });
  }
  expect(await module.prepareCashCountSubmission(await multiRequest(true), owner).then(() => null, (error: Error) => error.message)).toContain("สูงสุด 4");
  expect(uploads).toHaveLength(0);
  expect(await module.prepareCashCountSubmission(await multiRequest(), owner).then(() => null, (error: Error) => error.message)).toBe("fourth upload failed");
  expect([...rows.values()].filter((row) => row.drive_uploaded_at)).toHaveLength(3);
  expect((await module.prepareCashCountSubmission(await multiRequest(), owner)).evidenceIds).toEqual(ids);
  expect(uploads).toEqual(["file-1", "file-2", "file-3", "file-4", "file-4"]); expect(reservations).toBe(4);
});
