export type PaymentChannel = "branch_and_transfer" | "outside_system";

export type PaymentAllocationInput = {
  channel: PaymentChannel;
  expenseLocationId: string | null;
  transferAmount: string | number | null;
  expectedSourceAmount: number;
};

type PaymentAllocation = {
  contractVersion: 1;
  channel: PaymentChannel;
  expenseLocationId: string | null;
  transferAmount: number;
  expectedSourceAmount: number;
  branchPaidAmount: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function derivePaymentAmounts(sourceAmount: number, transferAmount: number) {
  return {
    transferAmount: roundMoney(transferAmount),
    branchPaidAmount: roundMoney(sourceAmount - transferAmount),
  };
}

function parseTransferAmount(value: PaymentAllocationInput["transferAmount"]) {
  const raw = typeof value === "number" ? String(value) : value?.trim() ?? "";
  if (!MONEY_PATTERN.test(raw)) throw new Error("PAYMENT_INVALID_SPLIT");
  return Number(raw);
}

export function parsePaymentAllocationInput(
  input: PaymentAllocationInput,
  sourceAmount: number,
): PaymentAllocation {
  if (!Number.isFinite(sourceAmount) || sourceAmount < 0) throw new Error("PAYMENT_INVALID_SOURCE_AMOUNT");
  if (!Number.isFinite(input.expectedSourceAmount) || input.expectedSourceAmount !== sourceAmount) {
    throw new Error("PAYMENT_AMOUNT_CHANGED");
  }

  if (input.channel === "outside_system") {
    if (input.expenseLocationId !== null || input.transferAmount !== null) {
      throw new Error("PAYMENT_INVALID_OUTSIDE_SYSTEM");
    }
    return {
      contractVersion: 1,
      channel: input.channel,
      expenseLocationId: null,
      transferAmount: 0,
      expectedSourceAmount: sourceAmount,
      branchPaidAmount: 0,
    };
  }

  if (input.channel !== "branch_and_transfer" || !input.expenseLocationId
    || !UUID_PATTERN.test(input.expenseLocationId)) {
    throw new Error("PAYMENT_BRANCH_REQUIRED");
  }
  const transferAmount = parseTransferAmount(input.transferAmount);
  if (transferAmount < 0 || transferAmount > sourceAmount) throw new Error("PAYMENT_INVALID_SPLIT");
  const amounts = derivePaymentAmounts(sourceAmount, transferAmount);
  return {
    contractVersion: 1,
    channel: input.channel,
    expenseLocationId: input.expenseLocationId,
    transferAmount: amounts.transferAmount,
    expectedSourceAmount: sourceAmount,
    branchPaidAmount: amounts.branchPaidAmount,
  };
}
