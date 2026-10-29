import type { IncomeExpense, QueueOperation } from "@/types";

type Persistence = {
  editing: IncomeExpense | null;
  accepted: Map<string, "persisted" | "approval">;
  approve: (transaction: IncomeExpense, operation: QueueOperation) => Promise<{ requiresApproval: boolean }>;
  update: (transaction: IncomeExpense) => Promise<IncomeExpense>;
  create: (transaction: IncomeExpense) => Promise<IncomeExpense>;
};

export async function persistIncomeExpenseSubmissions(submissions: IncomeExpense[], actions: Persistence) {
  let pendingApprovalCount = 0;
  const persistedTransactions: IncomeExpense[] = [];
  let persistError: unknown;
  const mixed = actions.editing && actions.editing.billOption !== "บิลขาย";
  for (const [index, transaction] of submissions.entries()) {
    try {
      const operation = actions.editing && index === 0 && (transaction.serverBillNo || transaction.id !== transaction.clientTempId) ? "update" : "create";
      const previous = mixed ? actions.accepted.get(transaction.clientTempId) : undefined;
      if (previous === "approval") { pendingApprovalCount += 1; continue; }
      if (previous === "persisted") { persistedTransactions.push(transaction); continue; }
      const background = operation === "update" && transaction.billOption !== "บิลขาย";
      if (!background && (await actions.approve(transaction, operation)).requiresApproval) {
        pendingApprovalCount += 1;
        if (mixed) actions.accepted.set(transaction.clientTempId, "approval");
        continue;
      }
      persistedTransactions.push(await (operation === "update" ? actions.update(transaction) : actions.create(transaction)));
      if (mixed) actions.accepted.set(transaction.clientTempId, "persisted");
    } catch (error) { persistError = error; break; }
  }
  return { pendingApprovalCount, persistedTransactions, persistError };
}
