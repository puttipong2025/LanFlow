import { bangkokDateString } from "@/lib/bangkok-date";
import type { MoneyTransferSlip } from "@/types";

export type SlipField = "amount" | "referenceNumber" | "fee" | "transactionDate";
export type SlipValidationIssue = {
  slipId: string;
  slipIndex: number;
  field: SlipField;
  message: string;
};

export function slipFieldInputId(slipId: string, field: SlipField) {
  return `money-transfer-slip-${slipId}-${field}`;
}

export function validateMoneyTransferSlips(
  slips: MoneyTransferSlip[],
  { requireOne = false, requireSameBangkokDate = false } = {},
) {
  const issues: SlipValidationIssue[] = [];
  if (requireOne && slips.length === 0) {
    return [{ slipId: "", slipIndex: 0, field: "amount" as const, message: "กรุณาเพิ่มสลิปอย่างน้อย 1 ใบ" }];
  }

  const dates = new Set<string>();
  slips.forEach((slip, slipIndex) => {
    if (!Number.isFinite(slip.amount) || slip.amount <= 0) {
      issues.push({ slipId: slip.id, slipIndex, field: "amount", message: `สลิป ${slipIndex + 1}: จำนวนเงินต้องมากกว่า 0` });
    }
    if (!Number.isFinite(slip.fee) || slip.fee < 0) {
      issues.push({ slipId: slip.id, slipIndex, field: "fee", message: `สลิป ${slipIndex + 1}: ค่าธรรมเนียมต้องไม่ติดลบ` });
    }
    if (slip.inputMethod === "ocr" && !slip.referenceNumber?.trim()) {
      issues.push({ slipId: slip.id, slipIndex, field: "referenceNumber", message: `สลิป ${slipIndex + 1}: OCR อ่านเลขอ้างอิงไม่ครบ กรุณาอ่านสลิปใหม่` });
    }
    if (!slip.transactionDate) {
      issues.push({ slipId: slip.id, slipIndex, field: "transactionDate", message: `สลิป ${slipIndex + 1}: กรุณาระบุวันที่ทำรายการ` });
      return;
    }
    try {
      const transactionDate = new Date(slip.transactionDate);
      if (Number.isNaN(transactionDate.getTime())) throw new RangeError("Invalid transaction date");
      dates.add(bangkokDateString(transactionDate));
    } catch {
      issues.push({ slipId: slip.id, slipIndex, field: "transactionDate", message: `สลิป ${slipIndex + 1}: วันที่ทำรายการไม่ถูกต้อง` });
    }
  });

  if (requireSameBangkokDate && dates.size > 1) {
    slips.forEach((slip, slipIndex) => {
      if (slip.transactionDate) {
        issues.push({ slipId: slip.id, slipIndex, field: "transactionDate", message: `สลิป ${slipIndex + 1}: วันที่ต้องเป็นวันเดียวกันทุกใบ` });
      }
    });
  }
  return issues;
}

export function focusFirstSlipIssue(issues: SlipValidationIssue[]) {
  const first = issues.find((issue) => issue.slipId);
  if (!first || typeof document === "undefined") return;
  window.requestAnimationFrame(() => {
    document.getElementById(slipFieldInputId(first.slipId, first.field))?.focus();
  });
}
