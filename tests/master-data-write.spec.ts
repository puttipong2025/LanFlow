import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

test.use({ storageState: "playwright/.auth/admin.json" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || "";
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const actor = createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let locationId = "";
const customerIds = new Set<string>();
const staffIds = new Set<string>();

test.beforeAll(async () => {
  expect(serviceRoleKey).not.toBe("");
  const { data, error } = await admin
    .from("locations")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  expect(error).toBeNull();
  locationId = data!.id;

  const { error: signInError } = await actor.auth.signInWithPassword({
    phone: "+66810000001",
    password: process.env.TEST_PASSWORD || "password123",
  });
  expect(signInError).toBeNull();
});

test.afterEach(async () => {
  if (customerIds.size > 0) {
    await admin.from("customers").delete().in("id", [...customerIds]);
    customerIds.clear();
  }
  if (staffIds.size > 0) {
    await admin.from("transport_staffs").delete().in("id", [...staffIds]);
    staffIds.clear();
  }
});

async function openModule(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name, exact: true }).click();
}

test("admin can add a customer with contact details", async ({ page }) => {
  const name = `PW ลูกค้าเพิ่ม ${Date.now()}`;
  const phone = "0891112233";

  await openModule(page, "ลูกค้า");
  await page.getByRole("button", { name: "เพิ่มลูกค้าใหม่" }).click();
  const modal = page.locator("form").filter({
    has: page.getByRole("button", { name: "บันทึกข้อมูลลูกค้า" }),
  });
  await modal.getByPlaceholder("เช่น นางอรนิตย์ สุภากรณ์").fill(name);
  await modal.getByRole("button", { name: "➕ เพิ่ม", exact: true }).first().click();
  await modal.getByPlaceholder("กรอกเบอร์โทรศัพท์").fill(phone);
  await modal.getByRole("button", { name: "บันทึกข้อมูลลูกค้า" }).click();

  await expect.poll(async () => {
    const { data } = await admin.from("customers").select("id").eq("main_name", name).maybeSingle();
    if (data?.id) customerIds.add(data.id);
    return Boolean(data?.id);
  }).toBe(true);

  const customerId = [...customerIds][0];
  await expect.poll(async () => {
    const { data } = await admin
      .from("customers")
      .select("created_by_user_id, created_by_name, created_by_phone, default_location_id")
      .eq("id", customerId)
      .single();
    return data;
  }).toEqual({
    created_by_user_id: "00000000-0000-4000-8000-000000000002",
    created_by_name: "LanFlow admin",
    created_by_phone: "0810000001",
    default_location_id: locationId,
  });
  await expect.poll(async () => {
    const { data } = await admin
      .from("customer_contacts")
      .select("phone")
      .eq("customer_id", customerId)
      .maybeSingle();
    return data?.phone;
  }).toBe(phone);
});

test("admin can edit a customer and its contact details", async ({ page }) => {
  const id = randomUUID();
  const oldName = `PW ลูกค้าเดิม ${Date.now()}`;
  const newName = `${oldName} แก้แล้ว`;
  const phone = "0892223344";
  customerIds.add(id);

  const { error } = await admin.from("customers").insert({
    id,
    client_temp_id: `pw-customer-${id}`,
    class: "สาขานี้จ่าย",
    main_name: oldName,
    default_location_id: null,
    created_by_user_id: "00000000-0000-4000-8000-000000000002",
    created_by_name: "LanFlow admin",
    created_by_phone: "0810000001",
    sync_status: "synced",
    idempotency_key: `pw-customer-${id}`,
    revision_no: 0,
    record_status: "active",
  });
  expect(error).toBeNull();

  await openModule(page, "ลูกค้า");
  const row = page.getByRole("row").filter({ hasText: oldName });
  await row.getByRole("button", { name: "แก้ไขข้อมูลลูกค้า" }).click();
  const modal = page.locator("form").filter({
    has: page.getByRole("button", { name: "บันทึกข้อมูลลูกค้า" }),
  });
  await modal.getByPlaceholder("เช่น นางอรนิตย์ สุภากรณ์").fill(newName);
  await modal.getByRole("button", { name: "➕ เพิ่ม", exact: true }).first().click();
  await modal.getByPlaceholder("กรอกเบอร์โทรศัพท์").fill(phone);
  await modal.getByRole("button", { name: "บันทึกข้อมูลลูกค้า" }).click();

  await expect.poll(async () => {
    const [{ data: customer }, { data: contact }] = await Promise.all([
      admin.from("customers").select("main_name, default_location_id").eq("id", id).single(),
      admin.from("customer_contacts").select("phone").eq("customer_id", id).maybeSingle(),
    ]);
    return {
      name: customer?.main_name,
      locationId: customer?.default_location_id,
      phone: contact?.phone,
    };
  }).toEqual({ name: newName, locationId, phone });
});

test("admin can add transport staff with contact details", async ({ page }) => {
  const name = `PW ขนส่งเพิ่ม ${Date.now()}`;
  const phone = "0893334455";

  await openModule(page, "ขนส่งและพนักงาน");
  await page.getByRole("button", { name: "เพิ่มขนส่งและพนักงานใหม่" }).click();
  const modal = page.locator("form").filter({
    has: page.getByRole("button", { name: "บันทึกข้อมูลขนส่งและพนักงาน" }),
  });
  await modal.getByPlaceholder("เช่น สมชาย ขนส่งยาง").fill(name);
  await modal.getByRole("button", { name: "➕ เพิ่ม", exact: true }).first().click();
  await modal.getByPlaceholder("กรอกเบอร์โทรศัพท์").fill(phone);
  await modal.getByRole("button", { name: "บันทึกข้อมูลขนส่งและพนักงาน" }).click();

  await expect.poll(async () => {
    const { data } = await admin.from("transport_staffs").select("id").eq("main_name", name).maybeSingle();
    if (data?.id) staffIds.add(data.id);
    return Boolean(data?.id);
  }).toBe(true);

  const staffId = [...staffIds][0];
  await expect.poll(async () => {
    const { data } = await admin
      .from("transport_staffs")
      .select("created_by_user_id, created_by_name, created_by_phone, default_location_id")
      .eq("id", staffId)
      .single();
    return data;
  }).toEqual({
    created_by_user_id: "00000000-0000-4000-8000-000000000002",
    created_by_name: "LanFlow admin",
    created_by_phone: "0810000001",
    default_location_id: locationId,
  });
  await expect.poll(async () => {
    const { data } = await admin
      .from("transport_staff_contacts")
      .select("phone")
      .eq("staff_id", staffId)
      .maybeSingle();
    return data?.phone;
  }).toBe(phone);
});

test("admin can edit transport staff and its contact details", async ({ page }) => {
  const id = randomUUID();
  const oldName = `PW ขนส่งเดิม ${Date.now()}`;
  const newName = `${oldName} แก้แล้ว`;
  const phone = "0894445566";
  staffIds.add(id);

  const { error } = await admin.from("transport_staffs").insert({
    id,
    client_temp_id: `pw-staff-${id}`,
    main_name: oldName,
    default_location_id: null,
    created_by_user_id: "00000000-0000-4000-8000-000000000002",
    created_by_name: "LanFlow admin",
    created_by_phone: "0810000001",
    sync_status: "synced",
    idempotency_key: `pw-staff-${id}`,
    revision_no: 0,
    record_status: "active",
  });
  expect(error).toBeNull();

  await openModule(page, "ขนส่งและพนักงาน");
  const row = page.getByRole("row").filter({ hasText: oldName });
  await row.getByRole("button", { name: "แก้ไข", exact: true }).click();
  const modal = page.locator("form").filter({
    has: page.getByRole("button", { name: "บันทึกข้อมูลขนส่งและพนักงาน" }),
  });
  await modal.getByPlaceholder("เช่น สมชาย ขนส่งยาง").fill(newName);
  await modal.getByRole("button", { name: "➕ เพิ่ม", exact: true }).first().click();
  await modal.getByPlaceholder("กรอกเบอร์โทรศัพท์").fill(phone);
  await modal.getByRole("button", { name: "บันทึกข้อมูลขนส่งและพนักงาน" }).click();

  await expect.poll(async () => {
    const [{ data: staff }, { data: contact }] = await Promise.all([
      admin.from("transport_staffs").select("main_name, default_location_id").eq("id", id).single(),
      admin.from("transport_staff_contacts").select("phone").eq("staff_id", id).maybeSingle(),
    ]);
    return {
      name: staff?.main_name,
      locationId: staff?.default_location_id,
      phone: contact?.phone,
    };
  }).toEqual({ name: newName, locationId, phone });
});

test("master-data RPCs enforce branch access and roll back partial writes", async () => {
  const deniedTempId = `pw-denied-${randomUUID()}`;
  const { error: deniedError } = await actor.rpc("save_customer_master_data", {
    payload: {
      clientTempId: deniedTempId,
      idempotencyKey: deniedTempId,
      mainName: "PW denied customer",
      class: "สาขานี้จ่าย",
      defaultLocationId: randomUUID(),
      contacts: [],
      bankAccounts: [],
      farms: [],
    },
  });

  expect(deniedError?.code).toBe("42501");
  expect((await admin.from("customers").select("id").eq("client_temp_id", deniedTempId)).data).toEqual([]);

  const rollbackTempId = `pw-rollback-${randomUUID()}`;
  const { error: rollbackError } = await actor.rpc("save_customer_master_data", {
    payload: {
      clientTempId: rollbackTempId,
      idempotencyKey: rollbackTempId,
      mainName: "PW rollback customer",
      class: "สาขานี้จ่าย",
      defaultLocationId: locationId,
      contacts: [{ phone: "0895556677" }],
      bankAccounts: [
        { bankName: "ธ.ก.ส.", accountNumber: "111", accountName: "One", isPrimary: true },
        { bankName: "ธ.ก.ส.", accountNumber: "222", accountName: "Two", isPrimary: true },
      ],
      farms: [],
    },
  });

  expect(rollbackError?.code).toBe("23505");
  expect((await admin.from("customers").select("id").eq("client_temp_id", rollbackTempId)).data).toEqual([]);
});
