"use client";

import { useState } from "react";
import { ModalShell } from "@/components/shared/ModalShell";
import { formatCurrency } from "@/lib/format";
import type { Location } from "@/types";

const CENTRAL_OUTSIDE = "__central_outside_system__";

export function ExpenseLocationApprovalModal({ approval, locations, primaryLocationId, onClose, onSubmit }: {
  approval: { title: string; amount: number };
  locations: Location[];
  primaryLocationId?: string | null;
  onClose: () => void;
  onSubmit: (locationId: string | null, comment: string) => Promise<boolean>;
}) {
  const orderedLocations = [...locations].sort((a, b) =>
    a.id === primaryLocationId ? -1 : b.id === primaryLocationId ? 1 : 0
  );
  const [locationId, setLocationId] = useState(primaryLocationId && locations.some((item) => item.id === primaryLocationId)
    ? primaryLocationId
    : locations[0]?.id ?? CENTRAL_OUTSIDE);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function approve() {
    if (!locationId) return;
    setSaving(true);
    setError(null);
    try {
      const success = await onSubmit(locationId === CENTRAL_OUTSIDE ? null : locationId, comment);
      if (!success) setError("อนุมัติรายการไม่สำเร็จ กรุณาลองใหม่");
    } catch (submitError) {
      console.error("Failed to approve time/payroll expense:", submitError);
      setError("อนุมัติรายการไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSaving(false);
    }
  }
  return <ModalShell
    title="เลือกสาขาสำหรับบันทึกค่าใช้จ่าย"
    onClose={onClose}
    nativeModal
    closeOnEscape
    closeDisabled={saving}
    size="compact"
  >
    <form onSubmit={(event) => { event.preventDefault(); void approve(); }} aria-busy={saving}>
      <p className="mt-2 text-sm text-ink/70">{approval.title} — <strong>{formatCurrency(approval.amount)}</strong></p>
      <p className="mt-1 text-xs text-ink/55">ระบบจะใช้วันที่อนุมัติเป็นวันที่ค่าใช้จ่าย และแก้ไขได้ที่ต้นทางเท่านั้น</p>
      <label className="mt-5 block text-sm font-semibold text-ink" htmlFor="expense-location">สาขาที่หักค่าใช้จ่าย</label>
      <select id="expense-location" value={locationId} onChange={(event) => setLocationId(event.target.value)} className="mt-2 w-full rounded-md border border-black/15 bg-white px-3 py-2">
        {orderedLocations.map((location) => <option key={location.id} value={location.id}>{location.name}{location.id === primaryLocationId ? " (สาขาหลัก)" : ""}</option>)}
        <option value={CENTRAL_OUTSIDE}>ส่วนกลางจ่าย (จ่ายนอกระบบ)</option>
      </select>
      <label className="mt-4 block text-sm font-semibold text-ink" htmlFor="expense-comment">หมายเหตุ (ถ้ามี)</label>
      <textarea id="expense-comment" value={comment} onChange={(event) => setComment(event.target.value)} rows={3} className="mt-2 w-full rounded-md border border-black/15 px-3 py-2" />
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger">{error}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onClose} disabled={saving} className="rounded-md bg-actionSecondary px-4 py-2 text-sm font-bold text-white hover:bg-actionSecondary/90">ยกเลิก</button>
        <button type="submit" disabled={saving || !locationId} className="rounded-md bg-success px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? "กำลังบันทึก..." : "อนุมัติ"}</button>
      </div>
    </form>
  </ModalShell>;
}
