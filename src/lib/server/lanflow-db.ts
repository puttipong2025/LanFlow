import { createClient } from "@supabase/supabase-js";
import type { IncomeExpense, Location, Profile, RubberBill, Customer, CustomerContact, CustomerBankAccount, CustomerFarm } from "@/types";

const DEV_PROFILE_ID = "00000000-0000-4000-8000-000000000001";
const DEV_LOCATIONS = [
  { id: "00000000-0000-4000-8000-000000000101", name: "ลานข้าวหอม", code: "LKH" },
  { id: "00000000-0000-4000-8000-000000000102", name: "ชานุมาน", code: "CNM" },
  { id: "00000000-0000-4000-8000-000000000103", name: "ป่ากุงใหญ่", code: "PKY" }
];

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase server env is not configured.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function compactDate(value: string) {
  return value.slice(2, 10).replace(/-/g, "");
}

async function makeServerBillNo(
  table: "rubber_bills" | "income_expense",
  locationId: string,
  dateColumn: "bill_date" | "tx_date",
  dateValue: string
) {
  const supabase = getAdminClient();
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("location_id", locationId)
    .eq(dateColumn, dateValue);

  if (error) throw error;
  return `${compactDate(dateValue)}-${String((count ?? 0) + 1).padStart(3, "0")}`;
}

export async function ensureLanFlowBootstrap() {
  const supabase = getAdminClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", DEV_PROFILE_ID)
    .maybeSingle();

  if (profileError) throw profileError;

  if (!profile) {
    const { error } = await supabase.from("profiles").insert({
      id: DEV_PROFILE_ID,
      phone: "0800000000",
      name: "ผู้ดูแลระบบ",
      role: "super_admin",
      is_active: true
    });
    if (error) throw error;
  }

  for (const location of DEV_LOCATIONS) {
    const { error: locationError } = await supabase.from("locations").upsert({
      id: location.id,
      name: location.name,
      code: location.code,
      is_active: true,
      created_by: DEV_PROFILE_ID
    });
    if (locationError) throw locationError;

    const { error: assignmentError } = await supabase.from("user_locations").upsert({
      user_id: DEV_PROFILE_ID,
      location_id: location.id,
      assigned_by: DEV_PROFILE_ID,
      is_primary: location.id === DEV_LOCATIONS[0].id
    }, {
      onConflict: "user_id,location_id"
    });
    if (assignmentError) throw assignmentError;
  }
}

export async function getLanFlowData() {
  await ensureLanFlowBootstrap();
  const supabase = getAdminClient();

  const [
    locationsResult,
    profileResult,
    assignmentsResult,
    billsResult,
    billItemsResult,
    transactionsResult,
    customersResult,
    customerContactsResult,
    customerBanksResult,
    customerFarmsResult
  ] = await Promise.all([
    supabase.from("locations").select("*").order("created_at", { ascending: true }),
    supabase.from("profiles").select("*").eq("id", DEV_PROFILE_ID).single(),
    supabase.from("user_locations").select("location_id").eq("user_id", DEV_PROFILE_ID),
    supabase.from("rubber_bills").select("*").order("created_at", { ascending: false }),
    supabase.from("rubber_bill_items").select("*").order("created_at", { ascending: true }),
    supabase.from("income_expense").select("*").order("created_at", { ascending: false }),
    supabase.from("customers").select("*").neq("record_status", "deleted").order("created_at", { ascending: false }),
    supabase.from("customer_contacts").select("*"),
    supabase.from("customer_bank_accounts").select("*"),
    supabase.from("customer_farms").select("*")
  ]);

  if (locationsResult.error) throw locationsResult.error;
  if (profileResult.error) throw profileResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;
  if (billsResult.error) throw billsResult.error;
  if (billItemsResult.error) throw billItemsResult.error;
  if (transactionsResult.error) throw transactionsResult.error;
  if (customersResult.error) throw customersResult.error;
  if (customerContactsResult.error) throw customerContactsResult.error;
  if (customerBanksResult.error) throw customerBanksResult.error;
  if (customerFarmsResult.error) throw customerFarmsResult.error;

  const billItems = billItemsResult.data ?? [];
  const contacts = customerContactsResult.data ?? [];
  const bankAccounts = customerBanksResult.data ?? [];
  const farms = customerFarmsResult.data ?? [];

  return {
    locations: (locationsResult.data ?? []).map(rowToLocation),
    profile: rowToProfile(profileResult.data, (assignmentsResult.data ?? []).map((item) => item.location_id)),
    bills: (billsResult.data ?? []).map((bill) => rowToRubberBill(bill, billItems.filter((item) => item.bill_id === bill.id))),
    transactions: (transactionsResult.data ?? []).map(rowToIncomeExpense),
    customers: (customersResult.data ?? []).map((cust) => rowToCustomer(
      cust,
      contacts.filter(item => item.customer_id === cust.id),
      bankAccounts.filter(item => item.customer_id === cust.id),
      farms.filter(item => item.customer_id === cust.id)
    ))
  };
}

export async function saveRubberBill(bill: RubberBill) {
  await ensureLanFlowBootstrap();
  const supabase = getAdminClient();
  const serverReceivedAt = new Date().toISOString();
  const serverBillNo = bill.serverBillNo ?? await makeServerBillNo("rubber_bills", bill.locationId, "bill_date", bill.billDate);

  const row = {
    client_temp_id: bill.clientTempId,
    local_bill_no: bill.localBillNo,
    server_bill_no: serverBillNo,
    idempotency_key: bill.idempotencyKey,
    sync_status: "synced",
    record_status: bill.recordStatus,
    location_id: bill.locationId,
    bill_no: serverBillNo,
    bill_date: bill.billDate,
    customer_name: bill.customerName,
    customer_type: bill.customerType,
    bill_type: bill.billType,
    weight: bill.weight,
    rubber_value: bill.netTotal + bill.deductionTotal,
    average_price: bill.price,
    deduction_total: bill.deductionTotal,
    net_total: bill.netTotal,
    cash_payment: bill.cashPayment,
    transfer_payment: bill.transferPayment,
    acid_pack_count: bill.acidPackCount,
    client_recorded_at: bill.clientRecordedAt,
    client_created_at: bill.clientCreatedAt,
    server_received_at: serverReceivedAt,
    revision_no: bill.revisionNo,
    deleted_at: bill.deletedAt,
    deleted_by_name: bill.deletedByName,
    deleted_by_phone: bill.deletedByPhone,
    created_by_user_id: DEV_PROFILE_ID,
    created_by_name: bill.createdByName,
    created_by_phone: bill.createdByPhone,
    updated_at: serverReceivedAt
  };

  const existing = await supabase
    .from("rubber_bills")
    .select("id")
    .eq("client_temp_id", bill.clientTempId)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const result = existing.data?.id
    ? await supabase.from("rubber_bills").update(row).eq("id", existing.data.id).select("*").single()
    : await supabase.from("rubber_bills").insert(row).select("*").single();

  if (result.error) throw result.error;
  const billId = result.data.id;

  const { error: deleteItemsError } = await supabase.from("rubber_bill_items").delete().eq("bill_id", billId);
  if (deleteItemsError) throw deleteItemsError;

  const items = [
    ...(bill.weighItems ?? []).map((item) => ({
      bill_id: billId,
      item_type: "weigh",
      description: item.label,
      weight_in: item.inWeight,
      weight_out: item.outWeight,
      net_weight: item.netWeight,
      price: item.price,
      total: Math.floor(item.netWeight * item.price)
    })),
    ...(bill.acidItems ?? []).map((item) => ({
      bill_id: billId,
      item_type: "acid",
      description: item.name,
      quantity: item.quantity,
      unit: item.unit,
      price: item.unitPrice,
      total: item.quantity * item.unitPrice
    })),
    ...((bill.debtItems ?? (bill.debtItem ? [bill.debtItem] : [])).map((item) => ({
      bill_id: billId,
      item_type: "debt",
      description: item.title,
      total: item.amount
    })))
  ];

  if (items.length > 0) {
    const { error: insertItemsError } = await supabase.from("rubber_bill_items").insert(items);
    if (insertItemsError) throw insertItemsError;
  }

  await saveSyncEvent("rubber_bill", bill.recordStatus === "deleted" ? "delete" : existing.data?.id ? "update" : "create", bill, bill.locationId, billId, serverReceivedAt);

  const savedItems = await supabase.from("rubber_bill_items").select("*").eq("bill_id", billId).order("created_at", { ascending: true });
  if (savedItems.error) throw savedItems.error;

  return rowToRubberBill(result.data, savedItems.data ?? []);
}

export async function saveIncomeExpense(transaction: IncomeExpense) {
  await ensureLanFlowBootstrap();
  const supabase = getAdminClient();
  const serverReceivedAt = new Date().toISOString();
  const serverBillNo = transaction.serverBillNo ?? await makeServerBillNo("income_expense", transaction.locationId, "tx_date", transaction.txDate);

  const row = {
    client_temp_id: transaction.clientTempId,
    local_bill_no: transaction.localBillNo,
    server_bill_no: serverBillNo,
    idempotency_key: transaction.idempotencyKey,
    sync_status: "synced",
    record_status: transaction.recordStatus,
    location_id: transaction.locationId,
    type: transaction.type,
    number: serverBillNo,
    tx_date: transaction.txDate,
    title: transaction.title,
    cost: transaction.cost,
    unit: transaction.unit,
    price: transaction.price,
    bill_option: transaction.billOption,
    transaction_option: transaction.transactionOption,
    client_recorded_at: transaction.clientRecordedAt,
    client_created_at: transaction.clientCreatedAt,
    server_received_at: serverReceivedAt,
    revision_no: transaction.revisionNo,
    deleted_at: transaction.deletedAt,
    deleted_by_name: transaction.deletedByName,
    deleted_by_phone: transaction.deletedByPhone,
    created_by_user_id: DEV_PROFILE_ID,
    created_by_name: transaction.createdByName,
    created_by_phone: transaction.createdByPhone,
    updated_at: serverReceivedAt
  };

  const existing = await supabase
    .from("income_expense")
    .select("id")
    .eq("client_temp_id", transaction.clientTempId)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const result = existing.data?.id
    ? await supabase.from("income_expense").update(row).eq("id", existing.data.id).select("*").single()
    : await supabase.from("income_expense").insert(row).select("*").single();

  if (result.error) throw result.error;
  await saveSyncEvent("income_expense", transaction.recordStatus === "deleted" ? "delete" : existing.data?.id ? "update" : "create", transaction, transaction.locationId, result.data.id, serverReceivedAt);
  return rowToIncomeExpense(result.data);
}

async function saveSyncEvent(
  entityType: "rubber_bill" | "income_expense" | "customer",
  operationType: "create" | "update" | "delete",
  payload: any,
  locationId: string | null,
  serverId: string,
  serverReceivedAt: string
) {
  const supabase = getAdminClient();
  const { error } = await supabase.from("offline_sync_events").upsert({
    client_temp_id: payload.clientTempId || payload.id,
    idempotency_key: payload.idempotencyKey || `server:${serverId}`,
    entity_type: entityType,
    operation_type: operationType,
    location_id: locationId,
    payload,
    status: "synced",
    server_id: serverId,
    created_by_user_id: DEV_PROFILE_ID,
    client_recorded_at: payload.clientRecordedAt || serverReceivedAt,
    client_created_at: payload.clientCreatedAt || serverReceivedAt,
    server_received_at: serverReceivedAt
  }, {
    onConflict: "idempotency_key"
  });

  if (error) throw error;
}

function rowToLocation(row: any): Location {
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? row.name.slice(0, 3).toUpperCase(),
    active: row.is_active
  };
}

function rowToProfile(row: any, locationIds: string[]): Profile {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    role: row.role,
    locationIds
  };
}

function rowToRubberBill(row: any, items: any[]): RubberBill {
  const weighItems = items
    .filter((item) => item.item_type === "weigh")
    .map((item) => ({
      id: item.id,
      label: item.description ?? "ชั่ง",
      inWeight: Number(item.weight_in ?? 0),
      outWeight: Number(item.weight_out ?? 0),
      netWeight: Number(item.net_weight ?? 0),
      price: Number(item.price ?? 0)
    }));
  const acidItems = items
    .filter((item) => item.item_type === "acid")
    .map((item) => ({
      id: item.id,
      name: item.description ?? "น้ำกรด",
      quantity: Number(item.quantity ?? 0),
      unit: item.unit ?? "แพ็ค",
      unitPrice: Number(item.price ?? 0)
    }));
  const debtItems = items
    .filter((item) => item.item_type === "debt")
    .map((item) => ({
      id: item.id,
      title: item.description ?? "หักชำระหนี้",
      amount: Number(item.total ?? 0)
    }));

  return {
    id: row.id,
    clientTempId: row.client_temp_id ?? row.id,
    localBillNo: row.local_bill_no,
    serverBillNo: row.server_bill_no ?? undefined,
    syncStatus: row.sync_status,
    idempotencyKey: row.idempotency_key ?? `server:${row.id}`,
    locationId: row.location_id,
    billNo: row.bill_no,
    billDate: row.bill_date,
    customerName: row.customer_name ?? "",
    customerType: row.customer_type,
    billType: row.bill_type,
    weight: Number(row.weight ?? 0),
    price: Number(row.average_price ?? 0),
    deductionTotal: Number(row.deduction_total ?? 0),
    netTotal: Number(row.net_total ?? 0),
    cashPayment: Number(row.cash_payment ?? 0),
    transferPayment: Number(row.transfer_payment ?? 0),
    acidPackCount: Number(row.acid_pack_count ?? 0),
    weighItems,
    acidItems,
    debtItem: debtItems[0],
    debtItems,
    createdByName: row.created_by_name,
    createdByPhone: row.created_by_phone,
    clientCreatedAt: row.client_created_at ?? row.created_at,
    serverCreatedAt: row.created_at,
    clientRecordedAt: row.client_recorded_at ?? row.created_at,
    serverReceivedAt: row.server_received_at ?? undefined,
    revisionNo: row.revision_no ?? 0,
    recordStatus: row.record_status,
    deletedAt: row.deleted_at ?? undefined,
    deletedByName: row.deleted_by_name ?? undefined,
    deletedByPhone: row.deleted_by_phone ?? undefined
  };
}

function rowToIncomeExpense(row: any): IncomeExpense {
  return {
    id: row.id,
    clientTempId: row.client_temp_id ?? row.id,
    localBillNo: row.local_bill_no,
    serverBillNo: row.server_bill_no ?? undefined,
    syncStatus: row.sync_status,
    idempotencyKey: row.idempotency_key ?? `server:${row.id}`,
    locationId: row.location_id,
    type: row.type,
    number: row.number,
    txDate: row.tx_date,
    title: row.title,
    cost: Number(row.cost ?? 0),
    billOption: row.bill_option ?? "",
    transactionOption: row.transaction_option ?? "",
    unit: row.unit ?? undefined,
    price: row.price === null ? undefined : Number(row.price),
    createdByName: row.created_by_name,
    createdByPhone: row.created_by_phone,
    clientCreatedAt: row.client_created_at ?? row.created_at,
    serverCreatedAt: row.created_at,
    clientRecordedAt: row.client_recorded_at ?? row.created_at,
    serverReceivedAt: row.server_received_at ?? undefined,
    revisionNo: row.revision_no ?? 0,
    recordStatus: row.record_status,
    deletedAt: row.deleted_at ?? undefined,
    deletedByName: row.deleted_by_name ?? undefined,
    deletedByPhone: row.deleted_by_phone ?? undefined
  };
}

function rowToCustomerContact(row: any): CustomerContact {
  return {
    id: row.id,
    phone: row.phone
  };
}

function rowToCustomerBankAccount(row: any): CustomerBankAccount {
  return {
    id: row.id,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    accountName: row.account_name,
    isPrimary: row.is_primary ?? false
  };
}

function rowToCustomerFarm(row: any): CustomerFarm {
  return {
    id: row.id,
    ownerName: row.owner_name ?? "",
    address: row.address ?? "",
    cardNumber: row.card_number ?? ""
  };
}

function rowToCustomer(row: any, contacts: any[], bankAccounts: any[], farms: any[]): Customer {
  return {
    id: row.id,
    clientTempId: row.client_temp_id ?? row.legacy_rec_id ?? row.id,
    legacyRecId: row.legacy_rec_id ?? undefined,
    legacyMemberId: row.legacy_member_id ?? undefined,
    class: row.class,
    mainName: row.main_name,
    fscStatus: row.fsc_status ?? undefined,
    startingPointsDate: row.starting_points_date ?? undefined,
    defaultLocationId: row.default_location_id ?? undefined,
    createdByUserId: row.created_by_user_id ?? undefined,
    createdByName: row.created_by_name ?? undefined,
    createdByPhone: row.created_by_phone ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status ?? "synced",
    idempotencyKey: row.idempotency_key ?? `server:${row.id}`,
    revisionNo: row.revision_no ?? 0,
    recordStatus: row.record_status ?? "active",
    contacts: contacts.map(rowToCustomerContact),
    bankAccounts: bankAccounts.map(rowToCustomerBankAccount),
    farms: farms.map(rowToCustomerFarm)
  };
}

export async function saveCustomer(customer: Customer) {
  await ensureLanFlowBootstrap();
  const supabase = getAdminClient();
  const serverReceivedAt = new Date().toISOString();

  const row = {
    client_temp_id: customer.clientTempId ?? null,
    idempotency_key: customer.idempotencyKey ?? null,
    legacy_rec_id: customer.legacyRecId ?? customer.clientTempId ?? null,
    legacy_member_id: customer.legacyMemberId ?? null,
    class: customer.class,
    main_name: customer.mainName,
    fsc_status: customer.fscStatus ?? null,
    starting_points_date: customer.startingPointsDate ?? null,
    default_location_id: customer.defaultLocationId ?? null,
    revision_no: customer.revisionNo ?? 0,
    sync_status: "synced",
    record_status: customer.recordStatus ?? "active",
    client_recorded_at: customer.createdAt ?? serverReceivedAt,
    client_created_at: customer.createdAt ?? serverReceivedAt,
    server_received_at: serverReceivedAt,
    created_by_user_id: DEV_PROFILE_ID,
    created_by_name: customer.createdByName ?? "ผู้ดูแลระบบ",
    created_by_phone: customer.createdByPhone ?? "0800000000",
    updated_at: serverReceivedAt
  };

  // BUG-2 fix: Use two separate safe queries instead of .or() with string interpolation
  let existingId: string | null = null;

  const byId = await supabase
    .from("customers")
    .select("id")
    .eq("id", customer.id)
    .maybeSingle();
  if (byId.error) throw byId.error;
  existingId = byId.data?.id ?? null;

  if (!existingId && customer.clientTempId) {
    const byClientTempId = await supabase
      .from("customers")
      .select("id")
      .eq("client_temp_id", customer.clientTempId)
      .maybeSingle();
    if (byClientTempId.error) throw byClientTempId.error;
    existingId = byClientTempId.data?.id ?? null;
  }

  let result;
  if (existingId) {
    // BUG-3 fix: Optimistic lock — check revision_no before updating
    const currentRow = await supabase
      .from("customers")
      .select("revision_no")
      .eq("id", existingId)
      .single();
    if (currentRow.error) throw currentRow.error;

    const dbRevision = currentRow.data.revision_no ?? 0;
    const clientRevision = customer.revisionNo ?? 0;
    if (clientRevision < dbRevision) {
      // Client data is older than DB — reject and return latest data
      const latestRow = await supabase.from("customers").select("*").eq("id", existingId).single();
      if (latestRow.error) throw latestRow.error;
      const [c, b, f] = await Promise.all([
        supabase.from("customer_contacts").select("*").eq("customer_id", existingId),
        supabase.from("customer_bank_accounts").select("*").eq("customer_id", existingId),
        supabase.from("customer_farms").select("*").eq("customer_id", existingId)
      ]);
      return rowToCustomer(latestRow.data, c.data ?? [], b.data ?? [], f.data ?? []);
    }

    result = await supabase.from("customers").update(row).eq("id", existingId).select("*").single();
  } else {
    result = await supabase.from("customers").insert({ ...row, id: customer.id }).select("*").single();
  }

  if (result.error) throw result.error;
  const customerId = result.data.id;

  // Delete and insert contacts
  const { error: deleteContactsError } = await supabase.from("customer_contacts").delete().eq("customer_id", customerId);
  if (deleteContactsError) throw deleteContactsError;
  if (customer.contacts && customer.contacts.length > 0) {
    const contactRows = customer.contacts.map(c => ({
      customer_id: customerId,
      phone: c.phone
    }));
    const { error: insertContactsError } = await supabase.from("customer_contacts").insert(contactRows);
    if (insertContactsError) throw insertContactsError;
  }

  // Delete and insert bank accounts
  const { error: deleteBanksError } = await supabase.from("customer_bank_accounts").delete().eq("customer_id", customerId);
  if (deleteBanksError) throw deleteBanksError;
  if (customer.bankAccounts && customer.bankAccounts.length > 0) {
    const bankRows = customer.bankAccounts.map(b => ({
      customer_id: customerId,
      bank_name: b.bankName,
      account_number: b.accountNumber,
      account_name: b.accountName,
      is_primary: b.isPrimary ?? false
    }));
    const { error: insertBanksError } = await supabase.from("customer_bank_accounts").insert(bankRows);
    if (insertBanksError) throw insertBanksError;
  }

  // Delete and insert farms
  const { error: deleteFarmsError } = await supabase.from("customer_farms").delete().eq("customer_id", customerId);
  if (deleteFarmsError) throw deleteFarmsError;
  if (customer.farms && customer.farms.length > 0) {
    const farmRows = customer.farms.map(f => ({
      customer_id: customerId,
      owner_name: f.ownerName,
      address: f.address,
      card_number: f.cardNumber
    }));
    const { error: insertFarmsError } = await supabase.from("customer_farms").insert(farmRows);
    if (insertFarmsError) throw insertFarmsError;
  }

  await saveSyncEvent("customer", customer.recordStatus === "deleted" ? "delete" : existingId ? "update" : "create", customer, null, customerId, serverReceivedAt);

  const [contactsRes, banksRes, farmsRes] = await Promise.all([
    supabase.from("customer_contacts").select("*").eq("customer_id", customerId),
    supabase.from("customer_bank_accounts").select("*").eq("customer_id", customerId),
    supabase.from("customer_farms").select("*").eq("customer_id", customerId)
  ]);

  return rowToCustomer(result.data, contactsRes.data ?? [], banksRes.data ?? [], farmsRes.data ?? []);
}

// BUG-4 fix: Soft-delete with sync event logging instead of hard delete
export async function deleteCustomer(id: string) {
  await ensureLanFlowBootstrap();
  const supabase = getAdminClient();
  const serverReceivedAt = new Date().toISOString();

  // Soft-delete: mark as deleted rather than removing the row
  const { data, error } = await supabase
    .from("customers")
    .update({
      record_status: "deleted",
      sync_status: "synced",
      deleted_at: serverReceivedAt,
      deleted_by_name: "ผู้ดูแลระบบ",
      deleted_by_phone: "0800000000",
      updated_at: serverReceivedAt
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  // Log sync event for audit trail
  await saveSyncEvent("customer", "delete", data, null, id, serverReceivedAt);
}
