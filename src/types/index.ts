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
  primaryLocationId?: string | null;
  canAccessSystemManager?: boolean;
  canAccessMoneyTransfer?: boolean;
  canManageTimePayroll?: boolean;
};

export type AdminUserProfileUpdateRequest = {
  name: string;
  locationIds: string[];
  primaryLocationId: string | null;
};

export type AdminUserProfileUpdateResponse = {
  user: Profile;
  auditId: string;
};

export type AdminPasswordAuditStatus = "pending" | "succeeded" | "failed" | "unknown";

export type AdminPasswordResetRequest = {
  newPassword: string;
  confirmPassword: string;
  requestId: string;
};

export type AdminPasswordResetResponse = {
  success: true;
  auditStatus: Extract<AdminPasswordAuditStatus, "pending" | "succeeded">;
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
  billType: string;
  deductWeight: number;
  weight: number;
  netWeight: number;
  weighValueTotal: number;
  rubberValue: number;
  price: number;
  deductionTotal: number;
  payableBeforeRounding: number;
  netTotal: number;
  acidPackCount: number;
  configuredPriceSnapshot?: number | null;
  approvalState: "not_required" | "approved";
  approvalApprovedByName?: string | null;
  approvalRevisionNo?: number | null;
  weighItems?: Array<{
    id: string;
    label: string;
    inWeight: number;
    outWeight: number;
    netWeight: number;
    price: number;
    total?: number;
  }>;
  acidItems?: Array<{
    id: string;
    name: string;
    stockProductId: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    total?: number;
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
  transferLockId?: string | null;
  operationalSortAt?: string;
  sourceRubberExportId?: string | null;
  sourceExportNo?: string | null;
  receivedAt?: string | null;
  receivedAgeHours?: number | null;
  receivedAgeIsEstimated?: boolean | null;
  approvalPending?: boolean;
  approvalRequestId?: string;
  approvalOperation?: RubberBillApprovalOperation;
  approvalReasons?: RubberBillApprovalReason[];
  inputMethod?: "manual" | "ocr";
  /** Opaque pending-create field; never render or persist outside the sync event. */
  ocrUploadId?: string;
  hasOcrSourceImage?: boolean;
};

export type BranchRubberReceiptCandidate = {
  sourceRubberExportId: string;
  sourceExportNo: string;
  sourceLocationId: string;
  sourceLocationName: string;
  verifiedAt: string;
  currentWeight: number;
  rubberValue: number;
  sourceAverageAgeHours: number;
  receivedAgeHours: number;
  ageIsEstimated: boolean;
  isSameLocation: boolean;
};

export type BranchRubberReceiptResult = {
  status: "received";
  billId: string;
  billNo: string;
  sourceExportId: string;
  sourceExportNo: string;
  receivedAt: string;
  receivedAgeHours: number;
};

export type RubberBillApprovalOperation = "create" | "update" | "delete";
export type RubberBillApprovalReason = "price" | "time" | "non_current_date";
export type RubberBillApprovalStatus = "pending" | "approved";

export type RubberBillApprovalSettings = {
  editWindowMinutes: number;
  configuredPrice: number | null;
  nonCurrentDateRequiresApproval: boolean;
  updatedByName?: string | null;
  updatedByPhone?: string | null;
  updatedAt?: string;
};

export type EffectiveRubberApprovalSettings = {
  locationId: string;
  groupId: string | null;
  priceTimeExempt: boolean;
  editWindowMinutes: number | null;
  configuredPrice: number | null;
  nonCurrentDateRequiresApproval: boolean;
  updatedByName?: string | null;
  updatedByPhone?: string | null;
  updatedAt?: string | null;
};

export type RubberApprovalGroup = {
  id: string;
  locationIds: string[];
  editWindowMinutes: number;
  configuredPrice: number | null;
  updatedAt: string;
};

export type RubberBillApprovalRequest = {
  id: string;
  operation: RubberBillApprovalOperation;
  requestStatus: RubberBillApprovalStatus;
  billId: string | null;
  locationId: string;
  clientTempId: string;
  baseRevisionNo: number;
  matchedReasons: RubberBillApprovalReason[];
  configuredPriceSnapshot: number | null;
  editWindowMinutesSnapshot: number | null;
  approvalGroupIdSnapshot: string | null;
  originalPayload: Record<string, unknown> | null;
  proposedPayload: Record<string, unknown>;
  requestedByName: string;
  requestedByPhone: string;
  requestedAt: string;
  approvedByName?: string | null;
  approvedByPhone?: string | null;
  approvedAt?: string | null;
  createdBillId?: string | null;
};

export type RubberBillApprovalMarker = {
  requestId: string;
  billId: string | null;
  clientTempId: string;
  operation: RubberBillApprovalOperation;
  matchedReasons: RubberBillApprovalReason[];
  requestedAt: string;
  proposedCreatePayload: Record<string, any> | null;
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
export type IncomeExpenseApprovalReason = "keyword" | "amount_threshold" | "non_current_date";

export type IncomeExpenseApprovalSettings = {
  appliesTo: IncomeExpenseApprovalAppliesTo;
  approvalMinAmount?: number | null;
  cashTransferDeleteRequiresApproval: boolean;
  nonCurrentDateRequiresApproval: boolean;
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
  matchedReasons: IncomeExpenseApprovalReason[];
  locationId: string;
  txType: "income" | "expense";
  title: string;
  cost: number;
  saleLines?: IncomeExpenseSaleLine[];
  requestedByName: string;
  requestedByPhone: string;
  decidedByName?: string | null;
  decidedByPhone?: string | null;
  decidedAt?: string | null;
  decisionComment?: string | null;
  createdAt: string;
};

export type IncomeExpenseApprovalMarker = {
  requestId: string;
  sourceIncomeExpenseId?: string | null;
  clientTempId: string;
  operation: QueueOperation;
  matchedReasons: IncomeExpenseApprovalReason[];
  requestedPayload: Record<string, any>;
  locationId: string;
  txType: "income" | "expense";
  title: string;
  cost: number;
  createdAt: string;
};

export type IncomeExpenseSaleLine = {
  id?: string;
  incomeSaleItemId: string;
  stockProductId: string;
  title: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  sequenceNo: number;
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
  saleLineCount?: number;
  saleLines?: IncomeExpenseSaleLine[];
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
  relationSourceType?: "money_transfer" | "rubber_bill_daily" | "rubber_export" | "time_tracking_withdrawal" | "payroll_slip";
  relationSourceId?: string;
  relationSourceLocationId?: string;
  relationSourceDate?: string;
  relationLockReason?: string;
  relationLabel?: string;
  reportLockNo?: string | null;
  approvalPending?: boolean;
  approvalRequestId?: string;
  approvalRequestType?: "income_expense" | "cash_transfer_delete";
  approvalOperation?: QueueOperation;
  approvalReasons?: IncomeExpenseApprovalReason[];
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
  entityType: "rubber_bill" | "income_expense" | "customer" | "transport_staff" | "money_transfer";
  operationType: QueueOperation;
  payload: RubberBill | IncomeExpense | Customer | TransportStaff | MoneyTransfer;
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

export type TransportStaffPlate = {
  id: string;
  plateNumber: string;
};

export type MoneyTransferSlip = {
  id: string;
  inputMethod: 'manual' | 'ocr' | null;
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
  sourceType: 'rubber_bill';
  sourceId: string;
  customerName: string | null;
  amount: number;
  netWeightAfterDeduction?: number | null;
  deductedAmount?: number | null;
  netPayableAmount?: number | null;
  sourceNumber?: string | null;
  sourceDate?: string | null;
  averagePrice?: number | null;
  rubberValue?: number | null;
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
  accountingDate?: string | null;
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
  paidAmount?: number;
  sourceCount?: number;
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

export type CashBranchTransferStatus = "pending_receipt" | "received";

export type CashBranchTransferSummary = {
  id: string;
  locationId: string;
  sourceLocationName: string | null;
  targetLocationId: string;
  targetLocationName: string | null;
  createdByUserId?: string | null;
  createdByName: string;
  createdByPhone: string;
  sentTotal: number;
  status: "pending_receipt";
  note: string | null;
  sentAt: string;
  reportLockNo?: string | null;
};

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
  reportLockNo?: string | null;
};

export type CashTransferDeleteRequest = {
  id: string;
  transferId: string | null;
  sourceLocationId: string;
  sourceLocationName: string;
  targetLocationId: string;
  targetLocationName: string;
  transferDisplayNo: string;
  sentTotal: number;
  receivedTotal: number;
  differenceTotal: number;
  note: string | null;
  requestStatus: "pending" | "approved" | "rejected";
  requestedByName: string;
  requestedByPhone: string;
  decidedByName: string | null;
  decidedByPhone: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  createdAt: string;
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
