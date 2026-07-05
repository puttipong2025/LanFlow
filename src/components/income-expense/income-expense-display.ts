import type { IncomeExpense } from "@/types";

export function getIncomeExpenseDisplayNo(transaction: IncomeExpense) {
  return transaction.serverBillNo ?? transaction.number ?? transaction.localBillNo;
}
