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
  isActive: boolean;
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
  createdByUserId: string;
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
  syncErrorMessage?: string;
};

export type IncomeBillOption = "รายรับ" | "บิลขาย";
export type ExpenseBillOption = "ค่าใช้จ่าย";

export type IncomeSaleItem = {
  id: string;
  name: string;
  isActive: boolean;
  createdByName?: string | null;
  createdByPhone?: string | null;
  createdAt: string;
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
  billOption: IncomeBillOption | ExpenseBillOption;
  unit?: string;
  price?: number;
  createdByUserId: string;
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
  syncErrorMessage?: string;
};

export type QueueItem = {
  clientTempId: string;
  idempotencyKey: string;
  entityType: "rubber_bill" | "income_expense" | "customer" | "ocr_ticket" | "transport_staff" | "money_transfer";
  operationType: QueueOperation;
  payload: RubberBill | IncomeExpense | Customer | OcrTicket | TransportStaff | MoneyTransfer;
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

export type OcrTicket = {
  id: string;
  clientTempId?: string;
  idempotencyKey?: string;
  locationId: string;
  fileName: string;
  ticketId: string | null;
  licensePlate: string | null;
  dateIn: string | null;
  weightIn: number | null;
  weightOut: number | null;
  weightNet: number | null;
  weightDeducted: number | null;
  weightRemaining: number | null;
  totalAmount: number | null;
  driveFileId?: string | null;
  driveUrl?: string | null;
  customerName?: string | null;
  moneyDeducted?: number | null;
  syncStatus?: SyncStatus;
  recordStatus?: RecordStatus;
  revisionNo?: number;
  createdByName?: string;
  createdByPhone?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type TransportStaffPlate = {
  id: string;
  plateNumber: string;
};

export type MoneyTransferSlip = {
  id: string;
  amount: number;
  referenceNumber: string | null;
  fee: number;
  senderName: string | null;
  receiverName: string | null;
  transactionDate: string | null;
  slipImageUrl: string | null;
  sortOrder: number;
};

export type MoneyTransferItem = {
  id: string;
  sourceType: 'rubber_bill' | 'ocr_ticket';
  sourceId: string;
  customerName: string | null;
  amount: number;
};

export type MoneyTransfer = {
  id: string;
  clientTempId?: string;
  idempotencyKey?: string;
  locationId: string;
  customerId: string | null;
  customerName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  bankName: string | null;
  netAmountToPay: number;
  transferType: 'customer' | 'transport' | 'branch';
  transportCost?: number;
  transportStaffId?: string | null;
  transportStaffName?: string | null;
  targetLocationId?: string | null;
  targetLocationName?: string | null;
  transferStatus: 'pending' | 'paid' | 'partial' | 'overpaid' | 'branch_and_transfer' | 'advance_payment' | 'cancelled';
  branchPaidAmount?: number;
  syncStatus?: SyncStatus;
  recordStatus?: RecordStatus;
  revisionNo?: number;
  createdByUserId?: string;
  createdByName?: string;
  createdByPhone?: string;
  createdAt?: string;
  updatedAt?: string;
  slips?: MoneyTransferSlip[];
  items?: MoneyTransferItem[];
};

export type TransportStaff = {
  id: string;
  clientTempId?: string;
  legacyRecId?: string;
  legacyMemberId?: string;
  mainName: string;
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
  plates?: TransportStaffPlate[];
};
