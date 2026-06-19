import { createClient } from "@supabase/supabase-js";
import type { IncomeExpense, Location, Profile, RubberBill } from "@/types";

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
    transactionsResult
  ] = await Promise.all([
    supabase.from("locations").select("*").order("created_at", { ascending: true }),
    supabase.from("profiles").select("*").eq("id", DEV_PROFILE_ID).single(),
    supabase.from("user_locations").select("location_id").eq("user_id", DEV_PROFILE_ID),
    supabase.from("rubber_bills").select("*").order("created_at", { ascending: false }),
    supabase.from("rubber_bill_items").select("*").order("created_at", { ascending: true }),
    supabase.from("income_expense").select("*").order("created_at", { ascending: false })
  ]);

  if (locationsResult.error) throw locationsResult.error;
  if (profileResult.error) throw profileResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;
  if (billsResult.error) throw billsResult.error;
  if (billItemsResult.error) throw billItemsResult.error;
  if (transactionsResult.error) throw transactionsResult.error;

  const billItems = billItemsResult.data ?? [];

  return {
    locations: (locationsResult.data ?? []).map(rowToLocation),
    profile: rowToProfile(profileResult.data, (assignmentsResult.data ?? []).map((item) => item.location_id)),
    bills: (billsResult.data ?? []).map((bill) => rowToRubberBill(bill, billItems.filter((item) => item.bill_id === bill.id))),
    transactions: (transactionsResult.data ?? []).map(rowToIncomeExpense)
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
      total: item.netWeight * item.price
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
    ...(bill.debtItem ? [{
      bill_id: billId,
      item_type: "debt",
      description: bill.debtItem.title,
      total: bill.debtItem.amount
    }] : [])
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
  entityType: "rubber_bill" | "income_expense",
  operationType: "create" | "update" | "delete",
  payload: RubberBill | IncomeExpense,
  locationId: string,
  serverId: string,
  serverReceivedAt: string
) {
  const supabase = getAdminClient();
  const { error } = await supabase.from("offline_sync_events").upsert({
    client_temp_id: payload.clientTempId,
    idempotency_key: payload.idempotencyKey,
    entity_type: entityType,
    operation_type: operationType,
    location_id: locationId,
    payload,
    status: "synced",
    server_id: serverId,
    created_by_user_id: DEV_PROFILE_ID,
    client_recorded_at: payload.clientRecordedAt,
    client_created_at: payload.clientCreatedAt,
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
  const debtRow = items.find((item) => item.item_type === "debt");

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
    debtItem: debtRow ? {
      id: debtRow.id,
      title: debtRow.description ?? "หักชำระหนี้",
      amount: Number(debtRow.total ?? 0)
    } : undefined,
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
