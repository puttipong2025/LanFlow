import type { IncomeExpense, QueueOperation } from "@/types";

type Persistence = {
  editing: IncomeExpense | null;
  approve: (transaction: IncomeExpense, operation: QueueOperation) => Promise<{ requiresApproval: boolean }>;
  update: (transaction: IncomeExpense) => Promise<IncomeExpense>;
  create: (transaction: IncomeExpense) => Promise<IncomeExpense>;
  validateLocalCreate?: (transaction: IncomeExpense) => void;
};

export async function persistIncomeExpenseSubmissions(submissions: IncomeExpense[], actions: Persistence) {
  let pendingApprovalCount = 0;
  const persistedTransactions: IncomeExpense[] = [];
  let persistError: unknown;
  if (actions.editing && (submissions.length !== 1
    || submissions[0].id !== actions.editing.id
    || submissions[0].clientTempId !== actions.editing.clientTempId
    || submissions[0].locationId !== actions.editing.locationId)) {
    return { pendingApprovalCount, persistedTransactions, persistError: new Error("แก้ไขได้เฉพาะรายการเดิม กรุณาเพิ่มรายการใหม่แยกต่างหาก") };
  }
  for (const transaction of submissions) {
    try {
      const operation = actions.editing && (transaction.serverBillNo || transaction.id !== transaction.clientTempId) ? "update" : "create";
      const background = operation === "update" && transaction.billOption !== "บิลขาย";
      const numberedCreate = operation === "create" && transaction.billOption !== "บิลขาย" && !!actions.validateLocalCreate;
      if (numberedCreate) actions.validateLocalCreate!(transaction);
      if (!background && !numberedCreate && (await actions.approve(transaction, operation)).requiresApproval) {
        pendingApprovalCount += 1;
        continue;
      }
      persistedTransactions.push(await (operation === "update" ? actions.update(transaction) : actions.create(transaction)));
    } catch (error) { persistError = error; break; }
  }
  return { pendingApprovalCount, persistedTransactions, persistError };
}
