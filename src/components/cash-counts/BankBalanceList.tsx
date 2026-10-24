"use client";
import { useState, type Dispatch, type SetStateAction } from "react";
import { AlertDialog } from "@/components/shared/AlertDialog";
import { BankBalanceCapture, type BankCapture } from "./BankBalanceCapture";

export type BankSlot = { id: string; value: BankCapture | null; blocked: boolean };
export function BankBalanceList({ sessionId, slots, onChange, disabled }: {
  sessionId: string; slots: BankSlot[]; onChange: Dispatch<SetStateAction<BankSlot[]>>; disabled: boolean;
}) {
  const [remove, setRemove] = useState<string | null>(null);
  function update(id: string, patch: Partial<BankSlot>) {
    onChange((current) => current.map((slot) => slot.id === id ? { ...slot, ...patch } : slot));
  }
  return <fieldset disabled={disabled} className="mt-4 space-y-3">
    <legend className="text-sm font-semibold">เงินในบัญชี (ไม่บังคับ สูงสุด 4 บัญชี)</legend>
    {slots.map((slot, index) => <div key={slot.id}>
      <BankBalanceCapture sessionId={sessionId} slotId={slot.id} label={`บัญชี${index + 1}`} value={slot.value}
        onChange={(value) => update(slot.id, { value })} onBusy={(blocked) => update(slot.id, { blocked })}
        onRemove={() => setRemove(slot.id)} />
    </div>)}
    {slots.length < 4 && <button type="button" onClick={() => onChange((current) => current.length < 4 ? [...current, { id: crypto.randomUUID(), value: null, blocked: true }] : current)}
      className="focus-ring min-h-11 rounded-md bg-leaf px-3 text-sm font-semibold text-white">เพิ่มบัญชี</button>}
    <AlertDialog open={remove !== null} title="ลบบัญชีนี้?" description="ลบช่องบัญชีนี้ออกจากการนับครั้งนี้ ยอดและรูปจะไม่ถูกรวมในผลนับ" confirmLabel="ลบ" confirmClassName="min-h-11 bg-clay text-white" cancelClassName="min-h-11 border-transparent bg-actionSecondary text-white"
      onCancel={() => setRemove(null)} onConfirm={() => { onChange((current) => current.filter((slot) => slot.id !== remove)); setRemove(null); }} />
  </fieldset>;
}
