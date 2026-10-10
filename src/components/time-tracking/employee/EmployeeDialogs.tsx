import type { Dispatch, ReactNode, SetStateAction } from "react";
import { ModalShell } from "@/components/shared/ModalShell";
import { authFetch } from "@/lib/auth-fetch";
import type { Location } from "@/types";
import { LazyPaymentAllocationModal as PaymentAllocationModal } from "../LazyPaymentAllocationModal";
import { SlipPreviewModal } from "../SlipPreviewModal";
import { WithdrawalAdjustmentModal } from "../WithdrawalAdjustmentModal";
import { bangkokToday, TIME_TRACKING_OFFLINE_MESSAGE } from "../policy";
import type { PaymentAllocationInput } from "../contracts";

type PreviewSource = { type: "withdrawal" | "payroll"; id: string };
type PendingWithdrawal = { amount: number; effectiveDate: string };

export function EmployeeDialogs({
  isDebtModalOpen, onCloseDebt, saving, setSaving, debtDueDate, setDebtDueDate, debtDescription,
  setDebtDescription, debtAmount, setDebtAmount, online, managedUserId, loadData, pendingWithdrawal,
  setPendingWithdrawal, expenseLocations, primaryLocationId, createWithdrawal, pendingExpenseLocationTx,
  setPendingExpenseLocationTx, submitWithdrawalExpenseLocation, adjustingWithdrawal, setAdjustingWithdrawal,
  adjustmentSummaryByWithdrawal, canManageTime, submitWithdrawalAdjustment, previewSource, setPreviewSource, inputDialog,
}: {
  isDebtModalOpen: boolean; onCloseDebt: () => void; saving: boolean; setSaving: Dispatch<SetStateAction<boolean>>;
  debtDueDate: string; setDebtDueDate: Dispatch<SetStateAction<string>>; debtDescription: string;
  setDebtDescription: Dispatch<SetStateAction<string>>; debtAmount: string; setDebtAmount: Dispatch<SetStateAction<string>>;
  online: boolean; managedUserId: string; loadData: () => Promise<void>; pendingWithdrawal: PendingWithdrawal | null;
  setPendingWithdrawal: Dispatch<SetStateAction<PendingWithdrawal | null>>; expenseLocations: Location[]; primaryLocationId?: string | null;
  createWithdrawal: (amount: number, effectiveDate: string | null, payment?: PaymentAllocationInput, comment?: string) => Promise<boolean>;
  pendingExpenseLocationTx: any; setPendingExpenseLocationTx: Dispatch<SetStateAction<any>>;
  submitWithdrawalExpenseLocation: (payment: PaymentAllocationInput, comment: string) => Promise<boolean>;
  adjustingWithdrawal: any; setAdjustingWithdrawal: Dispatch<SetStateAction<any>>; adjustmentSummaryByWithdrawal: Map<any, any>;
  canManageTime: boolean; submitWithdrawalAdjustment: (value: { targetAmount: number; locationId: string | null; reason: string }) => Promise<boolean>;
  previewSource: PreviewSource | null; setPreviewSource: Dispatch<SetStateAction<PreviewSource | null>>; inputDialog: ReactNode;
}) {
  return (
    <>
      {isDebtModalOpen && (
        <ModalShell
          title="สร้างหนี้สิน"
          onClose={() => onCloseDebt()}
          nativeModal
          closeOnEscape
          closeDisabled={saving}
          size="compact"
        >
          <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="time-payroll-debt-date" className="block text-sm font-semibold text-ink/70 mb-1">วันที่รายการ</label>
                <input
                  id="time-payroll-debt-date"
                  type="date"
                  value={debtDueDate}
                  onChange={(e) => setDebtDueDate(e.target.value)}
                  max={bangkokToday()}
                  required
                  className="w-full p-2 border border-black/20 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="time-payroll-debt-description" className="block text-sm font-semibold text-ink/70 mb-1">รายละเอียด</label>
                <input
                  id="time-payroll-debt-description"
                  type="text"
                  value={debtDescription}
                  onChange={(e) => setDebtDescription(e.target.value)}
                  className="w-full p-2 border border-black/20 rounded-md"
                  placeholder="ค่าสินค้า, ค่ายืม ฯลฯ"
                />
              </div>
              <div>
                <label htmlFor="time-payroll-debt-amount" className="block text-sm font-semibold text-ink/70 mb-1">ยอดเงิน (บาท)</label>
                <input
                  id="time-payroll-debt-amount"
                  type="number"
                  value={debtAmount}
                  onChange={(e) => setDebtAmount(e.target.value)}
                  className="w-full p-2 border border-black/20 rounded-md"
                  placeholder="0.00"
                />
              </div>
            <div className="flex justify-end gap-2 border-t border-black/10 pt-4">
              <button
                type="button"
                onClick={() => onCloseDebt()}
                disabled={saving}
                className="rounded-md bg-actionSecondary px-4 py-2 font-semibold text-white hover:bg-actionSecondary/90"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={saving || !online || !debtDueDate || !debtAmount || !Number.isFinite(Number(debtAmount)) || Number(debtAmount) <= 0 || !debtDescription}
                title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE}
                onClick={async () => {
                  if (!online) {
                    alert(TIME_TRACKING_OFFLINE_MESSAGE);
                    return;
                  }
                  if (debtDueDate > bangkokToday()) {
                    alert("วันที่รายการต้องไม่เกินวันปัจจุบัน");
                    return;
                  }

                  setSaving(true);
                  try {
                    const res = await authFetch("/api/lanflow/time-tracking/admin", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "CREATE_DEBT", payload: { user_id: managedUserId, amount: Number(debtAmount), effective_date: debtDueDate, description: debtDescription } })
                    });
                    if (res.ok) {
                      onCloseDebt();
                      setDebtDescription("");
                      setDebtAmount("");
                      await loadData();
                    } else {
                      const json = await res.json();
                      alert(json.error || "Failed to create debt");
                    }
                  } finally {
                    setSaving(false);
                  }
                }}
                className="rounded-md bg-commit px-4 py-2 font-bold text-white hover:bg-commit/90 disabled:opacity-50"
              >
                บันทึก
              </button>
            </div>
          </div>
        </ModalShell>
      )}
      {pendingWithdrawal && (
        <PaymentAllocationModal
          mode="create"
          locations={expenseLocations}
          paymentAmount={pendingWithdrawal.amount}
          amountLabel="ยอดเบิกที่ใช้จ่าย"
          primaryLocationId={primaryLocationId}
          onClose={() => setPendingWithdrawal(null)}
          onSubmit={(payment, comment) => createWithdrawal(pendingWithdrawal.amount, pendingWithdrawal.effectiveDate, payment, comment)}
        />
      )}
      {pendingExpenseLocationTx && (
        <PaymentAllocationModal
          locations={expenseLocations}
          paymentAmount={Number(pendingExpenseLocationTx.amount) || 0}
          amountLabel="ยอดเบิกที่ใช้จ่าย"
          primaryLocationId={primaryLocationId}
          onClose={() => setPendingExpenseLocationTx(null)}
          onSubmit={submitWithdrawalExpenseLocation}
        />
      )}
      {adjustingWithdrawal && (() => {
        const summary: any = adjustmentSummaryByWithdrawal.get(adjustingWithdrawal.id);
        return (
          <WithdrawalAdjustmentModal
            currentAmount={Number(summary?.latestTarget ?? adjustingWithdrawal.amount) || 0}
            closedSlipFloor={Number(summary?.closedSlipFloor) || 0}
            managerMode={canManageTime}
            locations={expenseLocations}
            primaryLocationId={primaryLocationId}
            sourceLocationId={adjustingWithdrawal.expense_location_id ?? null}
            onClose={() => setAdjustingWithdrawal(null)}
            onSubmit={submitWithdrawalAdjustment}
          />
        );
      })()}
      {previewSource && (
        <SlipPreviewModal
          sourceType={previewSource.type}
          sourceId={previewSource.id}
          online={online}
          onClose={() => setPreviewSource(null)}
        />
      )}
      {inputDialog}
    </>
  );
}
