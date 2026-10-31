import type { EffectiveRubberApprovalSettings, RubberBill } from "@/types";
import { bangkokDateString } from "@/lib/bangkok-date";
import { isRubberBillApprovalSettings } from "./approval";

export function rubberReceiptEligibility(bill: RubberBill, settings: EffectiveRubberApprovalSettings | null | undefined, now = Date.now()) {
  if (bill.approvalPending) return "approval_required";
  if (!isRubberBillApprovalSettings(settings, bill.locationId)) return "unknown";
  const prices = bill.weighItems?.map(item => item.price) ?? [];
  if (!prices.length || prices.some(price => !Number.isFinite(price) || price < 0)) return "unknown";
  if (prices.some(price => price > settings.effectivePriceCap)
    || (settings.nonCurrentDateRequiresApproval && bill.billDate !== bangkokDateString(new Date(now)))) return "approval_required";
  if (bill.serverBillNo || bill.id !== bill.clientTempId) {
    const created = Date.parse(bill.serverCreatedAt ?? "");
    if (!Number.isFinite(created)) return "unknown";
    if (now >= created + settings.editWindowMinutes * 60000) return "approval_required";
  }
  return "allowed";
}

/** An immutable local document; never used to alter queue or Server state. */
export function immediateRubberReceipt(bill: RubberBill, settings: EffectiveRubberApprovalSettings | null | undefined): RubberBill | null {
  if (rubberReceiptEligibility(bill, settings) !== "allowed") return null;
  return JSON.parse(JSON.stringify({ ...bill, id: bill.clientTempId, serverBillNo: undefined,
    billNo: bill.billNumbering ? bill.serverBillNo ?? bill.localBillNo : bill.localBillNo, syncStatus: "pending", serverSubmissionAttempted: false,
    approvalPending: false, approvalState: "not_required", approvalRevisionNo: null,
    approvalApprovedByName: null, configuredPriceSnapshot: settings!.effectivePriceCap })) as RubberBill;
}
