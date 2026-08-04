import type { MoneyTransfer, MoneyTransferSlip } from "@/types";

const PAYMENT_TOLERANCE = 0.01;

export function sumMoneyTransferSlips(slips: Pick<MoneyTransferSlip, "amount">[] = []) {
  return slips.reduce((sum, slip) => sum + slip.amount, 0);
}

export function deriveMoneyTransferStatus({
  amountDue,
  amountPaid,
  branchPaysRemaining = false,
  cancelled = false,
}: {
  amountDue: number;
  amountPaid: number;
  branchPaysRemaining?: boolean;
  cancelled?: boolean;
}): MoneyTransfer["transferStatus"] {
  if (cancelled) return "cancelled";
  if (amountPaid <= 0) return "pending";
  if (amountDue <= 0) return "advance_payment";

  const remaining = amountDue - amountPaid;
  if (Math.abs(remaining) <= PAYMENT_TOLERANCE) return "paid";
  if (remaining > PAYMENT_TOLERANCE) {
    return branchPaysRemaining ? "branch_and_transfer" : "partial";
  }
  return "overpaid";
}

export function getMoneyTransferPaymentSummary(
  transfer: Pick<MoneyTransfer, "netAmountToPay" | "slips" | "transferStatus">,
) {
  const amountDue = transfer.netAmountToPay;
  const amountPaid = sumMoneyTransferSlips(transfer.slips);
  const status = deriveMoneyTransferStatus({
    amountDue,
    amountPaid,
    branchPaysRemaining: transfer.transferStatus === "branch_and_transfer",
    cancelled: transfer.transferStatus === "cancelled",
  });

  return {
    amountDue,
    amountPaid,
    difference: amountPaid - amountDue,
    status,
  };
}
