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

test.describe.serial("Pending money transfer merge", () => {
  test("merges eligible groups into the oldest parent and skips slips, locks, and other accounts", async () => {
    test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
    const service = serviceClient();
    const client = await signedInClient();
    const locationId = await firstLocation(service);
    const customerId = crypto.randomUUID();
    const otherCustomerId = crypto.randomUUID();
    const reportId = crypto.randomUUID();
    const transferIds = Array.from({ length: 7 }, () => crypto.randomUUID());
    const sourceIds = transferIds.map(() => crypto.randomUUID());
    const createdAt = [
      "2026-08-04T01:00:00.000Z",
      "2026-08-04T02:00:00.000Z",
      "2026-08-04T03:00:00.000Z",
      "2026-08-04T04:00:00.000Z",
      "2026-08-04T05:00:00.000Z",
      "2026-08-04T06:00:00.000Z",
      "2026-08-04T07:00:00.000Z",
    ];

    try {
      expect((await service.from("customers").insert([
        {
          id: customerId,
          main_name: "ลูกค้ารวมรายการ",
          created_by_name: "Merge test",
          created_by_phone: "0800000000",
        },
        {
          id: otherCustomerId,
          main_name: "ลูกค้าคนละคน",
          created_by_name: "Merge test",
          created_by_phone: "0800000000",
        },
      ])).error).toBeNull();

      expect((await service.from("ocr_tickets").insert(sourceIds.map((id, index) => ({
        id,
        client_temp_id: id,
        idempotency_key: `merge-source:${id}`,
        location_id: locationId,
        file_name: `merge-${index}.jpg`,
        ticket_id: `MERGE-${index}`,
        customer_name: index === 6 ? "ลูกค้าคนละคน" : "ลูกค้ารวมรายการ",
        total_amount: (index + 1) * 100,
        sync_status: "synced",
        record_status: "active",
        created_by_user_id: superAdminId,
      })))).error).toBeNull();

      expect((await service.from("money_transfers").insert(transferIds.map((id, index) => ({
        id,
        client_temp_id: id,
        idempotency_key: `merge-transfer:${id}`,
        location_id: locationId,
        customer_id: index === 6 ? otherCustomerId : customerId,
        customer_name: index === 6 ? "ลูกค้าคนละคน" : "ลูกค้ารวมรายการ",
        account_number: index === 5 ? "2222222222" : "1111111111",
        net_amount_to_pay: (index + 1) * 100,
        transfer_type: "customer",
        transfer_method: "bank",
        transfer_status: "pending",
        sync_status: "synced",
        record_status: "active",
        created_by_user_id: superAdminId,
        created_by_name: "LanFlow super_admin",
        created_by_phone: "0800000000",
        created_at: createdAt[index],
      })))).error).toBeNull();

      expect((await service.from("money_transfer_items").insert(transferIds.map((transferId, index) => ({
        transfer_id: transferId,
        source_type: "ocr_ticket",
        source_id: sourceIds[index],
        customer_name: index === 6 ? "ลูกค้าคนละคน" : "ลูกค้ารวมรายการ",
        amount: (index + 1) * 100,
      })))).error).toBeNull();

      expect((await service.from("money_transfer_slips").insert({
        transfer_id: transferIds[4],
        amount: 0,
        reference_number: "ZERO-SLIP-BLOCKS-MERGE",
      })).error).toBeNull();

      expect((await service.from("report_batches").insert({
        id: reportId,
        report_no: `RPT-MERGE-${reportId.slice(0, 8)}`,
        report_date: "2026-08-04",
        sequence_no: 100_000 + Number.parseInt(reportId.replaceAll("-", "").slice(0, 6), 16),
        location_id: locationId,
        cutoff_at: "2026-08-04T08:00:00.000Z",
        created_by_user_id: superAdminId,
        created_by_name: "LanFlow super_admin",
        created_by_phone: "0800000000",
      })).error).toBeNull();
      expect((await service.from("report_items").insert({
        report_id: reportId,
        location_id: locationId,
        entity_type: "bank_transfer_source",
        entity_id: transferIds[3],
        eligibility_at: "2026-08-04T04:00:00.000Z",
      })).error).toBeNull();

      const merged = await client.rpc("merge_pending_money_transfers", {
        p_location_id: locationId,
      });
      expect(merged.error).toBeNull();
      expect(merged.data).toMatchObject({
        mergedGroupCount: 1,
        mergedTransferCount: 3,
        deletedTransferCount: 2,
        skippedTransferCount: 4,
        survivorIds: [transferIds[0]],
      });

      const parents = await service
        .from("money_transfers")
        .select("id,net_amount_to_pay,record_status,revision_no")
        .in("id", transferIds)
        .order("created_at");
      expect(parents.error).toBeNull();
      expect(parents.data?.find((row) => row.id === transferIds[0])).toMatchObject({
        net_amount_to_pay: 600,
        record_status: "active",
        revision_no: 1,
      });
      expect(parents.data?.filter((row) => [transferIds[1], transferIds[2]].includes(row.id)))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ record_status: "deleted", revision_no: 1 }),
          expect.objectContaining({ record_status: "deleted", revision_no: 1 }),
        ]));
      expect(parents.data?.filter((row) => transferIds.slice(3).includes(row.id)))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ id: transferIds[3], record_status: "active" }),
          expect.objectContaining({ id: transferIds[4], record_status: "active" }),
          expect.objectContaining({ id: transferIds[5], record_status: "active" }),
          expect.objectContaining({ id: transferIds[6], record_status: "active" }),
        ]));

      const movedItems = await service
        .from("money_transfer_items")
        .select("transfer_id,source_id")
        .in("source_id", sourceIds.slice(0, 3));
      expect(movedItems.error).toBeNull();
      expect(movedItems.data).toHaveLength(3);
      expect(movedItems.data?.every((item) => item.transfer_id === transferIds[0])).toBe(true);

      const rerun = await client.rpc("merge_pending_money_transfers", {
        p_location_id: locationId,
      });
      expect(rerun.error).toBeNull();
      expect(rerun.data).toMatchObject({
        mergedGroupCount: 0,
        mergedTransferCount: 0,
        deletedTransferCount: 0,
        skippedTransferCount: 5,
        survivorIds: [],
      });
    } finally {
      await service.from("report_items").delete().eq("report_id", reportId);
      await service.from("report_batches").delete().eq("id", reportId);
      await service.from("money_transfers").delete().in("id", transferIds);
      await service.from("ocr_tickets").delete().in("id", sourceIds);
      await service.from("customers").delete().in("id", [customerId, otherCustomerId]);
    }
  });

  test("serializes concurrent merge calls", async () => {
    test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
    const service = serviceClient();
    const client = await signedInClient();
    const locationId = await firstLocation(service);
    const customerId = crypto.randomUUID();
    const transferIds = [crypto.randomUUID(), crypto.randomUUID()];

    try {
      expect((await service.from("customers").insert({
        id: customerId,
        main_name: "ลูกค้าทดสอบ concurrent merge",
        created_by_name: "Merge test",
        created_by_phone: "0800000000",
      })).error).toBeNull();
      expect((await service.from("money_transfers").insert(transferIds.map((id, index) => ({
        id,
        client_temp_id: id,
        idempotency_key: `merge-concurrent:${id}`,
        location_id: locationId,
        customer_id: customerId,
        customer_name: "ลูกค้าทดสอบ concurrent merge",
        account_number: "3333333333",
        net_amount_to_pay: 0,
        transfer_type: "customer",
        transfer_method: "bank",
        transfer_status: "pending",
        sync_status: "synced",
        record_status: "active",
        created_by_user_id: superAdminId,
        created_by_name: "LanFlow super_admin",
        created_by_phone: "0800000000",
        created_at: `2026-08-04T0${index + 1}:00:00.000Z`,
      })))).error).toBeNull();

      const results = await Promise.all([
        client.rpc("merge_pending_money_transfers", { p_location_id: locationId }),
        client.rpc("merge_pending_money_transfers", { p_location_id: locationId }),
      ]);
      expect(results.every((result) => result.error === null)).toBe(true);
      expect(results.map((result) => result.data.mergedGroupCount).sort()).toEqual([0, 1]);
    } finally {
      await service.from("money_transfers").delete().in("id", transferIds);
      await service.from("customers").delete().eq("id", customerId);
    }
  });

  test("rolls back earlier groups when a later group fails", async () => {
    test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
    const service = serviceClient();
    const client = await signedInClient();
    const locationId = await firstLocation(service);
    const customerIds = [crypto.randomUUID(), crypto.randomUUID()];
    const transferIds = Array.from({ length: 4 }, () => crypto.randomUUID());
    const sourceIds = Array.from({ length: 4 }, () => crypto.randomUUID());

    try {
      expect((await service.from("customers").insert(customerIds.map((id, index) => ({
        id,
        main_name: `ลูกค้าทดสอบ rollback ${index}`,
        created_by_name: "Merge test",
        created_by_phone: "0800000000",
      })))).error).toBeNull();
      expect((await service.from("ocr_tickets").insert(sourceIds.map((id, index) => ({
        id,
        client_temp_id: id,
        idempotency_key: `merge-rollback-source:${id}`,
        location_id: locationId,
        file_name: `merge-rollback-${index}.jpg`,
        ticket_id: `MERGE-ROLLBACK-${index}`,
        customer_name: `ลูกค้าทดสอบ rollback ${Math.floor(index / 2)}`,
        total_amount: 1,
        sync_status: "synced",
        record_status: "active",
        created_by_user_id: superAdminId,
      })))).error).toBeNull();
      expect((await service.from("money_transfers").insert(transferIds.map((id, index) => ({
        id,
        client_temp_id: id,
        idempotency_key: `merge-rollback-transfer:${id}`,
        location_id: locationId,
        customer_id: customerIds[Math.floor(index / 2)],
        customer_name: `ลูกค้าทดสอบ rollback ${Math.floor(index / 2)}`,
        account_number: index < 2 ? "5555555555" : "6666666666",
        net_amount_to_pay: 1,
        transfer_type: "customer",
        transfer_method: "bank",
        transfer_status: "pending",
        sync_status: "synced",
        record_status: "active",
        created_by_user_id: superAdminId,
        created_by_name: "LanFlow super_admin",
        created_by_phone: "0800000000",
        created_at: `2026-08-04T0${index + 1}:00:00.000Z`,
      })))).error).toBeNull();
      expect((await service.from("money_transfer_items").insert(transferIds.map((transferId, index) => ({
        transfer_id: transferId,
        source_type: "ocr_ticket",
        source_id: sourceIds[index],
        customer_name: `ลูกค้าทดสอบ rollback ${Math.floor(index / 2)}`,
        amount: index < 2 ? 100 : "9999999999.99",
      })))).error).toBeNull();

      const failed = await client.rpc("merge_pending_money_transfers", {
        p_location_id: locationId,
      });
      expect(failed.error).not.toBeNull();

      const parents = await service
        .from("money_transfers")
        .select("id,record_status,revision_no")
        .in("id", transferIds);
      expect(parents.error).toBeNull();
      expect(parents.data?.every((row) => row.record_status === "active" && row.revision_no === 0)).toBe(true);
      const items = await service
        .from("money_transfer_items")
        .select("transfer_id,source_id")
        .in("source_id", sourceIds);
      expect(items.error).toBeNull();
      expect(items.data).toEqual(expect.arrayContaining(sourceIds.map((sourceId, index) => ({
        source_id: sourceId,
        transfer_id: transferIds[index],
      }))));
    } finally {
      await service.from("money_transfers").delete().in("id", transferIds);
      await service.from("ocr_tickets").delete().in("id", sourceIds);
      await service.from("customers").delete().in("id", customerIds);
    }
  });

  test("rejects revoked capability and a branch outside the actor scope", async () => {
    test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
    const service = serviceClient();
    const actorId = "00000000-0000-4000-8000-000000000003";
    const actorPhone = "+66820000001";
    const client = await signedInClient(actorPhone);
    const outsideLocationId = crypto.randomUUID();
    const assigned = await service
      .from("user_locations")
      .select("location_id")
      .eq("user_id", actorId)
      .limit(1)
      .single();
    expect(assigned.error).toBeNull();

    try {
      expect((await service.from("locations").insert({
        id: outsideLocationId,
        name: `สาขานอกขอบเขต ${outsideLocationId.slice(0, 8)}`,
        code: `OUT-${outsideLocationId.slice(0, 8)}`,
        is_active: true,
      })).error).toBeNull();
      expect((await service.from("profiles").update({
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
      }).eq("id", actorId)).error).toBeNull();
      const revoked = await client.rpc("merge_pending_money_transfers", {
        p_location_id: assigned.data!.location_id,
      });
      expect(revoked.error?.message).toContain("ไม่มีสิทธิ์รวมรายการโอนเงิน");

      expect((await service.from("profiles").update({
        can_access_money_transfer: true,
      }).eq("id", actorId)).error).toBeNull();
      const crossBranch = await client.rpc("merge_pending_money_transfers", {
        p_location_id: outsideLocationId,
      });
      expect(crossBranch.error?.message).toContain("ไม่มีสิทธิ์รวมรายการโอนเงิน");
    } finally {
      await service.from("profiles").update({
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
      }).eq("id", actorId);
      await service.from("locations").delete().eq("id", outsideLocationId);
    }
  });
});
