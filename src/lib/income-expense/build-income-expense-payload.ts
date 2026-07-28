import type {
  ExpenseBillOption,
  IncomeBillOption,
  IncomeExpense,
  IncomeExpenseSaleLine,
  QueueOperation,
} from "@/types";

export type IncomeExpenseSaleLinePayload = Pick<
  IncomeExpenseSaleLine,
  "incomeSaleItemId" | "quantity" | "unitPrice" | "sequenceNo"
>;

export type IncomeExpenseSyncPayload = {
  operation: QueueOperation;
  expectedRevisionNo: number;
  clientTempId: string;
  idempotencyKey: string;
  locationId: string;
  recordStatus: "active" | "deleted";
  localBillNo: string;
  txDate: string;
  type: "income" | "expense";
  title: string;
  cost: number;
  billOption: IncomeBillOption | ExpenseBillOption;
  unit?: string | null;
  price?: number | null;
  saleLines?: IncomeExpenseSaleLinePayload[];
  clientRecordedAt: string;
  clientCreatedAt: string;
  createdByUserId?: string;
  createdByName?: string;
  createdByPhone?: string;
  deletedByName?: string;
  deletedByPhone?: string;
};

export function buildIncomeExpensePayload(
  tx: IncomeExpense,
  operation: QueueOperation,
  deletedBy?: { name: string; phone: string },
): IncomeExpenseSyncPayload {
  const idempotencyKey = `${operation}:${tx.clientTempId}:${tx.revisionNo}`;

  return {
    operation,
    expectedRevisionNo: tx.revisionNo,
    clientTempId: tx.clientTempId,
    idempotencyKey,
    locationId: tx.locationId,
    recordStatus: operation === "delete" ? "deleted" : "active",
    localBillNo: tx.localBillNo,
    txDate: tx.txDate,
    type: tx.type,
    title: tx.title,
    cost: tx.cost,
    billOption: tx.billOption,
    unit: null,
    price: null,
    saleLines: tx.billOption === "บิลขาย"
      ? (tx.saleLines ?? []).map((line) => ({
          incomeSaleItemId: line.incomeSaleItemId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          sequenceNo: line.sequenceNo,
        }))
      : undefined,
    clientRecordedAt: tx.clientRecordedAt,
    clientCreatedAt: tx.clientCreatedAt,
    createdByUserId: tx.createdByUserId,
    createdByName: tx.createdByName,
    createdByPhone: tx.createdByPhone,
    ...(operation === "delete" && {
      deletedByName: deletedBy?.name,
      deletedByPhone: deletedBy?.phone,
    }),
  };
}
