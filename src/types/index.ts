export type AppRole = "user" | "admin" | "super_admin";
export type SyncStatus = "pending" | "syncing" | "synced" | "failed" | "conflict";
export type RecordStatus = "active" | "deleted" | "cancelled";
export type QueueOperation = "create" | "update" | "delete";
export type PaymentResponsibility = "สาขานี้จ่าย" | "สาขาใหญ่จ่าย";
export type PrintStatus = "ยังไม่ได้ปริ้น" | "ปริ้นแล้ว";

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
  canAccessSystemManager?: boolean;
  canAccessMoneyTransfer?: boolean;
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
  customerId?: string | null;
  customerName: string;
  customerType: PaymentResponsibility;
  billType: string;
  deductWeight: number;
  weight: number;
  price: number;
  deductionTotal: number;
  netTotal: number;
  cashPayment: number;
  transferPayment: number;
  acidPackCount: number;
  printStatus: PrintStatus;
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
    stockProductId: string;
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
  reportLockNo?: string | null;
};

export type IncomeBillOption = "รายรับ" | "บิลขาย";
export type ExpenseBillOption = "ค่าใช้จ่าย";

export type IncomeSaleItem = {
  id: string;
  name: string;
  stockProductId?: string | null;
  isActive: boolean;
  createdByName?: string | null;
  createdByPhone?: string | null;
  createdAt: string;
};

export type AcidProduct = {
  id: string;
  name: string;
  unit: string;
  isActive: boolean;
  createdByName?: string | null;
  createdByPhone?: string | null;
  createdAt: string;
};

export type StockProductApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";
export type StockProductApprovalRequestType = "create_product" | "delete_product";

export type StockProductApprovalRequest = {
  id: string;
  requestStatus: StockProductApprovalStatus;
  requestType: StockProductApprovalRequestType;
  productId?: string | null;
  productName: string;
  unit?: string | null;
  createSaleItem?: boolean | null;
  requestedByName: string;
  requestedByPhone: string;
  decidedByName?: string | null;
  decidedByPhone?: string | null;
  decidedAt?: string | null;
  decisionComment?: string | null;
  createdAt: string;
};

export type StockEntryApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export type StockEntryApprovalRequest = {
  id: string;
  requestStatus: StockEntryApprovalStatus;
  requestType: "delete_stock_entry";
  stockEntryId: string;
  transferBillNo?: string | null;
  txType: "receive" | "transfer_out";
  productId: string;
  productName: string;
  quantity: number;
  locationId: string;
  locationName: string;
  targetLocationId?: string | null;
  targetLocationName?: string | null;
  requestedByName: string;
  requestedByPhone: string;
  decidedByName?: string | null;
  decidedByPhone?: string | null;
  decidedAt?: string | null;
  decisionComment?: string | null;
  createdAt: string;
};

export type IncomeExpenseApprovalAppliesTo = "income" | "expense" | "both";
export type IncomeExpenseApprovalMatchMode = "contains" | "exact";
export type IncomeExpenseApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";
export type IncomeExpenseApprovalReason = "keyword" | "amount_threshold" | "keyword_and_amount";

export type IncomeExpenseApprovalSettings = {
  appliesTo: IncomeExpenseApprovalAppliesTo;
  approvalMinAmount?: number | null;
  updatedByName?: string | null;
  updatedByPhone?: string | null;
};

export type IncomeExpenseApprovalKeyword = {
  id: string;
  keyword: string;
  matchMode: IncomeExpenseApprovalMatchMode;
  appliesTo: IncomeExpenseApprovalAppliesTo;
  isActive: boolean;
  approvalMinAmount?: number | null;
  createdByName?: string | null;
  createdByPhone?: string | null;
  createdAt: string;
};

export type IncomeExpenseApprovalRequest = {
  id: string;
  requestStatus: IncomeExpenseApprovalStatus;
  requestedOperation: QueueOperation;
  matchedKeyword?: string | null;
  matchedReason: IncomeExpenseApprovalReason;
  locationId: string;
  txType: "income" | "expense";
  title: string;
  cost: number;
  requestedByName: string;
  requestedByPhone: string;
  decidedByName?: string | null;
  decidedByPhone?: string | null;
  decidedAt?: string | null;
  decisionComment?: string | null;
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
  incomeSaleItemId?: string | null;
  stockProductId?: string | null;
  stockQuantity?: number | null;
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
  relationSourceType?: "money_transfer" | "rubber_bill_daily" | "rubber_export" | "ocr_ticket_daily" | "time_tracking_withdrawal" | "payroll_slip";
  relationSourceId?: string;
  relationSourceLocationId?: string;
  relationSourceDate?: string;
  relationLockReason?: string;
  relationLabel?: string;
  reportLockNo?: string | null;
};

export type AcidStockSourceType = "stock_entry" | "income_sale" | "rubber_bill_acid" | "rubber_bill_stock_deduction";

export type AcidStockMovement = {
  movementId: string;
  sourceType: AcidStockSourceType;
  sourceId: string;
  sourceLineId?: string | null;
  txDate: string;
  locationId: string;
  productId: string;
  productName: string;
  quantityDelta: number;
  amount: number;
  displayBillNo: string;
  txType: string;
  createdByUserId?: string | null;
  createdByName?: string | null;
  createdByPhone?: string | null;
  createdAt: string;
  relationLockReason?: string | null;
  reportLockNo?: string | null;
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
  reportLockNo?: string | null;
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
  reportLockNo?: string | null;
};

export type CashDenominationCounts = {
  coin1: number;
  coin2: number;
  coin5: number;
  coin10: number;
  banknote20: number;
  banknote50: number;
  banknote100: number;
  banknote500: number;
  banknote1000: number;
};

export type CashBranchTransferStatus = "pending_receipt" | "received" | "mismatched" | "difference_accepted";

export type CashBranchTransfer = {
  id: string;
  locationId: string;
  targetLocationId: string;
  targetLocationName: string | null;
  createdByName: string;
  createdByPhone: string;
  createdByUserId?: string | null;
  sent: CashDenominationCounts;
  received: CashDenominationCounts | null;
  sentTotal: number;
  receivedTotal: number | null;
  differenceTotal: number | null;
  status: CashBranchTransferStatus;
  note: string | null;
  sentAt: string;
  receivedAt: string | null;
  receivedByName: string | null;
  receivedByPhone: string | null;
  differenceAcceptReason: string | null;
  reportLockNo?: string | null;
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
