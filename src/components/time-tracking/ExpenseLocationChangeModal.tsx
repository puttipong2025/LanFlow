"use client";

import { useId, useRef, useState } from "react";

import { ModalShell } from "@/components/shared/ModalShell";
import { formatPayrollCurrency } from "@/lib/time-tracking/format";
import type { Location } from "@/types";

export function ExpenseLocationChangeModal({
  locations,
  paymentAmount,
  amountLabel,
  primaryLocationId,
  currentLocationId,
  onClose,
  onSubmit,
}: {
  locations: Location[];
  paymentAmount: number;
  amountLabel: string;
  primaryLocationId?: string | null;
  currentLocationId?: string | null;
  onClose: () => void;
  onSubmit: (locationId: string, comment: string) => Promise<boolean>;
}) {
  const fieldId = useId();
  const submitting = useRef(false);
  const orderedLocations = [...locations].sort((a, b) =>
    a.id === primaryLocationId ? -1 : b.id === primaryLocationId ? 1 : 0
  );
  const initialLocationId = currentLocationId && locations.some((item) => item.id === currentLocationId)
    ? currentLocationId
    : primaryLocationId && locations.some((item) => item.id === primaryLocationId)
      ? primaryLocationId
      : locations[0]?.id ?? "";
  const [locationId, setLocationId] = useState(initialLocationId);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!locationId || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError(null);
    try {
      const success = await onSubmit(locationId, comment);
      if (!success) setError("บันทึกวิธีจ่ายไม่สำเร็จ กรุณาลองใหม่");
    } catch (submitError) {
      console.error("Failed to change expense location:", submitError);
      setError(submitError instanceof Error ? submitError.message : "บันทึกวิธีจ่ายไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title="เลือกวิธีจ่าย"
      onClose={onClose}
      nativeModal
      closeOnEscape
      closeDisabled={saving}
      size="compact"
    >
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} aria-busy={saving}>
        <div className="mt-5 rounded-lg border border-mint bg-mint/30 px-3 py-3">
          <p className="text-pretty text-xs font-semibold text-ink/60">{amountLabel}</p>
          <p className="mt-1 tabular-nums text-lg font-bold text-ink">{formatPayrollCurrency(paymentAmount)}</p>
        </div>
        <label className="mt-4 block text-sm font-semibold text-ink" htmlFor={`${fieldId}-location`}>วิธีจ่าย</label>
        <select
          id={`${fieldId}-location`}
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          disabled={saving}
          className="mt-2 w-full rounded-md border border-black/15 bg-white px-3 py-2"
        >
          {orderedLocations.map((location) => (
            <option key={location.id} value={location.id}>{location.name}{location.id === primaryLocationId ? " (สาขาหลัก)" : ""}</option>
          ))}
        </select>
        <label className="mt-4 block text-sm font-semibold text-ink" htmlFor={`${fieldId}-comment`}>
          หมายเหตุ (ถ้ามี)
        </label>
        <textarea
          id={`${fieldId}-comment`}
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          disabled={saving}
          className="mt-2 w-full rounded-md border border-black/15 px-3 py-2"
        />
        {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md bg-actionSecondary px-4 py-2 text-sm font-bold text-white hover:bg-actionSecondary/90"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={saving || !locationId}
            className="rounded-md bg-success px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {saving ? "กำลังบันทึก..." : "อนุมัติ"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
