import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

test.describe("Cash branch transfer bounded read contract", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("system managers can read an unassigned cash queue while ordinary users remain scoped", () => {
    const route = readFileSync(resolve(
      "src/app/api/lanflow/cash-branch-transfers/route.ts",
    ), "utf8");

    expect(route).toContain("hasSystemManagerAccess(result.auth)");
    expect(route).toContain(
      "hasSystemManagerAccess(result.auth) || result.auth.locationIds.includes(locationId)",
    );
    expect(route.indexOf("hasSystemManagerAccess(result.auth)"))
      .toBeLessThan(route.indexOf("get_cash_branch_transfer_pending_summary"));
  });

  test("rejects malformed pending-summary parameters before calling PostgreSQL", async ({ request }) => {
    expect((await request.get(
      "/api/lanflow/cash-branch-transfers?locationId=not-a-uuid&view=pending",
    )).status()).toBe(400);
    expect((await request.get(
      `/api/lanflow/cash-branch-transfers?locationId=${crypto.randomUUID()}&view=history`,
    )).status()).toBe(400);
  });

  test("pending summary is FIFO, limited to 20, exact, and contains no denominations", async ({ request, browser }) => {
    expect(serviceRoleKey).toBeTruthy();
    const me = await (await request.get("/api/auth/me")).json() as {
      profile: { id: string; name: string; phone: string; locationIds: string[] };
    };
    const sourceLocationId = crypto.randomUUID();
    const targetLocationId = crypto.randomUUID();
    const transferIds = Array.from({ length: 21 }, () => crypto.randomUUID());
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const marker = targetLocationId.slice(0, 8).toUpperCase();

    try {
      expect((await admin.from("locations").insert([
        {
          id: sourceLocationId,
          name: `สาขาต้นทาง Cash Read ${marker}`,
          code: `CS${marker.slice(0, 6)}`,
          is_active: true,
        },
        {
          id: targetLocationId,
          name: `สาขา Cash Read ${marker}`,
          code: `CR${marker.slice(0, 6)}`,
          is_active: true,
        },
      ])).error).toBeNull();
      expect((await admin.from("money_transfers").insert(transferIds.map((id, index) => ({
        id,
        client_temp_id: id,
        idempotency_key: `cash-read:${id}`,
        location_id: sourceLocationId,
        target_location_id: targetLocationId,
        target_location_name: `สาขา Cash Read ${marker}`,
        net_amount_to_pay: 20,
        transfer_type: "cash",
        transfer_method: "cash",
        transfer_status: "pending",
        sync_status: "synced",
        record_status: "active",
        revision_no: 0,
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
        created_at: new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString(),
      })))).error).toBeNull();
      expect((await admin.from("money_transfer_cash_details").insert(transferIds.map((transferId, index) => ({
        transfer_id: transferId,
        sent_coin_1_count: 0,
        sent_coin_2_count: 0,
        sent_coin_5_count: 0,
        sent_coin_10_count: 0,
        sent_banknote_20_count: 1,
        sent_banknote_50_count: 0,
        sent_banknote_100_count: 0,
        sent_banknote_500_count: 0,
        sent_banknote_1000_count: 0,
        cash_status: "pending_receipt",
        sent_at: new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString(),
      })))).error).toBeNull();

      const response = await request.get(
        `/api/lanflow/cash-branch-transfers?locationId=${targetLocationId}&view=pending`,
      );
      expect(response.ok(), await response.text()).toBeTruthy();
      const body = await response.json() as {
        transfers: Array<Record<string, unknown>>;
        total: number;
      };
      expect(body.total).toBe(21);
      expect(body.transfers).toHaveLength(20);
      expect(body.transfers.map((row) => row.id)).toEqual(transferIds.slice(0, 20));
      expect(body.transfers.every((row) => (
        !("sent" in row)
        && !("received" in row)
        && !("money_transfer_cash_details" in row)
        && !("sent_coin_1_count" in row)
      ))).toBe(true);

      const detailResponse = await request.get(`/api/lanflow/cash-branch-transfers/${transferIds[0]}`);
      expect(detailResponse.ok(), await detailResponse.text()).toBeTruthy();
      const detail = (await detailResponse.json() as {
        transfer: { id: string; money_transfer_cash_details: Array<Record<string, unknown>> };
      }).transfer;
      expect(detail.id).toBe(transferIds[0]);
      expect(detail.money_transfer_cash_details).toHaveLength(1);
      expect(detail.money_transfer_cash_details[0].sent_banknote_20_count).toBe(1);

      const user = await browser.newContext({ storageState: "playwright/.auth/user.json" });
      try {
        expect((await user.request.get(`/api/lanflow/cash-branch-transfers/${transferIds[0]}`)).status()).toBe(403);
      } finally {
        await user.close();
      }
      expect((await request.get(`/api/lanflow/cash-branch-transfers/${crypto.randomUUID()}`)).status()).toBe(404);
    } finally {
      await admin.from("money_transfers").delete().in("id", transferIds);
      await admin.from("locations").delete().in("id", [sourceLocationId, targetLocationId]);
    }
  });
});
