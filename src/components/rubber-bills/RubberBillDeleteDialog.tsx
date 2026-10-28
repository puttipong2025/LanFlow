import { useState } from "react";
import type { RubberBill } from "@/types";
import { AlertDialog } from "@/components/shared/AlertDialog";

export function RubberBillDeleteDialog({ bill, onConfirm, onClose }: {
  bill: RubberBill; onConfirm: () => Promise<unknown>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const restart = bill.syncStatus === "failed" || bill.syncStatus === "conflict";
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await onConfirm(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "ทำรายการไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  return <AlertDialog open title={restart ? "ขอลบบิลใหม่" : "ลบบิลยาง"} busy={busy}
    description={`ต้องการลบบิล ${bill.serverBillNo ?? bill.localBillNo} ของ ${bill.customerName} ใช่ไหม? ระบบจะตรวจสิทธิ์และกติกาปัจจุบัน คำขอใหม่ที่ผ่านกติกาจะแทนคำขอเดิมที่ยังรออยู่ และส่งอนุมัติหากจำเป็น`}
    confirmLabel={restart ? "ขอลบใหม่" : "ยืนยันลบ"} onCancel={onClose} onConfirm={() => void submit()}>
    {error && <p role="alert" className="mt-3 text-pretty text-sm text-danger">{error}</p>}
  </AlertDialog>;
}
