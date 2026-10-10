"use client";

import { useId, useMemo, useRef, useState } from "react";

import { ModalShell } from "@/components/shared/ModalShell";
import { formatPayrollCurrency } from "@/lib/time-tracking/format";
import { derivePaymentAmounts, type PaymentAllocationInput, type PaymentChannel } from "@/lib/time-tracking/payment-allocation";
import type { Location } from "@/types";

export type PaymentAllocationModalProps = {
  locations: Location[];
  paymentAmount: number;
  amountLabel: string;
  primaryLocationId?: string | null;
  onClose: () => void;
  onSubmit: (payment: PaymentAllocationInput, comment: string) => Promise<boolean>;
  mode?: "change" | "approve" | "create";
  returnFocusElement?: HTMLElement | null;
};

export function PaymentAllocationModal({
  locations,
  paymentAmount,
  amountLabel,
  primaryLocationId,
  onClose,
  onSubmit,
  mode = "change",
  returnFocusElement,
}: PaymentAllocationModalProps) {
  const fieldId = useId();
  const submitting = useRef(false);
  const [channel, setChannel] = useState<PaymentChannel | null>(null);
  const [locationId, setLocationId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const orderedLocations = useMemo(() => [...locations].sort((a, b) =>
    a.id === primaryLocationId ? -1 : b.id === primaryLocationId ? 1 : 0
  ), [locations, primaryLocationId]);
  const parsedTransfer = transferAmount === "" ? Number.NaN : Number(transferAmount);
  const invalidTransfer = channel === "branch_and_transfer" && (
    !Number.isFinite(parsedTransfer) || parsedTransfer < 0 || parsedTransfer > paymentAmount
    || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(transferAmount)
  );
  const amounts = !invalidTransfer && Number.isFinite(parsedTransfer)
    ? derivePaymentAmounts(paymentAmount, parsedTransfer)
    : null;
  const title = mode === "change" ? "เปลี่ยนวิธีจ่าย" : "เลือกวิธีจ่าย";
  const submitLabel = mode === "change" ? "บันทึก" : mode === "approve" ? "อนุมัติ" : "สร้างและอนุมัติ";

  function selectChannel(nextChannel: PaymentChannel) {
    setChannel(nextChannel);
    setError(null);
    if (nextChannel === "outside_system") {
      setLocationId("");
      setTransferAmount("");
      return;
    }
    setLocationId(locations.some((location) => location.id === primaryLocationId) ? primaryLocationId ?? "" : "");
    setTransferAmount(String(paymentAmount));
  }

  async function submit() {
    if (!channel || submitting.current) return;
    if (channel === "branch_and_transfer" && (!locationId || invalidTransfer)) {
      setError(!locationId ? "กรุณาเลือกสาขาที่จ่ายส่วนต่าง" : "ยอดโอนต้องอยู่ระหว่าง 0 ถึงยอดรายการ และมีทศนิยมไม่เกิน 2 ตำแหน่ง");
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError(null);
    try {
      const success = await onSubmit({
        channel,
        expenseLocationId: channel === "branch_and_transfer" ? locationId : null,
        transferAmount: channel === "branch_and_transfer" ? transferAmount : null,
        expectedSourceAmount: paymentAmount,
      }, comment);
      if (!success) setError("บันทึกวิธีจ่ายไม่สำเร็จ กรุณาลองใหม่");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "บันทึกวิธีจ่ายไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <ModalShell title={title} onClose={onClose} nativeModal closeOnEscape closeDisabled={saving} size="compact" returnFocusElement={returnFocusElement}>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} aria-busy={saving}>
        <div className="mt-5 rounded-lg border border-mint bg-mint/30 px-3 py-3">
          <p className="text-pretty text-xs font-semibold text-ink/60">{amountLabel}</p>
          <p className="mt-1 tabular-nums text-lg font-bold text-ink">{formatPayrollCurrency(paymentAmount)}</p>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-ink">วิธีจ่าย</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {([
              ["branch_and_transfer", "โอนเงิน + สาขาจ่าย", "กำหนดยอดโอน แล้วให้สาขาจ่ายส่วนต่าง"],
              ["outside_system", "จ่ายนอกระบบ", "ไม่สร้างรายการโอนและไม่ลงรับ-จ่าย"],
            ] as const).map(([value, label, description]) => (
              <label key={value} className={`cursor-pointer rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-river/30 ${channel === value ? "border-river bg-river/10" : "border-black/15 bg-white hover:border-river/40"}`}>
                <input
                  type="radio"
                  name={`${fieldId}-channel`}
                  value={value}
                  checked={channel === value}
                  onChange={() => selectChannel(value)}
                  disabled={saving}
                  className="sr-only"
                />
                <span className="block text-sm font-bold text-ink">{label}</span>
                <span className="mt-1 block text-pretty text-xs text-ink/65">{description}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {channel === "branch_and_transfer" && (
          <div className="mt-4 space-y-4 rounded-lg border border-black/10 bg-mint/20 p-3">
            <div>
              <label className="block text-sm font-semibold text-ink" htmlFor={`${fieldId}-transfer`}>ยอดโอนเงิน</label>
              <input
                id={`${fieldId}-transfer`}
                type="number"
                inputMode="decimal"
                min="0"
                max={paymentAmount}
                step="0.01"
                value={transferAmount}
                onChange={(event) => { setTransferAmount(event.target.value); setError(null); }}
                disabled={saving}
                className="focus-ring mt-2 w-full rounded-md border border-black/15 bg-white px-3 py-2 tabular-nums"
                required
              />
              <p className="mt-1 text-pretty text-xs text-ink/60">กรอกได้ไม่เกิน {formatPayrollCurrency(paymentAmount)}</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink" htmlFor={`${fieldId}-location`}>สาขาที่จ่ายส่วนต่าง</label>
              <select
                id={`${fieldId}-location`}
                value={locationId}
                onChange={(event) => { setLocationId(event.target.value); setError(null); }}
                disabled={saving}
                className="focus-ring mt-2 w-full rounded-md border border-black/15 bg-white px-3 py-2"
                required
              >
                <option value="">เลือกสาขา</option>
                {orderedLocations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}{location.id === primaryLocationId ? " (สาขาหลัก)" : ""}</option>
                ))}
              </select>
            </div>
            {amounts && (
              <dl className="grid grid-cols-2 gap-2 rounded-md bg-white p-3 text-sm">
                <div><dt className="text-ink/60">ยอดโอน</dt><dd className="mt-1 tabular-nums font-bold text-river">{formatPayrollCurrency(amounts.transferAmount)}</dd></div>
                <div><dt className="text-ink/60">สาขาจ่ายส่วนต่าง</dt><dd className="mt-1 tabular-nums font-bold text-clay">{formatPayrollCurrency(amounts.branchPaidAmount)}</dd></div>
              </dl>
            )}
          </div>
        )}

        <label className="mt-4 block text-sm font-semibold text-ink" htmlFor={`${fieldId}-comment`}>หมายเหตุ (ถ้ามี)</label>
        <textarea id={`${fieldId}-comment`} rows={3} value={comment} onChange={(event) => setComment(event.target.value)} disabled={saving} className="focus-ring mt-2 w-full rounded-md border border-black/15 px-3 py-2" />
        {error && <p role="alert" className="mt-3 text-pretty text-sm font-semibold text-danger">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={saving} className="focus-ring rounded-md bg-actionSecondary px-4 py-2 text-sm font-bold text-white hover:bg-actionSecondary/90">ยกเลิก</button>
          <button type="submit" disabled={saving || !channel || (channel === "branch_and_transfer" && (!locationId || invalidTransfer))} className="focus-ring rounded-md bg-success px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {saving ? "กำลังบันทึก..." : submitLabel}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
