"use client";

import { useState } from "react";

import type { Location } from "@/types";

export function ExpenseLocationChangeModal({
  locations,
  onClose,
  onSubmit,
}: {
  locations: Location[];
  onClose: () => void;
  onSubmit: (locationId: string, comment: string) => Promise<boolean>;
}) {
  const [locationId, setLocationId] = useState(locations.length === 1 ? locations[0]?.id ?? "" : "");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!locationId) return;
    setSaving(true);
    try {
      await onSubmit(locationId, comment);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-ink">เปลี่ยนสาขาค่าใช้จ่าย</h2>
        <label className="mt-5 block text-sm font-semibold text-ink" htmlFor="change-expense-location">
          สาขาค่าใช้จ่ายใหม่
        </label>
        <select
          id="change-expense-location"
          autoFocus
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          className="mt-2 w-full rounded-md border border-black/15 bg-white px-3 py-2"
        >
          {locations.length > 1 && <option value="" disabled>เลือกสาขา</option>}
          {locations.map((location) => (
            <option key={location.id} value={location.id}>{location.name}</option>
          ))}
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
            type="button"
            onClick={() => void submit()}
            disabled={saving || !locationId}
            className="rounded-md bg-success px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}
