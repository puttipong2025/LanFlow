export type AppRole = "user" | "admin" | "super_admin";
export type SyncStatus = "pending" | "syncing" | "synced" | "failed" | "conflict";
export type RecordStatus = "active" | "deleted" | "cancelled";
export type QueueOperation = "create" | "update" | "delete";
export type PaymentResponsibility = "สาขานี้จ่าย" | "สาขาใหญ่จ่าย";

export type Location = {
  id: string;
  name: string;
  code: string;
  active: boolean;
};

export type Profile = {
  id: string;
  name: string;
  phone: string;
  role: AppRole;
  locationIds: string[];
};

export type RubberBill = {
  id: string;
  clientTempId: string;
  localBillNo: string;
  serverBillNo?: string;
  syncStatus: SyncStatus;
  idempotencyKey: string;
  locationId: string;
  billNo: string;
  billDate: string;
  customerName: string;
  customerType: PaymentResponsibility;
  billType: string;
  weight: number;
  price: number;
  deductionTotal: number;
  netTotal: number;
  cashPayment: number;
  transferPayment: number;
  acidPackCount: number;
  weighItems?: Array<{
    id: string;
    label: string;
    inWeight: number;
    outWeight: number;
    netWeight: number;
    price: number;
  }>;
  acidItems?: Array<{
    id: string;
    name: string;
    quantity: number;
    unit: string;
    unitPrice: number;
  }>;
  debtItem?: {
    id: string;
    title: string;
    amount: number;
  };
  debtItems?: Array<{
    id: string;
    title: string;
    amount: number;
  }>;
  createdByName: string;
  createdByPhone: string;
  clientCreatedAt: string;
  serverCreatedAt?: string;
  clientRecordedAt: string;
  serverReceivedAt?: string;
  revisionNo: number;
  recordStatus: RecordStatus;
  deletedAt?: string;
  deletedByName?: string;
  deletedByPhone?: string;
};

export type IncomeExpense = {
  id: string;
  clientTempId: string;
  localBillNo: string;
  serverBillNo?: string;
  syncStatus: SyncStatus;
  idempotencyKey: string;
  locationId: string;
  type: "income" | "expense";
  number: string;
  txDate: string;
  title: string;
  cost: number;
  billOption: string;
  transactionOption: string;
  unit?: string;
  price?: number;
  createdByName: string;
  createdByPhone: string;
  clientCreatedAt: string;
  serverCreatedAt?: string;
  clientRecordedAt: string;
  serverReceivedAt?: string;
  revisionNo: number;
  recordStatus: RecordStatus;
  deletedAt?: string;
  deletedByName?: string;
  deletedByPhone?: string;
};

export type QueueItem = {
  clientTempId: string;
  idempotencyKey: string;
  entityType: "rubber_bill" | "income_expense" | "customer";
  operationType: QueueOperation;
  payload: RubberBill | IncomeExpense | Customer;
  status: SyncStatus;
  createdAt: string;
  serverReceivedAt?: string;
  errorMessage?: string;
};

export type CustomerContact = {
  id: string;
  phone: string;
};

export type CustomerBankAccount = {
  id: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  isPrimary: boolean;
};

export type CustomerFarm = {
  id: string;
  ownerName: string;
  address: string;
  cardNumber: string;
};

export type Customer = {
  id: string;
  clientTempId?: string;
  legacyRecId?: string;
  legacyMemberId?: string;
  class: PaymentResponsibility;
  mainName: string;
  fscStatus?: string;
  startingPointsDate?: string;
  defaultLocationId?: string;
  createdByUserId?: string;
  createdByName?: string;
  createdByPhone?: string;
  createdAt?: string;
  updatedAt?: string;
  syncStatus?: SyncStatus;
  idempotencyKey?: string;
  revisionNo?: number;
  recordStatus?: RecordStatus;
  contacts?: CustomerContact[];
  bankAccounts?: CustomerBankAccount[];
  farms?: CustomerFarm[];
};
