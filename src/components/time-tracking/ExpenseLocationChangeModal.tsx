"use client";

import { useState } from "react";

import { ModalShell } from "@/components/shared/ModalShell";
import type { Location } from "@/types";

const CENTRAL_OUTSIDE = "__central_outside_system__";

export function ExpenseLocationChangeModal({
  locations,
  primaryLocationId,
  currentLocationId,
  onClose,
  onSubmit,
}: {
  locations: Location[];
  primaryLocationId?: string | null;
  currentLocationId?: string | null;
  onClose: () => void;
  onSubmit: (locationId: string | null, comment: string) => Promise<boolean>;
}) {
  const orderedLocations = [...locations].sort((a, b) =>
    a.id === primaryLocationId ? -1 : b.id === primaryLocationId ? 1 : 0
  );
  const initialLocationId = currentLocationId === null
    ? CENTRAL_OUTSIDE
    : currentLocationId && locations.some((item) => item.id === currentLocationId)
      ? currentLocationId
      : primaryLocationId && locations.some((item) => item.id === primaryLocationId)
        ? primaryLocationId
        : locations[0]?.id ?? CENTRAL_OUTSIDE;
  const [locationId, setLocationId] = useState(initialLocationId);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!locationId) return;
    setSaving(true);
    setError(null);
    try {
      const success = await onSubmit(locationId === CENTRAL_OUTSIDE ? null : locationId, comment);
      if (!success) setError("เปลี่ยนวิธีจ่ายไม่สำเร็จ กรุณาลองใหม่");
    } catch (submitError) {
      console.error("Failed to change expense location:", submitError);
      setError("เปลี่ยนวิธีจ่ายไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title="เปลี่ยนวิธีจ่าย"
      onClose={onClose}
      nativeModal
      closeOnEscape
      closeDisabled={saving}
      size="compact"
    >
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} aria-busy={saving}>
        <label className="mt-5 block text-sm font-semibold text-ink" htmlFor="change-expense-location">
          วิธีจ่ายใหม่
        </label>
        <select
          id="change-expense-location"
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          className="mt-2 w-full rounded-md border border-black/15 bg-white px-3 py-2"
        >
          {orderedLocations.map((location) => (
            <option key={location.id} value={location.id}>{location.name}{location.id === primaryLocationId ? " (สาขาหลัก)" : ""}</option>
          ))}
          <option value={CENTRAL_OUTSIDE}>ส่วนกลางจ่าย (จ่ายนอกระบบ)</option>
        </select>
        <label className="mt-4 block text-sm font-semibold text-ink" htmlFor="change-expense-comment">
          หมายเหตุ (ถ้ามี)
        </label>
        <textarea
          id="change-expense-comment"
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
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
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
