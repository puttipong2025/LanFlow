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
        onOmit={() => onChange((current) => current.filter((item) => item.id !== slot.id))} />
      <button type="button" onClick={() => setRemove(slot.id)} className="focus-ring min-h-11 rounded-md border border-black/15 px-3 text-sm font-semibold">นำบัญชี {index + 1} ออก</button>
    </div>)}
    {slots.length < 4 && <button type="button" onClick={() => onChange((current) => current.length < 4 ? [...current, { id: crypto.randomUUID(), value: null, blocked: true }] : current)}
      className="focus-ring min-h-11 rounded-md border border-black/15 bg-white px-3 text-sm font-semibold">เพิ่มบัญชี</button>}
    <AlertDialog open={remove !== null} title="นำบัญชีนี้ออก?" description="ยอดและรูปของช่องนี้จะไม่นำมารวมในการนับครั้งนี้" confirmLabel="นำออก"
      onCancel={() => setRemove(null)} onConfirm={() => { onChange(slots.filter((slot) => slot.id !== remove)); setRemove(null); }} />
  </fieldset>;
}
