import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

test.describe("Rubber Bill cursor feed @rubber-bill-feed", () => {
  test.use({ storageState: "playwright/.auth/user.json" });

  test("paginates without overlap and rejects malformed or cross-scope cursors", async ({ request }) => {
    const me = await (await request.get("/api/auth/me")).json() as { profile: { locationIds: string[] } };
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const counts = await Promise.all(me.profile.locationIds.map(async (locationId) => ({
      locationId,
      count: (await admin.from("rubber_bills").select("id", { count: "exact", head: true })
        .eq("location_id", locationId).eq("record_status", "active")).count ?? 0,
    })));
    const locationId = counts.sort((a, b) => b.count - a.count)[0]?.locationId;
    expect(locationId).toBeTruthy();

    const firstResponse = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationId}&limit=2`);
    expect(firstResponse.ok()).toBeTruthy();
    const first = await firstResponse.json() as { rows: Array<{ id: string }>; nextCursor: string | null; hasMore: boolean };
    expect(first.rows.length).toBeLessThanOrEqual(2);
    expect(new Set(first.rows.map((row) => row.id)).size).toBe(first.rows.length);

    if (first.nextCursor) {
      const secondResponse = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationId}&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`);
      expect(secondResponse.ok()).toBeTruthy();
      const second = await secondResponse.json() as { rows: Array<{ id: string }> };
      const firstIds = new Set(first.rows.map((row) => row.id));
      expect(second.rows.some((row) => firstIds.has(row.id))).toBe(false);

      const mismatch = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationId}&limit=2&search=คนละขอบเขต&cursor=${encodeURIComponent(first.nextCursor)}`);
      expect(mismatch.status()).toBe(400);
      expect((await mismatch.json()).code).toBe("CURSOR_SCOPE_MISMATCH");
    }

    const malformed = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationId}&cursor=not-a-cursor`);
    expect(malformed.status()).toBe(400);
    expect((await malformed.json()).code).toBe("INVALID_CURSOR");

    for (const search of ["ภาษาไทย", "%", "_", ",", "  หลาย   ช่อง  "]) {
      const response = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationId}&search=${encodeURIComponent(search)}`);
      expect(response.ok()).toBeTruthy();
    }
  });

  test("loads 150 rows first and the next cursor continues with older rows", async ({ request }) => {
    const me = await (await request.get("/api/auth/me")).json() as {
      profile: { id: string; name: string; phone: string; locationIds: string[] };
    };
    const locationId = me.profile.locationIds[0];
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const marker = `CURSOR-${Date.now()}`;
    const billIds = Array.from({ length: 151 }, () => crypto.randomUUID());
    const base = Date.now() + 86_400_000;
    const bills = billIds.map((id, index) => {
      const createdAt = new Date(base + index * 1_000).toISOString();
      return {
        id, client_temp_id: id, local_bill_no: `${marker}-${index}`, server_bill_no: `${marker}-${index}`,
        idempotency_key: `${marker}:${index}`, sync_status: "synced", record_status: "active",
        location_id: locationId, bill_no: `${marker}-${index}`, bill_date: createdAt.slice(0, 10),
        customer_name: marker, bill_type: "weighing", weight: 100,
        rubber_value: 1_000, average_price: 10, net_total: 1_000,
        client_recorded_at: createdAt, client_created_at: createdAt, server_received_at: createdAt,
        created_at: createdAt, created_by_user_id: me.profile.id,
        created_by_name: me.profile.name, created_by_phone: me.profile.phone,
      };
    });
    try {
      expect((await admin.from("rubber_bills").insert(bills)).error).toBeNull();
      expect((await admin.from("rubber_bill_items").insert(billIds.map((billId) => ({
        bill_id: billId, item_type: "weigh", description: "ชั่ง", weight_in: 100,
        weight_out: 0, net_weight: 100, price: 10, total: 1_000, sequence_no: 1,
      })))).error).toBeNull();

      const firstResponse = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationId}&search=${marker}&limit=150`);
      expect(firstResponse.ok()).toBeTruthy();
      const first = await firstResponse.json() as { rows: Array<{ id: string }>; nextCursor: string | null; hasMore: boolean };
      expect(first.rows).toHaveLength(150);
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).toBeTruthy();

      const secondResponse = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationId}&search=${marker}&limit=100&cursor=${encodeURIComponent(first.nextCursor!)}`);
      expect(secondResponse.ok()).toBeTruthy();
      const second = await secondResponse.json() as { rows: Array<{ id: string }>; hasMore: boolean };
      expect(second.rows).toHaveLength(1);
      expect(second.hasMore).toBe(false);
      expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(151);
    } finally {
      await admin.from("rubber_bill_items").delete().in("bill_id", billIds);
      await admin.from("rubber_bills").delete().in("id", billIds);
    }
  });
});
