import type { SupabaseClient } from "@supabase/supabase-js";
import type { IncomeExpense, Location, Profile, RubberBill, Customer, CustomerContact, CustomerBankAccount, CustomerFarm, OcrTicket, TransportStaff, TransportStaffPlate, MoneyTransfer, MoneyTransferSlip, MoneyTransferItem } from "@/types";

export type LanFlowDataClient = SupabaseClient;

function compactDate(value: string) {
  return value.slice(2, 10).replace(/-/g, "");
}

async function makeServerBillNo(
  supabase: LanFlowDataClient,
  table: "rubber_bills" | "income_expense",
  locationId: string,
  dateColumn: "bill_date" | "tx_date",
  dateValue: string
) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("location_id", locationId)
    .eq(dateColumn, dateValue);

  if (error) throw error;
  return `${compactDate(dateValue)}-${String((count ?? 0) + 1).padStart(3, "0")}`;
}

export async function getLanFlowData(supabase: LanFlowDataClient, userId: string) {
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
    supabase
      .from("profiles")
      .select("id, phone, name, role, is_active")
      .eq("id", userId)
      .single(),
    supabase.from("user_locations").select("location_id").eq("user_id", userId),
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
    )),
    ocrTickets: [] as OcrTicket[]
  };
}

export async function saveRubberBill(
  supabase: LanFlowDataClient,
  bill: RubberBill,
  userId: string
) {
  const serverReceivedAt = new Date().toISOString();
  const serverBillNo = bill.serverBillNo ?? await makeServerBillNo(supabase, "rubber_bills", bill.locationId, "bill_date", bill.billDate);

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
    created_by_user_id: userId,
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

  await saveSyncEvent(supabase, "rubber_bill", bill.recordStatus === "deleted" ? "delete" : existing.data?.id ? "update" : "create", bill, bill.locationId, billId, serverReceivedAt, userId);

  const savedItems = await supabase.from("rubber_bill_items").select("*").eq("bill_id", billId).order("created_at", { ascending: true });
  if (savedItems.error) throw savedItems.error;

  return rowToRubberBill(result.data, savedItems.data ?? []);
}

export async function saveIncomeExpense(
  supabase: LanFlowDataClient,
  transaction: IncomeExpense,
  userId: string
) {
  const serverReceivedAt = new Date().toISOString();
  const serverBillNo = transaction.serverBillNo ?? await makeServerBillNo(supabase, "income_expense", transaction.locationId, "tx_date", transaction.txDate);

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
    created_by_user_id: userId,
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
  await saveSyncEvent(supabase, "income_expense", transaction.recordStatus === "deleted" ? "delete" : existing.data?.id ? "update" : "create", transaction, transaction.locationId, result.data.id, serverReceivedAt, userId);
  return rowToIncomeExpense(result.data);
}

async function saveSyncEvent(
  supabase: LanFlowDataClient,
  entityType: "rubber_bill" | "income_expense" | "customer" | "ocr_ticket" | "transport_staff" | "money_transfer",
  operationType: "create" | "update" | "delete",
  payload: any,
  locationId: string | null,
  serverId: string,
  serverReceivedAt: string,
  userId: string
) {
  const { error } = await supabase.from("offline_sync_events").upsert({
    client_temp_id: payload.clientTempId || payload.id,
    idempotency_key: payload.idempotencyKey || `server:${serverId}`,
    entity_type: entityType,
    operation_type: operationType,
    location_id: locationId,
    payload,
    status: "synced",
    server_id: serverId,
    created_by_user_id: userId,
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

export async function saveCustomer(
  supabase: LanFlowDataClient,
  customer: Customer,
  userId: string
) {
  if (!customer.mainName || customer.mainName.trim() === "") {
    throw new Error("Validation Error: mainName is required");
  }

  if (customer.contacts) {
    for (const c of customer.contacts) {
      if (c.phone && c.phone.trim() !== "") {
        const digits = c.phone.replace(/\D/g, "");
        if (digits.length < 9 || digits.length > 10) {
          throw new Error(`Validation Error: invalid phone format (${c.phone}), must be 9-10 digits`);
        }
      }
    }
  }

  if (customer.farms) {
    for (const f of customer.farms) {
      if (f.cardNumber && f.cardNumber.trim() !== "") {
        const digits = f.cardNumber.replace(/\D/g, "");
        if (digits.length !== 13) {
          throw new Error(`Validation Error: card number must be exactly 13 digits (${f.cardNumber})`);
        }
      }
    }
  }

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
    created_by_user_id: userId,
    created_by_name: customer.createdByName ?? "ผู้ดูแลระบบ",
    created_by_phone: customer.createdByPhone ?? "0800000000",
    updated_by_user_id: userId,
    updated_by_name: customer.createdByName ?? "ผู้ดูแลระบบ",
    updated_by_phone: customer.createdByPhone ?? "0800000000",
    updated_at: serverReceivedAt
  };

  // BUG-2 fix: Use two separate safe queries instead of .or() with string interpolation
  let existingId: string | null = null;
  const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  if (customer.id && isUuid(customer.id)) {
    const byId = await supabase
      .from("customers")
      .select("id")
      .eq("id", customer.id)
      .maybeSingle();
    if (byId.error) throw byId.error;
    existingId = byId.data?.id ?? null;
  }

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
    const insertRow: any = { ...row };
    if (customer.id && isUuid(customer.id)) {
      insertRow.id = customer.id;
    }
    result = await supabase.from("customers").insert(insertRow).select("*").single();
  }

  if (result.error) throw result.error;
  const customerId = result.data.id;

  // Upsert contacts
  const validIncomingContactIds = (customer.contacts || []).map(c => c.id).filter(id => id && isUuid(id));
  if (validIncomingContactIds.length > 0) {
    const { error: deleteContactsError } = await supabase.from("customer_contacts").delete().eq("customer_id", customerId).not("id", "in", `(${validIncomingContactIds.join(",")})`);
    if (deleteContactsError) throw deleteContactsError;
  } else {
    const { error: deleteContactsError } = await supabase.from("customer_contacts").delete().eq("customer_id", customerId);
    if (deleteContactsError) throw deleteContactsError;
  }

  if (customer.contacts && customer.contacts.length > 0) {
    const contactRows = customer.contacts.map(c => {
      const contactRow: any = { customer_id: customerId, phone: c.phone };
      if (c.id && isUuid(c.id)) contactRow.id = c.id;
      return contactRow;
    });
    const { error: upsertContactsError } = await supabase.from("customer_contacts").upsert(contactRows, { onConflict: "id" });
    if (upsertContactsError) throw upsertContactsError;
  }

  // Upsert bank accounts
  const validIncomingBankIds = (customer.bankAccounts || []).map(b => b.id).filter(id => id && isUuid(id));
  if (validIncomingBankIds.length > 0) {
    const { error: deleteBanksError } = await supabase.from("customer_bank_accounts").delete().eq("customer_id", customerId).not("id", "in", `(${validIncomingBankIds.join(",")})`);
    if (deleteBanksError) throw deleteBanksError;
  } else {
    const { error: deleteBanksError } = await supabase.from("customer_bank_accounts").delete().eq("customer_id", customerId);
    if (deleteBanksError) throw deleteBanksError;
  }

  if (customer.bankAccounts && customer.bankAccounts.length > 0) {
    const bankRows = customer.bankAccounts.map(b => {
      const bankRow: any = {
        customer_id: customerId,
        bank_name: b.bankName,
        account_number: b.accountNumber,
        account_name: b.accountName,
        is_primary: b.isPrimary ?? false
      };
      if (b.id && isUuid(b.id)) bankRow.id = b.id;
      return bankRow;
    });
    const { error: upsertBanksError } = await supabase.from("customer_bank_accounts").upsert(bankRows, { onConflict: "id" });
    if (upsertBanksError) throw upsertBanksError;
  }

  // Upsert farms
  const validIncomingFarmIds = (customer.farms || []).map(f => f.id).filter(id => id && isUuid(id));
  if (validIncomingFarmIds.length > 0) {
    const { error: deleteFarmsError } = await supabase.from("customer_farms").delete().eq("customer_id", customerId).not("id", "in", `(${validIncomingFarmIds.join(",")})`);
    if (deleteFarmsError) throw deleteFarmsError;
  } else {
    const { error: deleteFarmsError } = await supabase.from("customer_farms").delete().eq("customer_id", customerId);
    if (deleteFarmsError) throw deleteFarmsError;
  }

  if (customer.farms && customer.farms.length > 0) {
    const farmRows = customer.farms.map(f => {
      const farmRow: any = {
        customer_id: customerId,
        owner_name: f.ownerName,
        address: f.address,
        card_number: f.cardNumber
      };
      if (f.id && isUuid(f.id)) farmRow.id = f.id;
      return farmRow;
    });
    const { error: upsertFarmsError } = await supabase.from("customer_farms").upsert(farmRows, { onConflict: "id" });
    if (upsertFarmsError) throw upsertFarmsError;
  }

  await saveSyncEvent(supabase, "customer", customer.recordStatus === "deleted" ? "delete" : existingId ? "update" : "create", customer, customer.defaultLocationId ?? null, customerId, serverReceivedAt, userId);

  const [contactsRes, banksRes, farmsRes] = await Promise.all([
    supabase.from("customer_contacts").select("*").eq("customer_id", customerId),
    supabase.from("customer_bank_accounts").select("*").eq("customer_id", customerId),
    supabase.from("customer_farms").select("*").eq("customer_id", customerId)
  ]);

  return rowToCustomer(result.data, contactsRes.data ?? [], banksRes.data ?? [], farmsRes.data ?? []);
}

// BUG-4 fix: Soft-delete with sync event logging instead of hard delete
export async function deleteCustomer(
  supabase: LanFlowDataClient,
  id: string,
  userId: string
) {
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
  await saveSyncEvent(supabase, "customer", "delete", data, data.default_location_id, id, serverReceivedAt, userId);
}

export async function getCustomersPaginated(
  supabase: LanFlowDataClient,
  page: number = 1,
  pageSize: number = 50
) {

  const start = (page - 1) * pageSize;
  const end = start + pageSize - 1;

  const { data: customers, error, count } = await supabase
    .from("customers")
    .select("*", { count: "exact" })
    .neq("record_status", "deleted")
    .order("created_at", { ascending: false })
    .range(start, end);

  if (error) throw error;

  if (!customers || customers.length === 0) {
    return { data: [], total: count ?? 0, page, pageSize };
  }

  const customerIds = customers.map(c => c.id);
  const [contactsRes, banksRes, farmsRes] = await Promise.all([
    supabase.from("customer_contacts").select("*").in("customer_id", customerIds),
    supabase.from("customer_bank_accounts").select("*").in("customer_id", customerIds),
    supabase.from("customer_farms").select("*").in("customer_id", customerIds)
  ]);

  const contacts = contactsRes.data ?? [];
  const bankAccounts = banksRes.data ?? [];
  const farms = farmsRes.data ?? [];

  const resultData = customers.map((cust) => rowToCustomer(
    cust,
    contacts.filter(item => item.customer_id === cust.id),
    bankAccounts.filter(item => item.customer_id === cust.id),
    farms.filter(item => item.customer_id === cust.id)
  ));

  return {
    data: resultData,
    total: count ?? 0,
    page,
    pageSize
  };
}

// ═══════════════════════════════════════
// OCR Tickets
// ═══════════════════════════════════════

function rowToOcrTicket(row: any): OcrTicket {
  return {
    id: row.id,
    clientTempId: row.client_temp_id ?? row.id,
    idempotencyKey: row.idempotency_key ?? `server:${row.id}`,
    locationId: row.location_id,
    fileName: row.file_name,
    ticketId: row.ticket_id ?? null,
    licensePlate: row.license_plate ?? null,
    dateIn: row.date_in ?? null,
    weightIn: row.weight_in != null ? Number(row.weight_in) : null,
    weightOut: row.weight_out != null ? Number(row.weight_out) : null,
    weightNet: row.weight_net != null ? Number(row.weight_net) : null,
    weightDeducted: row.weight_deducted != null ? Number(row.weight_deducted) : null,
    weightRemaining: row.weight_remaining != null ? Number(row.weight_remaining) : null,
    totalAmount: row.total_amount != null ? Number(row.total_amount) : null,
    driveFileId: row.drive_file_id ?? null,
    driveUrl: row.drive_url ?? null,
    customerName: row.customer_name ?? null,
    moneyDeducted: row.money_deducted != null ? Number(row.money_deducted) : null,
    syncStatus: row.sync_status ?? "synced",
    recordStatus: row.record_status ?? "active",
    revisionNo: row.revision_no ?? 0,
    createdByName: row.created_by_name ?? undefined,
    createdByPhone: row.created_by_phone ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getOcrTickets(
  supabase: LanFlowDataClient,
  locationId: string
): Promise<OcrTicket[]> {
  const { data, error } = await supabase
    .from("ocr_tickets")
    .select("*")
    .eq("location_id", locationId)
    .neq("record_status", "deleted")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToOcrTicket);
}

export async function saveOcrTicket(
  supabase: LanFlowDataClient,
  ticket: OcrTicket,
  userId: string
) {
  const serverReceivedAt = new Date().toISOString();

  const row = {
    client_temp_id: ticket.clientTempId ?? null,
    idempotency_key: ticket.idempotencyKey ?? null,
    location_id: ticket.locationId,
    file_name: ticket.fileName,
    ticket_id: ticket.ticketId,
    license_plate: ticket.licensePlate,
    date_in: ticket.dateIn,
    weight_in: ticket.weightIn,
    weight_out: ticket.weightOut,
    weight_net: ticket.weightNet,
    weight_deducted: ticket.weightDeducted ?? 0,
    weight_remaining: ticket.weightRemaining ?? 0,
    total_amount: ticket.totalAmount ?? 0,
    drive_file_id: ticket.driveFileId ?? null,
    drive_url: ticket.driveUrl ?? null,
    customer_name: ticket.customerName ?? null,
    money_deducted: ticket.moneyDeducted ?? 0,
    sync_status: "synced",
    record_status: ticket.recordStatus ?? "active",
    revision_no: ticket.revisionNo ?? 0,
    server_received_at: serverReceivedAt,
    client_recorded_at: ticket.createdAt ?? serverReceivedAt,
    created_by_user_id: userId,
    created_by_name: ticket.createdByName ?? "ผู้ดูแลระบบ",
    created_by_phone: ticket.createdByPhone ?? "0800000000",
    updated_at: serverReceivedAt
  };

  let existingId: string | null = null;
  if (ticket.clientTempId) {
    const byClientTempId = await supabase
      .from("ocr_tickets")
      .select("id")
      .eq("client_temp_id", ticket.clientTempId)
      .maybeSingle();
    if (byClientTempId.error) throw byClientTempId.error;
    existingId = byClientTempId.data?.id ?? null;
  }

  let result;
  if (existingId) {
    result = await supabase.from("ocr_tickets").update(row).eq("id", existingId).select("*").single();
  } else {
    result = await supabase.from("ocr_tickets").insert({ ...row, id: ticket.id }).select("*").single();
  }
  if (result.error) throw result.error;

  await saveSyncEvent(supabase, "ocr_ticket", existingId ? "update" : "create", ticket, ticket.locationId, result.data.id, serverReceivedAt, userId);
  return rowToOcrTicket(result.data);
}

export async function updateOcrTicket(
  supabase: LanFlowDataClient,
  id: string,
  updates: Partial<OcrTicket>,
  userId: string
) {
  const serverReceivedAt = new Date().toISOString();

  const row: Record<string, unknown> = { updated_at: serverReceivedAt };
  if (updates.ticketId !== undefined) row.ticket_id = updates.ticketId;
  if (updates.licensePlate !== undefined) row.license_plate = updates.licensePlate;
  if (updates.dateIn !== undefined) row.date_in = updates.dateIn;
  if (updates.weightIn !== undefined) row.weight_in = updates.weightIn;
  if (updates.weightOut !== undefined) row.weight_out = updates.weightOut;
  if (updates.weightNet !== undefined) row.weight_net = updates.weightNet;
  if (updates.weightDeducted !== undefined) row.weight_deducted = updates.weightDeducted;
  if (updates.weightRemaining !== undefined) row.weight_remaining = updates.weightRemaining;
  if (updates.totalAmount !== undefined) row.total_amount = updates.totalAmount;
  if (updates.driveFileId !== undefined) row.drive_file_id = updates.driveFileId;
  if (updates.driveUrl !== undefined) row.drive_url = updates.driveUrl;
  if (updates.customerName !== undefined) row.customer_name = updates.customerName;
  if (updates.moneyDeducted !== undefined) row.money_deducted = updates.moneyDeducted;

  const { data, error } = await supabase
    .from("ocr_tickets")
    .update(row)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  await saveSyncEvent(supabase, "ocr_ticket", "update", data, data.location_id, id, serverReceivedAt, userId);
  return rowToOcrTicket(data);
}

export async function deleteOcrTicket(
  supabase: LanFlowDataClient,
  id: string,
  userId: string
) {
  const serverReceivedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("ocr_tickets")
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

  await saveSyncEvent(supabase, "ocr_ticket", "delete", data, data.location_id, id, serverReceivedAt, userId);
  return data.drive_file_id as string | null;
}

// ═══════════════════════════════════════
// Transport Staffs (ขนส่งและพนักงาน)
// ═══════════════════════════════════════

function rowToTransportStaff(
  row: any,
  contacts: any[],
  bankAccounts: any[],
  plates: any[]
): TransportStaff {
  return {
    id: row.id,
    clientTempId: row.client_temp_id ?? row.id,
    legacyRecId: row.legacy_rec_id ?? undefined,
    legacyMemberId: row.legacy_member_id ?? undefined,
    mainName: row.main_name,
    defaultLocationId: row.default_location_id ?? undefined,
    createdByUserId: row.created_by_user_id ?? undefined,
    createdByName: row.created_by_name ?? undefined,
    createdByPhone: row.created_by_phone ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status ?? "synced",
    idempotencyKey: row.idempotency_key ?? undefined,
    revisionNo: row.revision_no ?? 0,
    recordStatus: row.record_status ?? "active",
    contacts: contacts.map((c) => ({ id: c.id, phone: c.phone })),
    bankAccounts: bankAccounts.map((b) => ({
      id: b.id,
      bankName: b.bank_name,
      accountNumber: b.account_number,
      accountName: b.account_name,
      isPrimary: b.is_primary ?? false,
    })),
    plates: plates.map((p) => ({
      id: p.id,
      plateNumber: p.plate_number,
    })),
  };
}

export async function getTransportStaffs(
  supabase: LanFlowDataClient
): Promise<TransportStaff[]> {
  const { data: staffs, error } = await supabase
    .from("transport_staffs")
    .select("*")
    .neq("record_status", "deleted")
    .order("main_name", { ascending: true });

  if (error) throw error;
  if (!staffs || staffs.length === 0) return [];

  const staffIds = staffs.map((s) => s.id);
  const [contactsRes, banksRes, platesRes] = await Promise.all([
    supabase.from("transport_staff_contacts").select("*").in("staff_id", staffIds),
    supabase.from("transport_staff_bank_accounts").select("*").in("staff_id", staffIds),
    supabase.from("transport_staff_plates").select("*").in("staff_id", staffIds),
  ]);

  return staffs.map((s) =>
    rowToTransportStaff(
      s,
      (contactsRes.data ?? []).filter((c) => c.staff_id === s.id),
      (banksRes.data ?? []).filter((b) => b.staff_id === s.id),
      (platesRes.data ?? []).filter((p) => p.staff_id === s.id)
    )
  );
}

export async function getTransportStaffsPaginated(
  supabase: LanFlowDataClient,
  page: number = 1,
  pageSize: number = 50
) {
  const start = (page - 1) * pageSize;
  const end = start + pageSize - 1;

  const { data: staffs, error, count } = await supabase
    .from("transport_staffs")
    .select("*", { count: "exact" })
    .neq("record_status", "deleted")
    .order("created_at", { ascending: false })
    .range(start, end);

  if (error) throw error;

  if (!staffs || staffs.length === 0) {
    return { data: [], total: count ?? 0, page, pageSize };
  }

  const staffIds = staffs.map((s) => s.id);
  const [contactsRes, banksRes, platesRes] = await Promise.all([
    supabase.from("transport_staff_contacts").select("*").in("staff_id", staffIds),
    supabase.from("transport_staff_bank_accounts").select("*").in("staff_id", staffIds),
    supabase.from("transport_staff_plates").select("*").in("staff_id", staffIds),
  ]);

  const contacts = contactsRes.data ?? [];
  const bankAccounts = banksRes.data ?? [];
  const plates = platesRes.data ?? [];

  const resultData = staffs.map((s) =>
    rowToTransportStaff(
      s,
      contacts.filter((c) => c.staff_id === s.id),
      bankAccounts.filter((b) => b.staff_id === s.id),
      plates.filter((p) => p.staff_id === s.id)
    )
  );

  return { data: resultData, total: count ?? 0, page, pageSize };
}

export async function saveTransportStaff(
  supabase: LanFlowDataClient,
  staff: TransportStaff,
  userId: string
) {
  if (!staff.mainName || staff.mainName.trim() === "") {
    throw new Error("Validation Error: mainName is required");
  }

  if (staff.contacts) {
    for (const c of staff.contacts) {
      if (c.phone && c.phone.trim() !== "") {
        const digits = c.phone.replace(/\D/g, "");
        if (digits.length < 9 || digits.length > 10) {
          throw new Error(`Validation Error: invalid phone format (${c.phone}), must be 9-10 digits`);
        }
      }
    }
  }

  const serverReceivedAt = new Date().toISOString();
  const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  const row = {
    client_temp_id: staff.clientTempId ?? null,
    idempotency_key: staff.idempotencyKey ?? null,
    legacy_rec_id: staff.legacyRecId ?? staff.clientTempId ?? null,
    legacy_member_id: staff.legacyMemberId ?? null,
    main_name: staff.mainName,
    default_location_id: staff.defaultLocationId ?? null,
    revision_no: staff.revisionNo ?? 0,
    sync_status: "synced",
    record_status: staff.recordStatus ?? "active",
    server_received_at: serverReceivedAt,
    created_by_user_id: userId,
    created_by_name: staff.createdByName ?? "ผู้ดูแลระบบ",
    created_by_phone: staff.createdByPhone ?? "0800000000",
    updated_by_user_id: userId,
    updated_by_name: staff.createdByName ?? "ผู้ดูแลระบบ",
    updated_by_phone: staff.createdByPhone ?? "0800000000",
    updated_at: serverReceivedAt,
  };

  // Find existing record
  let existingId: string | null = null;

  if (staff.id && isUuid(staff.id)) {
    const byId = await supabase.from("transport_staffs").select("id").eq("id", staff.id).maybeSingle();
    if (byId.error) throw byId.error;
    existingId = byId.data?.id ?? null;
  }

  if (!existingId && staff.clientTempId) {
    const byClientTempId = await supabase.from("transport_staffs").select("id").eq("client_temp_id", staff.clientTempId).maybeSingle();
    if (byClientTempId.error) throw byClientTempId.error;
    existingId = byClientTempId.data?.id ?? null;
  }

  let result;
  if (existingId) {
    result = await supabase.from("transport_staffs").update(row).eq("id", existingId).select("*").single();
  } else {
    const insertRow: any = { ...row };
    if (staff.id && isUuid(staff.id)) insertRow.id = staff.id;
    result = await supabase.from("transport_staffs").insert(insertRow).select("*").single();
  }

  if (result.error) throw result.error;
  const staffId = result.data.id;

  // Upsert contacts
  const validContactIds = (staff.contacts || []).map((c) => c.id).filter((id) => id && isUuid(id));
  if (validContactIds.length > 0) {
    await supabase.from("transport_staff_contacts").delete().eq("staff_id", staffId).not("id", "in", `(${validContactIds.join(",")})`);
  } else {
    await supabase.from("transport_staff_contacts").delete().eq("staff_id", staffId);
  }
  if (staff.contacts && staff.contacts.length > 0) {
    const contactRows = staff.contacts.map((c) => {
      const r: any = { staff_id: staffId, phone: c.phone };
      if (c.id && isUuid(c.id)) r.id = c.id;
      return r;
    });
    const { error: upsertErr } = await supabase.from("transport_staff_contacts").upsert(contactRows, { onConflict: "id" });
    if (upsertErr) throw upsertErr;
  }

  // Upsert bank accounts
  const validBankIds = (staff.bankAccounts || []).map((b) => b.id).filter((id) => id && isUuid(id));
  if (validBankIds.length > 0) {
    await supabase.from("transport_staff_bank_accounts").delete().eq("staff_id", staffId).not("id", "in", `(${validBankIds.join(",")})`);
  } else {
    await supabase.from("transport_staff_bank_accounts").delete().eq("staff_id", staffId);
  }
  if (staff.bankAccounts && staff.bankAccounts.length > 0) {
    const bankRows = staff.bankAccounts.map((b) => {
      const r: any = {
        staff_id: staffId,
        bank_name: b.bankName,
        account_number: b.accountNumber,
        account_name: b.accountName,
        is_primary: b.isPrimary ?? false,
      };
      if (b.id && isUuid(b.id)) r.id = b.id;
      return r;
    });
    const { error: upsertErr } = await supabase.from("transport_staff_bank_accounts").upsert(bankRows, { onConflict: "id" });
    if (upsertErr) throw upsertErr;
  }

  // Upsert plates (ทะเบียนรถ)
  const validPlateIds = (staff.plates || []).map((p) => p.id).filter((id) => id && isUuid(id));
  if (validPlateIds.length > 0) {
    await supabase.from("transport_staff_plates").delete().eq("staff_id", staffId).not("id", "in", `(${validPlateIds.join(",")})`);
  } else {
    await supabase.from("transport_staff_plates").delete().eq("staff_id", staffId);
  }
  if (staff.plates && staff.plates.length > 0) {
    const plateRows = staff.plates.map((p) => {
      const r: any = { staff_id: staffId, plate_number: p.plateNumber };
      if (p.id && isUuid(p.id)) r.id = p.id;
      return r;
    });
    const { error: upsertErr } = await supabase.from("transport_staff_plates").upsert(plateRows, { onConflict: "id" });
    if (upsertErr) throw upsertErr;
  }

  await saveSyncEvent(supabase, "transport_staff", existingId ? "update" : "create", staff, staff.defaultLocationId ?? null, staffId, serverReceivedAt, userId);

  const [contactsRes, banksRes, platesRes] = await Promise.all([
    supabase.from("transport_staff_contacts").select("*").eq("staff_id", staffId),
    supabase.from("transport_staff_bank_accounts").select("*").eq("staff_id", staffId),
    supabase.from("transport_staff_plates").select("*").eq("staff_id", staffId),
  ]);

  return rowToTransportStaff(result.data, contactsRes.data ?? [], banksRes.data ?? [], platesRes.data ?? []);
}

export async function deleteTransportStaff(
  supabase: LanFlowDataClient,
  id: string,
  userId: string
) {
  const serverReceivedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("transport_staffs")
    .update({
      record_status: "deleted",
      sync_status: "synced",
      updated_at: serverReceivedAt,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  await saveSyncEvent(supabase, "transport_staff", "delete", data, data.default_location_id, id, serverReceivedAt, userId);
}

// ═══════════════════════════════════════
// Money Transfers (ระบบโอนเงิน)
// ═══════════════════════════════════════

function rowToMoneyTransferSlip(row: any): MoneyTransferSlip {
  return {
    id: row.id,
    amount: Number(row.amount ?? 0),
    referenceNumber: row.reference_number ?? null,
    fee: Number(row.fee ?? 0),
    senderName: row.sender_name ?? null,
    receiverName: row.receiver_name ?? null,
    transactionDate: row.transaction_date ?? null,
    slipImageUrl: row.slip_image_url ?? null,
    sortOrder: row.sort_order ?? 0,
  };
}

function rowToMoneyTransferItem(row: any): MoneyTransferItem {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    customerName: row.customer_name ?? null,
    amount: Number(row.amount ?? 0),
  };
}

function rowToMoneyTransfer(row: any, slips: any[], items: any[]): MoneyTransfer {
  return {
    id: row.id,
    clientTempId: row.client_temp_id ?? row.id,
    idempotencyKey: row.idempotency_key ?? `server:${row.id}`,
    locationId: row.location_id,
    customerId: row.customer_id ?? null,
    customerName: row.customer_name ?? null,
    accountNumber: row.account_number ?? null,
    accountName: row.account_name ?? null,
    bankName: row.bank_name ?? null,
    netAmountToPay: Number(row.net_amount_to_pay ?? 0),
    transferStatus: row.transfer_status ?? "pending",
    syncStatus: row.sync_status ?? "synced",
    recordStatus: row.record_status ?? "active",
    revisionNo: row.revision_no ?? 0,
    createdByUserId: row.created_by_user_id ?? undefined,
    createdByName: row.created_by_name ?? undefined,
    createdByPhone: row.created_by_phone ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    slips: slips.map(rowToMoneyTransferSlip),
    items: items.map(rowToMoneyTransferItem),
  };
}

export async function getMoneyTransfers(
  supabase: LanFlowDataClient,
  locationId: string
): Promise<MoneyTransfer[]> {
  const { data: transfers, error } = await supabase
    .from("money_transfers")
    .select("*")
    .eq("location_id", locationId)
    .neq("record_status", "deleted")
    .order("created_at", { ascending: false });

  if (error) throw error;
  if (!transfers || transfers.length === 0) return [];

  const transferIds = transfers.map((t) => t.id);
  const [slipsRes, itemsRes] = await Promise.all([
    supabase.from("money_transfer_slips").select("*").in("transfer_id", transferIds).order("sort_order", { ascending: true }),
    supabase.from("money_transfer_items").select("*").in("transfer_id", transferIds).order("created_at", { ascending: true }),
  ]);

  const slips = slipsRes.data ?? [];
  const items = itemsRes.data ?? [];

  return transfers.map((t) =>
    rowToMoneyTransfer(
      t,
      slips.filter((s) => s.transfer_id === t.id),
      items.filter((i) => i.transfer_id === t.id)
    )
  );
}

export async function getUsedSourceIds(
  supabase: LanFlowDataClient
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("money_transfer_items")
    .select("source_id");
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.source_id));
}

export async function saveMoneyTransfer(
  supabase: LanFlowDataClient,
  transfer: MoneyTransfer,
  userId: string
): Promise<MoneyTransfer> {
  const serverReceivedAt = new Date().toISOString();

  const row = {
    client_temp_id: transfer.clientTempId ?? null,
    idempotency_key: transfer.idempotencyKey ?? null,
    location_id: transfer.locationId,
    customer_id: transfer.customerId ?? null,
    customer_name: transfer.customerName ?? null,
    account_number: transfer.accountNumber ?? null,
    account_name: transfer.accountName ?? null,
    bank_name: transfer.bankName ?? null,
    net_amount_to_pay: transfer.netAmountToPay,
    transfer_status: transfer.transferStatus ?? "pending",
    sync_status: "synced",
    record_status: transfer.recordStatus ?? "active",
    revision_no: transfer.revisionNo ?? 0,
    server_received_at: serverReceivedAt,
    created_by_user_id: userId,
    created_by_name: transfer.createdByName ?? "ผู้ดูแลระบบ",
    created_by_phone: transfer.createdByPhone ?? "0800000000",
    updated_at: serverReceivedAt,
  };

  const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  let existingId: string | null = null;

  if (transfer.id && isUuid(transfer.id)) {
    const byId = await supabase.from("money_transfers").select("id").eq("id", transfer.id).maybeSingle();
    if (byId.error) throw byId.error;
    existingId = byId.data?.id ?? null;
  }

  if (!existingId && transfer.clientTempId) {
    const byClientTempId = await supabase.from("money_transfers").select("id").eq("client_temp_id", transfer.clientTempId).maybeSingle();
    if (byClientTempId.error) throw byClientTempId.error;
    existingId = byClientTempId.data?.id ?? null;
  }

  let result;
  if (existingId) {
    result = await supabase.from("money_transfers").update(row).eq("id", existingId).select("*").single();
  } else {
    const insertRow: any = { ...row };
    if (transfer.id && isUuid(transfer.id)) insertRow.id = transfer.id;
    result = await supabase.from("money_transfers").insert(insertRow).select("*").single();
  }

  if (result.error) throw result.error;
  const transferId = result.data.id;

  // Replace slips
  await supabase.from("money_transfer_slips").delete().eq("transfer_id", transferId);
  if (transfer.slips && transfer.slips.length > 0) {
    const slipRows = transfer.slips.map((s, idx) => ({
      transfer_id: transferId,
      amount: s.amount,
      reference_number: s.referenceNumber,
      fee: s.fee,
      sender_name: s.senderName,
      receiver_name: s.receiverName,
      transaction_date: s.transactionDate,
      slip_image_url: s.slipImageUrl,
      sort_order: idx,
    }));
    const { error: slipErr } = await supabase.from("money_transfer_slips").insert(slipRows);
    if (slipErr) throw slipErr;
  }

  // Replace items
  await supabase.from("money_transfer_items").delete().eq("transfer_id", transferId);
  if (transfer.items && transfer.items.length > 0) {
    const itemRows = transfer.items.map((i) => ({
      transfer_id: transferId,
      source_type: i.sourceType,
      source_id: i.sourceId,
      customer_name: i.customerName,
      amount: i.amount,
    }));
    const { error: itemErr } = await supabase.from("money_transfer_items").insert(itemRows);
    if (itemErr) throw itemErr;
  }

  await saveSyncEvent(supabase, "money_transfer", existingId ? "update" : "create", transfer, transfer.locationId, transferId, serverReceivedAt, userId);

  // Re-fetch for response
  const [slipsRes, itemsRes] = await Promise.all([
    supabase.from("money_transfer_slips").select("*").eq("transfer_id", transferId).order("sort_order", { ascending: true }),
    supabase.from("money_transfer_items").select("*").eq("transfer_id", transferId).order("created_at", { ascending: true }),
  ]);

  return rowToMoneyTransfer(result.data, slipsRes.data ?? [], itemsRes.data ?? []);
}

export async function deleteMoneyTransfer(
  supabase: LanFlowDataClient,
  id: string,
  userId: string
) {
  const serverReceivedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("money_transfers")
    .update({
      record_status: "deleted",
      sync_status: "synced",
      deleted_at: serverReceivedAt,
      deleted_by_name: "ผู้ดูแลระบบ",
      deleted_by_phone: "0800000000",
      updated_at: serverReceivedAt,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  // Also delete child rows so source IDs become available again
  await supabase.from("money_transfer_slips").delete().eq("transfer_id", id);
  await supabase.from("money_transfer_items").delete().eq("transfer_id", id);

  await saveSyncEvent(supabase, "money_transfer", "delete", data, data.location_id, id, serverReceivedAt, userId);
}

