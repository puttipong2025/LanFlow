export type ReportSummary = {
  id: string;
  reportNo: string;
  locationId: string;
  locationName: string;
  cutoffAt: string;
  status: "active" | "deleted";
  createdByName: string;
  createdAt: string;
  deletedAt: string | null;
  itemCount: number;
  isLatestActive: boolean;
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
    billType: string;
    weight: number;
    deduction: number;
    net: number;
    cash: number;
    transfer: number;
  }>;
  ocrTickets: Array<{
    date: string;
    number: string;
    customer: string;
    licensePlate: string;
    weightIn: number;
    weightOut: number;
    weightNet: number;
    weightDeducted: number;
    weightRemaining: number;
    amount: number;
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
