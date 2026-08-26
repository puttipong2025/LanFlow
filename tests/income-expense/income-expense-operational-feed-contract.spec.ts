import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

test.describe("Income/Expense operational feed contract", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("system managers can read an unassigned approval location while ordinary users remain scoped", () => {
    const route = readFileSync(resolve(
      "src/app/api/lanflow/income-expense/feed/route.ts",
    ), "utf8");

    expect(route).toContain(
      "if (!hasSystemManagerAccess(result.auth) && !result.auth.locationIds.includes(locationId))",
    );
    expect(route.indexOf("!hasSystemManagerAccess(result.auth)"))
      .toBeLessThan(route.indexOf("get_income_expense_operational_feed"));
  });

  test("rejects malformed feed scope before calling PostgreSQL", async ({ request }) => {
    expect((await request.get(
      "/api/lanflow/income-expense/feed?locationId=not-a-uuid&mode=latest",
    )).status()).toBe(400);
    expect((await request.get(
      `/api/lanflow/income-expense/feed?locationId=${crypto.randomUUID()}&mode=history`,
    )).status()).toBe(400);
    expect((await request.get(
      `/api/lanflow/income-expense/feed?locationId=${crypto.randomUUID()}&mode=latest&search=${"x".repeat(201)}`,
    )).status()).toBe(400);
  });

  test("searches old history and pages 100 to 1 without gaps at a date tie", async ({ request }) => {
    expect(serviceRoleKey).toBeTruthy();
    const meResponse = await request.get("/api/auth/me");
    expect(meResponse.ok()).toBeTruthy();
    const me = await meResponse.json() as {
      profile: { id: string; name: string; phone: string; locationIds: string[] };
    };
    const locationId = me.profile.locationIds[0];
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const marker = `OLD %_, ไทย ${Date.now()}`;
    const ids = Array.from({ length: 101 }, () => crypto.randomUUID());

    try {
      const { error } = await admin.from("income_expense").insert(ids.map((id, index) => ({
        id,
        client_temp_id: id,
        local_bill_no: `OLD-${id.slice(0, 8)}`,
        server_bill_no: `OLD-${id.slice(0, 8)}`,
        idempotency_key: `operational-feed:${id}`,
        sync_status: "synced",
        record_status: "active",
        location_id: locationId,
        type: index % 2 === 0 ? "income" : "expense",
        number: `OLD-${index}-${marker}`,
        tx_date: "2001-01-01",
        title: `${marker} รายการ ${index}`,
        cost: index + 1,
        bill_option: index % 2 === 0 ? "รายรับ" : "ค่าใช้จ่าย",
        client_recorded_at: "2001-01-01T00:00:00.000Z",
        client_created_at: "2001-01-01T00:00:00.000Z",
        server_received_at: "2001-01-01T00:00:00.000Z",
        revision_no: 1,
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
      })));
      expect(error).toBeNull();

      const firstResponse = await request.get(
        `/api/lanflow/income-expense/feed?locationId=${locationId}&mode=latest&search=${encodeURIComponent(marker)}`,
      );
      expect(firstResponse.ok(), await firstResponse.text()).toBeTruthy();
      const first = await firstResponse.json() as {
        rows: Array<{ id: string }>;
        nextCursor: string | null;
        hasMore: boolean;
        pendingApprovalCount: number;
      };
      expect(first.rows).toHaveLength(100);
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).toBeTruthy();
      expect(Number.isInteger(first.pendingApprovalCount)).toBe(true);

      expect((await request.get(
        `/api/lanflow/income-expense/feed?locationId=${locationId}&mode=latest&cursor=not-a-cursor`,
      )).status()).toBe(400);
      expect((await request.get(
        `/api/lanflow/income-expense/feed?locationId=${locationId}&mode=latest&search=different&cursor=${encodeURIComponent(first.nextCursor!)}`,
      )).status()).toBe(400);
      const versionMismatch = JSON.parse(Buffer.from(first.nextCursor!, "hex").toString("utf8")) as Record<string, unknown>;
      versionMismatch.v = 2;
      const wrongVersionCursor = Buffer.from(JSON.stringify(versionMismatch), "utf8").toString("hex");
      expect((await request.get(
        `/api/lanflow/income-expense/feed?locationId=${locationId}&mode=latest&search=${encodeURIComponent(marker)}&cursor=${wrongVersionCursor}`,
      )).status()).toBe(400);

      const secondResponse = await request.get(
        `/api/lanflow/income-expense/feed?locationId=${locationId}&mode=latest&search=${encodeURIComponent(marker)}&cursor=${encodeURIComponent(first.nextCursor!)}`,
      );
      expect(secondResponse.ok(), await secondResponse.text()).toBeTruthy();
      const second = await secondResponse.json() as {
        rows: Array<{ id: string }>;
        hasMore: boolean;
      };
      expect(second.rows).toHaveLength(1);
      expect(second.hasMore).toBe(false);
      expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(101);
    } finally {
      await admin.from("income_expense").delete().in("id", ids);
    }
  });

  test("pending approval merges both request types with one exact authoritative count", async ({ request, browser }) => {
    const me = await (await request.get("/api/auth/me")).json() as {
      profile: { id: string; name: string; phone: string; locationIds: string[] };
    };
    const locationId = me.profile.locationIds[0];
    const targetLocationId = me.profile.locationIds[1] ?? locationId;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const marker = `PENDING-MERGE-${Date.now()}`;
    const incomeRequestId = crypto.randomUUID();
    const cashRequestId = crypto.randomUUID();
    const beforeResponse = await request.get(
      `/api/lanflow/income-expense/feed?locationId=${locationId}&mode=pending_approval`,
    );
    expect(beforeResponse.ok(), await beforeResponse.text()).toBeTruthy();
    const beforeCount = Number((await beforeResponse.json()).pendingApprovalCount);

    try {
      expect((await admin.from("income_expense_approval_requests").insert({
        id: incomeRequestId,
        request_status: "pending",
        requested_operation: "create",
        request_idempotency_key: `pending-merge:${incomeRequestId}`,
        requested_payload: {
          clientTempId: incomeRequestId,
          localBillNo: marker,
          number: marker,
          txDate: "2020-01-01",
          title: marker,
          cost: 100,
          billOption: "ค่าใช้จ่าย",
        },
        matched_reasons: ["keyword"],
        location_id: locationId,
        tx_type: "expense",
        title: marker,
        cost: 100,
        requested_by_user_id: me.profile.id,
        requested_by_name: me.profile.name,
        requested_by_phone: me.profile.phone,
        created_at: "2020-01-01T00:00:00.000Z",
      })).error).toBeNull();
      expect((await admin.from("cash_transfer_delete_requests").insert({
        id: cashRequestId,
        transfer_id: null,
        source_location_id: locationId,
        source_location_name: "สาขาต้นทาง",
        target_location_id: targetLocationId,
        target_location_name: "สาขาปลายทาง",
        transfer_display_no: marker,
        sent_total: 100,
        received_total: 100,
        difference_total: 0,
        request_status: "pending",
        requested_by_user_id: me.profile.id,
        requested_by_name: me.profile.name,
        requested_by_phone: me.profile.phone,
        created_at: "2020-01-01T00:00:01.000Z",
      })).error).toBeNull();

      const response = await request.get(
        `/api/lanflow/income-expense/feed?locationId=${locationId}&mode=pending_approval&search=${marker}`,
      );
      expect(response.ok(), await response.text()).toBeTruthy();
      const body = await response.json() as {
        rows: Array<{ approvalRequestId: string; approvalRequestType: string }>;
        pendingApprovalCount: number;
        hasMore: boolean;
      };
      expect(body.pendingApprovalCount).toBe(beforeCount + 2);
      expect(body.rows.map((row) => row.approvalRequestId)).toEqual([incomeRequestId, cashRequestId]);
      expect(body.rows.map((row) => row.approvalRequestType)).toEqual([
        "income_expense",
        "cash_transfer_delete",
      ]);
      expect(body.hasMore).toBe(false);

      const user = await browser.newContext({ storageState: "playwright/.auth/user.json" });
      try {
        expect((await user.request.get(
          `/api/lanflow/income-expense/feed?locationId=${locationId}&mode=pending_approval`,
        )).status()).toBe(403);
      } finally {
        await user.close();
      }
    } finally {
      await admin.from("cash_transfer_delete_requests").delete().eq("id", cashRequestId);
      await admin.from("income_expense_approval_requests").delete().eq("id", incomeRequestId);
    }
  });
});
