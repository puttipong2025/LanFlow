"use client";

import { useId, useMemo, useRef, useState } from "react";

import { ModalShell } from "@/components/shared/ModalShell";
import { formatPayrollCurrency } from "@/lib/time-tracking/format";
import type { Location } from "@/types";

type AdjustmentSubmit = {
  targetAmount: number;
  locationId: string | null;
  reason: string;
};

export function WithdrawalAdjustmentModal({
  currentAmount,
  closedSlipFloor,
  managerMode,
  locations,
  primaryLocationId,
  sourceLocationId,
  onClose,
  onSubmit,
}: {
  currentAmount: number;
  closedSlipFloor: number;
  managerMode: boolean;
  locations: Location[];
  primaryLocationId?: string | null;
  sourceLocationId?: string | null;
  onClose: () => void;
  onSubmit: (value: AdjustmentSubmit) => Promise<boolean>;
}) {
  const fieldId = useId();
  const submitting = useRef(false);
  const preferredLocationId = sourceLocationId && locations.some((item) => item.id === sourceLocationId)
    ? sourceLocationId
    : primaryLocationId;
  const orderedLocations = useMemo(() => [...locations].sort((a, b) =>
    a.id === preferredLocationId ? -1 : b.id === preferredLocationId ? 1 : 0
  ), [locations, preferredLocationId]);
  const [targetText, setTargetText] = useState(String(currentAmount));
  const [locationId, setLocationId] = useState(
    preferredLocationId && locations.some((item) => item.id === preferredLocationId)
      ? preferredLocationId
      : locations[0]?.id ?? "",
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetAmount = Number(targetText);
  const validTarget = targetText.trim() !== ""
    && /^\d+(?:\.\d{1,2})?$/.test(targetText.trim())
    && Number.isFinite(targetAmount)
    && targetAmount >= 0
    && targetAmount <= 1_000_000_000;
  const delta = validTarget ? Math.round((targetAmount - currentAmount) * 100) / 100 : 0;
  const belowFloor = validTarget && targetAmount < closedSlipFloor;
  const noOp = validTarget && delta === 0;
  const disabled = saving || !validTarget || belowFloor || noOp || (managerMode && !locationId);

  async function submit() {
    if (disabled || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError(null);
    try {
      const success = await onSubmit({
        targetAmount,
        locationId: managerMode ? locationId : null,
        reason: reason.trim(),
      });
      if (!success) setError("บันทึกคำขอปรับยอดไม่สำเร็จ กรุณาลองใหม่");
    } catch (submitError) {
      console.error("Failed to adjust withdrawal:", submitError);
      setError(submitError instanceof Error ? submitError.message : "บันทึกคำขอปรับยอดไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title="ปรับยอดเบิกเงิน"
      subtitle="รายการเดิมยังคงอยู่ ระบบจะบันทึกส่วนต่างเป็นประวัติใหม่"
      onClose={onClose}
      nativeModal
      closeOnEscape
      closeDisabled={saving}
      size="compact"
    >
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} aria-busy={saving}>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-black/10 bg-field p-3">
            <p className="text-pretty text-xs font-semibold text-ink/60">ยอดเบิกปัจจุบัน</p>
            <p className="mt-1 tabular-nums text-lg font-bold text-ink">{formatPayrollCurrency(currentAmount)}</p>
          </div>
          <div className="rounded-lg border border-mint bg-mint/30 p-3">
            <p className="text-pretty text-xs font-semibold text-ink/60">ยอดต่ำสุดที่ปรับได้</p>
            <p className="mt-1 tabular-nums text-lg font-bold text-ink">{formatPayrollCurrency(closedSlipFloor)}</p>
          </div>
        </div>

        <label className="mt-4 block text-sm font-semibold text-ink" htmlFor={`${fieldId}-target`}>
          ยอดเบิกใหม่ (บาท)
        </label>
        <input
          id={`${fieldId}-target`}
          type="number"
          min={closedSlipFloor}
          max={1_000_000_000}
          step="0.01"
          inputMode="decimal"
          value={targetText}
          onChange={(event) => setTargetText(event.target.value)}
          disabled={saving}
          aria-invalid={!validTarget || belowFloor}
          aria-describedby={`${fieldId}-target-help`}
          className="mt-2 w-full rounded-md border border-black/15 bg-white px-3 py-2 tabular-nums"
        />
        <p id={`${fieldId}-target-help`} className={`mt-2 text-pretty text-xs ${belowFloor || !validTarget ? "font-semibold text-danger" : "text-ink/55"}`} aria-live="polite">
          {!validTarget
            ? "กรอกยอดตั้งแต่ 0 บาท และทศนิยมไม่เกิน 2 ตำแหน่ง"
            : belowFloor
              ? "ยอดใหม่ต่ำกว่ายอดที่ถูกหักในสลิปเก่าซึ่งปิดแล้ว"
              : noOp ? "ยอดใหม่ต้องต่างจากยอดปัจจุบัน" : "ปรับได้เฉพาะยอดของเดือนที่ยังไม่ปิดสลิป"}
        </p>
        {validTarget && !belowFloor && !noOp && (
          <div className={`mt-3 rounded-lg border p-3 ${delta > 0 ? "border-amber/30 bg-amber/10" : "border-leaf/25 bg-mint/30"}`}>
            <p className="text-pretty text-xs font-semibold text-ink/60">ผลต่อรับ–จ่ายของสาขา</p>
            <p className={`mt-1 tabular-nums font-bold ${delta > 0 ? "text-amber" : "text-leaf"}`}>
              {delta > 0 ? "เพิ่มรายจ่าย" : "เพิ่มรายรับ (คืนเงิน)"} {formatPayrollCurrency(Math.abs(delta))}
            </p>
          </div>
        )}

        {managerMode && (
          <>
            <label className="mt-4 block text-sm font-semibold text-ink" htmlFor={`${fieldId}-location`}>
              สาขาที่รับ–จ่ายส่วนต่าง
            </label>
            <select
              id={`${fieldId}-location`}
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              disabled={saving}
              required
              className="mt-2 w-full rounded-md border border-black/15 bg-white px-3 py-2"
            >
              <option value="" disabled>เลือกสาขา</option>
              {orderedLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}{location.id === primaryLocationId ? " (สาขาหลัก)" : ""}
                </option>
              ))}
            </select>
          </>
        )}

        <label className="mt-4 block text-sm font-semibold text-ink" htmlFor={`${fieldId}-reason`}>
          รายละเอียดเพิ่มเติม (ไม่บังคับ)
        </label>
        <textarea
          id={`${fieldId}-reason`}
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={saving}
          aria-describedby={`${fieldId}-reason-help`}
          placeholder="เช่น คืนเงินส่วนที่เบิกเกิน หรือเพิ่มยอดตามหลักฐาน"
          className="mt-2 w-full rounded-md border border-black/15 px-3 py-2"
        />
        <p id={`${fieldId}-reason-help`} className="mt-1 text-pretty text-xs text-ink/55">ไม่บังคับ สูงสุด 500 ตัวอักษร</p>
        {error && <p role="alert" className="mt-3 text-pretty text-sm font-semibold text-danger">{error}</p>}

        <div className="mt-6 flex justify-end gap-3 border-t border-black/10 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md bg-actionSecondary px-4 py-2 text-sm font-bold text-white hover:bg-actionSecondary/90 disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={disabled}
            className="rounded-md bg-commit px-4 py-2 text-sm font-bold text-white hover:bg-commit/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "กำลังบันทึก..." : managerMode ? "บันทึกและอนุมัติ" : "ส่งคำขอ"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
