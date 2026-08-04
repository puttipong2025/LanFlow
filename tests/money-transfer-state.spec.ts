import { expect, test } from "@playwright/test";

import {
  deriveMoneyTransferStatus,
  getMoneyTransferPaymentSummary,
  sumMoneyTransferSlips,
} from "../src/lib/money-transfers/state";

test.describe("Money transfer payment state", () => {
  test("derives every payment status from due and paid amounts", () => {
    expect(deriveMoneyTransferStatus({ amountDue: 1_000, amountPaid: 0 })).toBe("pending");
    expect(deriveMoneyTransferStatus({ amountDue: 0, amountPaid: 500 })).toBe("advance_payment");
    expect(deriveMoneyTransferStatus({ amountDue: 1_000, amountPaid: 1_000 })).toBe("paid");
    expect(deriveMoneyTransferStatus({ amountDue: 1_000, amountPaid: 999.991 })).toBe("paid");
    expect(deriveMoneyTransferStatus({ amountDue: 1_000, amountPaid: 999.99 })).toBe("paid");
    expect(deriveMoneyTransferStatus({ amountDue: 1_000, amountPaid: 999.98 })).toBe("partial");
    expect(deriveMoneyTransferStatus({ amountDue: 1_000, amountPaid: 900 })).toBe("partial");
    expect(deriveMoneyTransferStatus({ amountDue: 1_000, amountPaid: 900, branchPaysRemaining: true })).toBe("branch_and_transfer");
    expect(deriveMoneyTransferStatus({ amountDue: 1_000, amountPaid: 1_001 })).toBe("overpaid");
    expect(deriveMoneyTransferStatus({ amountDue: 1_000, amountPaid: 1_000, cancelled: true })).toBe("cancelled");
  });

  test("separates the amount due from the actual slip total", () => {
    const slips = [
      { amount: 200 },
      { amount: 300 },
    ];

    expect(sumMoneyTransferSlips(slips)).toBe(500);
    expect(getMoneyTransferPaymentSummary({
      netAmountToPay: 0,
      transferStatus: "advance_payment",
      slips: slips.map((slip, index) => ({
        id: String(index),
        amount: slip.amount,
        referenceNumber: null,
        fee: 0,
        senderName: null,
        receiverName: null,
        transactionDate: null,
        slipImageUrl: null,
        sortOrder: index,
      })),
    })).toEqual({
      amountDue: 0,
      amountPaid: 500,
      difference: 500,
      status: "advance_payment",
    });
  });
});
