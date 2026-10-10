import { expect, test } from "@playwright/test";

import {
  derivePaymentAmounts,
  parsePaymentAllocationInput,
  type PaymentAllocationInput,
} from "@/lib/time-tracking/payment-allocation";
import { mapTimePayrollPaymentRpcError } from "@/lib/server/time-payroll-payment-errors";
import {
  createTimePayrollSlip,
  createTimePayrollTransaction,
  decideTimePayrollPayment,
  isValidPayrollSlipCreationPayment,
} from "@/lib/server/time-payroll-payment-mutations";
import { paymentAllocationSourceLabel } from "@/lib/time-tracking/payment-label";

function rpcRecorder() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
}

test.describe("time/payroll payment allocation contract", () => {
  test("derives branch-only, transfer-only, and split amounts without storing duplicate totals", () => {
    expect(derivePaymentAmounts(500, 0)).toEqual({ transferAmount: 0, branchPaidAmount: 500 });
    expect(derivePaymentAmounts(500, 500)).toEqual({ transferAmount: 500, branchPaidAmount: 0 });
    expect(derivePaymentAmounts(500, 125.5)).toEqual({ transferAmount: 125.5, branchPaidAmount: 374.5 });
  });

  test("accepts canonical split and outside-system payloads", () => {
    expect(parsePaymentAllocationInput({
      channel: "branch_and_transfer",
      expenseLocationId: "71000000-0000-4000-8000-000000000001",
      transferAmount: "125.50",
      expectedSourceAmount: 500,
    }, 500)).toEqual({
      contractVersion: 1,
      channel: "branch_and_transfer",
      expenseLocationId: "71000000-0000-4000-8000-000000000001",
      transferAmount: 125.5,
      expectedSourceAmount: 500,
      branchPaidAmount: 374.5,
    });
    expect(parsePaymentAllocationInput({
      channel: "outside_system",
      expenseLocationId: null,
      transferAmount: null,
      expectedSourceAmount: 500,
    }, 500)).toEqual({
      contractVersion: 1,
      channel: "outside_system",
      expenseLocationId: null,
      transferAmount: 0,
      expectedSourceAmount: 500,
      branchPaidAmount: 0,
    });
  });

  for (const input of ([
    { channel: "branch_and_transfer", expenseLocationId: null, transferAmount: "1", expectedSourceAmount: 500 },
    { channel: "branch_and_transfer", expenseLocationId: "71000000-0000-4000-8000-000000000001", transferAmount: "-1", expectedSourceAmount: 500 },
    { channel: "branch_and_transfer", expenseLocationId: "71000000-0000-4000-8000-000000000001", transferAmount: "500.01", expectedSourceAmount: 500 },
    { channel: "branch_and_transfer", expenseLocationId: "71000000-0000-4000-8000-000000000001", transferAmount: "1.001", expectedSourceAmount: 500 },
    { channel: "outside_system", expenseLocationId: "71000000-0000-4000-8000-000000000001", transferAmount: null, expectedSourceAmount: 500 },
    { channel: "outside_system", expenseLocationId: null, transferAmount: "1", expectedSourceAmount: 500 },
    { channel: "outside_system", expenseLocationId: null, transferAmount: null, expectedSourceAmount: 499 },
  ] satisfies PaymentAllocationInput[])) {
    test(`rejects invalid or stale payload ${JSON.stringify(input)}`, () => {
      expect(() => parsePaymentAllocationInput(input, 500)).toThrow();
    });
  }

  test("labels canonical source outcomes", () => {
    expect(paymentAllocationSourceLabel({ channel: "branch_and_transfer", transferAmount: 0, sourceAmount: 500, locationName: "สาขา A" })).toBe("สาขาจ่ายทั้งหมด 500.00 บาท — สาขา A");
    expect(paymentAllocationSourceLabel({ channel: "branch_and_transfer", transferAmount: 500, sourceAmount: 500, locationName: "สาขา A" })).toBe("โอนเงินทั้งหมด 500.00 บาท");
    expect(paymentAllocationSourceLabel({ channel: "branch_and_transfer", transferAmount: 125, sourceAmount: 500, locationName: "สาขา A" })).toBe("โอน 125.00 บาท + สาขา A จ่ายส่วนต่าง 375.00 บาท");
  });

  test("maps payment RPC failures to actionable route responses", () => {
    expect(mapTimePayrollPaymentRpcError("PAYMENT_TRANSFER_HAS_SLIPS")).toEqual({
      status: 409,
      message: "รายการโอนมีสลิปแล้ว จึงเปลี่ยนวิธีจ่ายไม่ได้",
    });
    expect(mapTimePayrollPaymentRpcError("PAYMENT_BRANCH_DENIED")).toEqual({
      status: 403,
      message: "คุณไม่มีสิทธิ์ใช้สาขาที่เลือกสำหรับวิธีจ่ายนี้",
    });
    expect(mapTimePayrollPaymentRpcError("PAYMENT_SOURCE_NOT_FOUND")).toEqual({
      status: 404,
      message: "ไม่พบรายการเวลาและเงินเดือนต้นทาง",
    });
    expect(mapTimePayrollPaymentRpcError("PAYMENT_USE_ALLOCATION_API")).toEqual({
      status: 409,
      message: "วิธีจ่ายของรายการนี้เปลี่ยนแล้ว กรุณารีเฟรชและเลือกวิธีจ่ายใหม่",
    });
    expect(mapTimePayrollPaymentRpcError("PAYMENT_REQUIRED")).toEqual({
      status: 400,
      message: "กรุณาเลือกวิธีจ่ายก่อนอนุมัติรายการ",
    });
    expect(mapTimePayrollPaymentRpcError("PAYMENT_AMOUNT_CHANGED")).toEqual({
      status: 409,
      message: "ยอดรายการเปลี่ยนแล้ว กรุณารีเฟรชและเลือกวิธีจ่ายใหม่",
    });
    expect(mapTimePayrollPaymentRpcError("PAYMENT_INVALID_SPLIT")).toEqual({
      status: 400,
      message: "ยอดโอนต้องอยู่ระหว่าง 0 ถึงยอดรายการ และมีทศนิยมไม่เกิน 2 ตำแหน่ง",
    });
    expect(mapTimePayrollPaymentRpcError("unrelated database error")).toBeNull();
  });

  test("never falls back to legacy RPCs for payment-bearing source creation", async () => {
    const debt = rpcRecorder();
    await createTimePayrollTransaction(debt.client as never, "CREATE_DEBT", {
      user_id: "72000000-0000-4000-8000-000000000002",
      amount: 500,
      effective_date: "2026-10-09",
    });
    expect(debt.calls).toEqual([{
      name: "create_time_tracking_transaction",
      args: expect.objectContaining({ p_type: "DEBT", p_expense_location_id: null }),
    }]);

    const withdrawal = rpcRecorder();
    await createTimePayrollTransaction(withdrawal.client as never, "ADMIN_REQUEST_WITHDRAWAL", {
      user_id: "72000000-0000-4000-8000-000000000002",
      amount: 500,
      effective_date: "2026-10-09",
    });
    expect(withdrawal.calls.map((call) => call.name)).toEqual([
      "create_time_tracking_withdrawal_with_payment",
    ]);

    const payroll = rpcRecorder();
    await createTimePayrollSlip(payroll.client as never, {
      user_id: "72000000-0000-4000-8000-000000000002",
      month: "2026-10",
      expected_net_pay: 0,
    });
    expect(payroll.calls.map((call) => call.name)).toEqual([
      "create_time_tracking_payroll_slip_with_payment",
    ]);
  });

  test("routes every approval through the source-amount-aware payment RPC", async () => {
    const approval = rpcRecorder();
    await decideTimePayrollPayment(
      approval.client as never,
      "payroll_slip",
      "74000000-0000-4000-8000-000000000001",
      {
        status: "APPROVED",
        payment: {
          channel: "outside_system",
          expenseLocationId: null,
          transferAmount: null,
          expectedSourceAmount: 500,
        },
      },
    );
    expect(approval.calls.map((call) => call.name)).toEqual([
      "decide_time_tracking_approval_with_payment",
    ]);

    const rejection = rpcRecorder();
    await decideTimePayrollPayment(
      rejection.client as never,
      "transaction",
      "74000000-0000-4000-8000-000000000002",
      { status: "REJECTED" },
    );
    expect(rejection.calls).toEqual([{
      name: "decide_time_tracking_approval",
      args: expect.objectContaining({ p_decision: "REJECTED", p_expense_location_id: null }),
    }]);
  });

  test("requires a payment contract only when a new payroll slip has a positive net amount", () => {
    expect(isValidPayrollSlipCreationPayment({ expected_net_pay: 0 })).toBe(true);
    expect(isValidPayrollSlipCreationPayment({ expected_net_pay: 0, payment: null })).toBe(true);
    expect(isValidPayrollSlipCreationPayment({
      expected_net_pay: 0,
      payment: {
        channel: "outside_system",
        expenseLocationId: null,
        transferAmount: null,
        expectedSourceAmount: 500,
      },
    })).toBe(false);
    expect(isValidPayrollSlipCreationPayment({ expected_net_pay: 500 })).toBe(false);
    expect(isValidPayrollSlipCreationPayment({ expected_net_pay: -1 })).toBe(false);
    expect(isValidPayrollSlipCreationPayment({
      expected_net_pay: 500,
      payment: {
        channel: "outside_system",
        expenseLocationId: null,
        transferAmount: null,
        expectedSourceAmount: 500,
      },
    })).toBe(true);
    expect(isValidPayrollSlipCreationPayment({
      expected_net_pay: 500,
      payment: {
        channel: "outside_system",
        expenseLocationId: null,
        transferAmount: null,
        expectedSourceAmount: 499,
      },
    })).toBe(false);
  });
});
