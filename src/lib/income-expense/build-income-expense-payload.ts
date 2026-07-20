import type { IncomeExpense, QueueOperation, IncomeBillOption, ExpenseBillOption } from "@/types";

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
  incomeSaleItemId?: string | null;
  stockProductId?: string | null;
  stockQuantity?: number | null;
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
    unit: tx.billOption === "บิลขาย" ? (tx.unit ?? null) : null,
    price: tx.billOption === "บิลขาย" ? (tx.price ?? null) : null,
    incomeSaleItemId: tx.billOption === "บิลขาย" ? (tx.incomeSaleItemId ?? null) : null,
    stockProductId: tx.billOption === "บิลขาย" ? (tx.stockProductId ?? null) : null,
    stockQuantity: tx.billOption === "บิลขาย" ? (tx.stockQuantity ?? Number(tx.unit ?? 0)) : null,
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
