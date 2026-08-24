export type ReportSummary = {
  id: string;
  reportNo: string;
  locationId: string;
  locationName: string;
  cutoffAt: string;
  status: "active";
  createdByName: string;
  createdAt: string;
  deletedAt: string | null;
  itemCount: number;
  isLatestActive: boolean;
  rubberExportLockNo?: string | null;
  hasCashCount?: boolean;
  cashCountId?: string | null;
  cashCountCheckerName?: string | null;
  cashCountSubmittedAt?: string | null;
};

export type ReportLedgerRow = {
  date: string;
  number: string;
  type: "income" | "expense";
  title: string;
  amount: number;
};

export type ReportDetails = {
  report: ReportSummary;
  rubberBills: Array<{
    date: string;
    number: string;
    customer: string;
    customerGroup: "trader" | "farmer" | "branch_receipt";
    billType: string;
    netWeight: number;
    averagePrice: number;
    rubberValue: number;
    deduction: number;
    net: number;
  }>;
  incomeExpense: ReportLedgerRow[];
  stock: Array<{
    date: string;
    number: string;
    product: string;
    type: string;
    quantity: number;
    amount: number;
  }>;
  stockBalances: Array<{
    product: string;
    quantity: number;
  }>;
  timePayroll: Array<{
    date: string;
    number: string;
    category: string;
    employee: string;
    detail: string;
    quantity: number | null;
    amount: number | null;
  }>;
  bankTransfers: Array<{
    date: string;
    number: string;
    direction: "out" | "in";
    party: string;
    status: string;
    amount: number;
    slipAmount: number;
    fee: number;
    branchPaid: number;
  }>;
};
