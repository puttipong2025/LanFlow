"use client";

import { useState } from "react";
import { Location } from "@/types";
import { formatCurrency } from "@/lib/format";

export function ExpenseLocationApprovalModal({ approval, locations, onClose, onSubmit }: {
  approval: { title: string; amount: number };
  locations: Location[];
  onClose: () => void;
  onSubmit: (locationId: string, comment: string) => Promise<boolean>;
}) {
  const [locationId, setLocationId] = useState(locations.length === 1 ? locations[0]?.id || "" : "");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  async function approve() {
    if (!locationId) return;
    setSaving(true);
    try { await onSubmit(locationId, comment); } finally { setSaving(false); }
  }
  return <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
    <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
      <h2 className="text-lg font-bold text-ink">เลือกสาขาสำหรับบันทึกค่าใช้จ่าย</h2>
      <p className="mt-2 text-sm text-ink/70">{approval.title} — <strong>{formatCurrency(approval.amount)}</strong></p>
      <p className="mt-1 text-xs text-ink/55">ระบบจะใช้วันที่อนุมัติเป็นวันที่ค่าใช้จ่าย และแก้ไขได้ที่ต้นทางเท่านั้น</p>
      <label className="mt-5 block text-sm font-semibold text-ink" htmlFor="expense-location">สาขาที่หักค่าใช้จ่าย</label>
      <select id="expense-location" value={locationId} onChange={(event) => setLocationId(event.target.value)} className="mt-2 w-full rounded-md border border-black/15 bg-white px-3 py-2">
        {locations.length > 1 && <option value="" disabled>เลือกสาขา</option>}
        {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
      </select>
      <label className="mt-4 block text-sm font-semibold text-ink" htmlFor="expense-comment">หมายเหตุ (ถ้ามี)</label>
      <textarea id="expense-comment" value={comment} onChange={(event) => setComment(event.target.value)} rows={3} className="mt-2 w-full rounded-md border border-black/15 px-3 py-2" />
      <div className="mt-6 flex justify-end gap-3">
        <button onClick={onClose} disabled={saving} className="rounded-md px-4 py-2 text-sm font-bold text-ink/70">ยกเลิก</button>
        <button onClick={approve} disabled={saving || !locationId} className="rounded-md bg-leaf px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? "กำลังบันทึก..." : "อนุมัติและสร้างค่าใช้จ่าย"}</button>
      </div>
    </div>
  </div>;
}
