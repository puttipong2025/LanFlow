import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const password = process.env.TEST_PASSWORD ?? "password123";
const superAdminId = process.env.TEST_USER_ID ?? "00000000-0000-4000-8000-000000000001";

function normalizePhone(rawPhone: string) {
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.startsWith("0")) return `+66${digits.slice(1)}`;
  if (digits.startsWith("66")) return `+${digits}`;
  return rawPhone.startsWith("+") ? rawPhone : `+${digits}`;
}

function serviceClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedInClient(phone = process.env.TEST_PHONE ?? "0800000000") {
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    phone: normalizePhone(phone),
    password,
  });
  expect(error).toBeNull();
  return client;
}

async function firstLocation(service: SupabaseClient) {
  const { data, error } = await service
    .from("locations")
    .select("id")
    .eq("is_active", true)
    .limit(1)
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

function transferRow(id: string, locationId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    client_temp_id: id,
    idempotency_key: `delete-contract:${id}`,
    location_id: locationId,
    customer_name: "ลูกค้าทดสอบ atomic delete",
    account_number: "1111111111",
    net_amount_to_pay: 100,
    transfer_type: "customer",
    transfer_method: "bank",
    transfer_status: "pending",
    sync_status: "synced",
    record_status: "active",
    created_by_user_id: superAdminId,
    created_by_name: "LanFlow super_admin",
    created_by_phone: "0800000000",
    ...overrides,
  };
}

function rubberBillRow(id: string, locationId: string, customerName: string) {
  const billNo = `DELETE-${id.slice(0, 8)}`;
  return {
    id,
    client_temp_id: id,
    local_bill_no: billNo,
    server_bill_no: billNo,
    idempotency_key: `delete-source:${id}`,
    sync_status: "synced",
    record_status: "active",
    location_id: locationId,
    bill_no: billNo,
    bill_date: "2026-08-09",
    customer_name: customerName,
    bill_type: "weighing",
    weight: 100,
    deduct_weight: 0,
    rubber_value: 100,
    average_price: 1,
    deduction_total: 0,
    net_total: 100,
    server_received_at: new Date().toISOString(),
    created_by_user_id: superAdminId,
    created_by_name: "LanFlow super_admin",
    created_by_phone: "0800000000",
  };
}

function rubberBillItemRow(sourceId: string) {
  return {
    bill_id: sourceId,
    item_type: "weigh",
    description: "ชั่ง 1",
    weight_in: 100,
    weight_out: 0,
    net_weight: 100,
    price: 1,
    total: 100,
    sequence_no: 1,
  };
}

test.describe.serial("Atomic money transfer deletion", () => {
  test("soft-deletes the parent, releases items, retains slips, and blocks bypasses", async () => {
    test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
    const service = serviceClient();
    const client = await signedInClient();
    const locationId = await firstLocation(service);
    const transferId = crypto.randomUUID();
    const directDeleteId = crypto.randomUUID();
    const cashTransferId = crypto.randomUUID();
    const sourceId = crypto.randomUUID();

    try {
      expect((await service.from("rubber_bills").insert(
        rubberBillRow(sourceId, locationId, "ลูกค้าทดสอบ atomic delete"),
      )).error).toBeNull();
      expect((await service.from("rubber_bill_items").insert(
        rubberBillItemRow(sourceId),
      )).error).toBeNull();

      expect((await service.from("money_transfers").insert([
        transferRow(transferId, locationId),
        transferRow(directDeleteId, locationId),
        transferRow(cashTransferId, locationId, {
          transfer_type: "cash",
          transfer_method: "cash",
        }),
      ])).error).toBeNull();

      expect((await service.from("money_transfer_items").insert({
        transfer_id: transferId,
        source_type: "rubber_bill",
        source_id: sourceId,
        customer_name: "ลูกค้าทดสอบ atomic delete",
        amount: 100,
      })).error).toBeNull();

      expect((await service.from("money_transfer_slips").insert({
        transfer_id: transferId,
        amount: 100,
        reference_number: `DELETE-SLIP-${transferId.slice(0, 8)}`,
      })).error).toBeNull();

      const deleted = await client.rpc("delete_money_transfer", {
        p_transfer_id: transferId,
        p_expected_revision: 0,
      });
      expect(deleted.error).toBeNull();
      expect(deleted.data).toMatchObject({
        transferId,
        status: "deleted",
        idempotent: false,
        releasedItemCount: 1,
      });

      const parent = await service
        .from("money_transfers")
        .select("record_status,revision_no,deleted_at,deleted_by_name,deleted_by_phone")
        .eq("id", transferId)
        .single();
      expect(parent.error).toBeNull();
      expect(parent.data).toMatchObject({
        record_status: "deleted",
        revision_no: 1,
      });
      expect(parent.data?.deleted_at).toBeTruthy();
      expect(parent.data?.deleted_by_name).toBeTruthy();
      expect(parent.data?.deleted_by_phone).toBeTruthy();

      const items = await service
        .from("money_transfer_items")
        .select("id", { count: "exact", head: true })
        .eq("transfer_id", transferId);
      expect(items.error).toBeNull();
      expect(items.count).toBe(0);

      const slips = await service
        .from("money_transfer_slips")
        .select("id", { count: "exact", head: true })
        .eq("transfer_id", transferId);
      expect(slips.error).toBeNull();
      expect(slips.count).toBe(1);

      const rerun = await client.rpc("delete_money_transfer", {
        p_transfer_id: transferId,
        p_expected_revision: 1,
      });
      expect(rerun.error).toBeNull();
      expect(rerun.data).toMatchObject({
        status: "deleted",
        idempotent: true,
        releasedItemCount: 0,
      });

      const bypass = await client
        .from("money_transfers")
        .update({ record_status: "deleted" })
        .eq("id", directDeleteId);
      expect(bypass.error?.message).toContain("permission denied for table money_transfers");

      const cashDelete = await client.rpc("delete_money_transfer", {
        p_transfer_id: cashTransferId,
        p_expected_revision: 0,
      });
      expect(cashDelete.error?.message)
        .toContain("MONEY_TRANSFER_CASH_DELETE_REQUIRES_DEDICATED_WORKFLOW");

      const untouched = await service
        .from("money_transfers")
        .select("id,record_status,revision_no")
        .in("id", [directDeleteId, cashTransferId]);
      expect(untouched.error).toBeNull();
      expect(untouched.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: directDeleteId, record_status: "active", revision_no: 0 }),
        expect.objectContaining({ id: cashTransferId, record_status: "active", revision_no: 0 }),
      ]));
    } finally {
      await service.from("money_transfers").delete().in("id", [
        transferId,
        directDeleteId,
        cashTransferId,
      ]);
      await service.from("rubber_bills").delete().eq("id", sourceId);
    }
  });

  test("rolls back item release when an active report locks the transfer", async () => {
    test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
    const service = serviceClient();
    const client = await signedInClient();
    const locationId = await firstLocation(service);
    const transferId = crypto.randomUUID();
    const sourceId = crypto.randomUUID();
    const reportId = crypto.randomUUID();

    try {
      expect((await service.from("rubber_bills").insert(
        rubberBillRow(sourceId, locationId, "ลูกค้าทดสอบ report lock"),
      )).error).toBeNull();
      expect((await service.from("rubber_bill_items").insert(
        rubberBillItemRow(sourceId),
      )).error).toBeNull();

      expect((await service.from("money_transfers").insert(
        transferRow(transferId, locationId),
      )).error).toBeNull();
      expect((await service.from("money_transfer_items").insert({
        transfer_id: transferId,
        source_type: "rubber_bill",
        source_id: sourceId,
        customer_name: "ลูกค้าทดสอบ report lock",
        amount: 100,
      })).error).toBeNull();

      expect((await service.from("report_batches").insert({
        id: reportId,
        report_no: `RPT-DELETE-${reportId.slice(0, 8)}`,
        report_date: "2026-08-09",
        sequence_no: 200_000 + Number.parseInt(reportId.replaceAll("-", "").slice(0, 6), 16),
        location_id: locationId,
        cutoff_at: "2026-08-09T12:00:00.000Z",
        created_by_user_id: superAdminId,
        created_by_name: "LanFlow super_admin",
        created_by_phone: "0800000000",
      })).error).toBeNull();
      expect((await service.from("report_items").insert({
        report_id: reportId,
        location_id: locationId,
        entity_type: "bank_transfer_source",
        entity_id: transferId,
        eligibility_at: "2026-08-09T11:00:00.000Z",
      })).error).toBeNull();

      const deleted = await client.rpc("delete_money_transfer", {
        p_transfer_id: transferId,
        p_expected_revision: 0,
      });
      expect(deleted.error?.message).toContain("REPORT_LOCKED:");

      const parent = await service
        .from("money_transfers")
        .select("record_status,revision_no,deleted_at")
        .eq("id", transferId)
        .single();
      expect(parent.error).toBeNull();
      expect(parent.data).toMatchObject({
        record_status: "active",
        revision_no: 0,
        deleted_at: null,
      });

      const items = await service
        .from("money_transfer_items")
        .select("id", { count: "exact", head: true })
        .eq("transfer_id", transferId);
      expect(items.error).toBeNull();
      expect(items.count).toBe(1);
    } finally {
      await service.from("report_items").delete().eq("report_id", reportId);
      await service.from("report_batches").delete().eq("id", reportId);
      await service.from("money_transfers").delete().eq("id", transferId);
      await service.from("rubber_bills").delete().eq("id", sourceId);
    }
  });

  test("rejects a revoked capability and a transfer outside the actor branch scope", async () => {
    test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
    const service = serviceClient();
    const actorId = "00000000-0000-4000-8000-000000000003";
    const client = await signedInClient("+66820000001");
    const assigned = await service
      .from("user_locations")
      .select("location_id")
      .eq("user_id", actorId)
      .limit(1)
      .single();
    expect(assigned.error).toBeNull();

    const assignedTransferId = crypto.randomUUID();
    const outsideTransferId = crypto.randomUUID();
    const outsideLocationId = crypto.randomUUID();

    try {
      expect((await service.from("locations").insert({
        id: outsideLocationId,
        name: `สาขานอกขอบเขต delete ${outsideLocationId.slice(0, 8)}`,
        code: `DEL-${outsideLocationId.slice(0, 8)}`,
        is_active: true,
      })).error).toBeNull();
      expect((await service.from("money_transfers").insert([
        transferRow(assignedTransferId, assigned.data!.location_id),
        transferRow(outsideTransferId, outsideLocationId),
      ])).error).toBeNull();

      expect((await service.from("profiles").update({
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
      }).eq("id", actorId)).error).toBeNull();
      const revoked = await client.rpc("delete_money_transfer", {
        p_transfer_id: assignedTransferId,
        p_expected_revision: 0,
      });
      expect(revoked.error?.message).toContain("MONEY_TRANSFER_DELETE_FORBIDDEN");

      expect((await service.from("profiles").update({
        role: "admin",
        can_access_money_transfer: true,
      }).eq("id", actorId)).error).toBeNull();
      const crossBranch = await client.rpc("delete_money_transfer", {
        p_transfer_id: outsideTransferId,
        p_expected_revision: 0,
      });
      expect(crossBranch.error?.message).toContain("MONEY_TRANSFER_DELETE_FORBIDDEN");

      const untouched = await service
        .from("money_transfers")
        .select("id,record_status,revision_no")
        .in("id", [assignedTransferId, outsideTransferId]);
      expect(untouched.error).toBeNull();
      expect(untouched.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: assignedTransferId, record_status: "active", revision_no: 0 }),
        expect.objectContaining({ id: outsideTransferId, record_status: "active", revision_no: 0 }),
      ]));
    } finally {
      await service.from("profiles").update({
        role: "user",
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
      }).eq("id", actorId);
      await service.from("money_transfers").delete().in("id", [
        assignedTransferId,
        outsideTransferId,
      ]);
      await service.from("locations").delete().eq("id", outsideLocationId);
    }
  });
});
