import { useRef, useState } from "react";
import type { RubberBill } from "@/types";
import { AlertDialog } from "@/components/shared/AlertDialog";
import { canDeleteUnsubmittedRubberBill } from "@/lib/record-action-locks";

export function RubberBillDeleteDialog({ bill, onConfirm, onClose }: {
  bill: RubberBill; onConfirm: () => Promise<unknown>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const submitLockRef = useRef(false);
  const [error, setError] = useState("");
  const restart = bill.syncStatus === "failed" || bill.syncStatus === "conflict";
  async function submit() {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setBusy(true);
    setError("");
    try { await onConfirm(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "ทำรายการไม่สำเร็จ"); }
    finally { submitLockRef.current = false; setBusy(false); }
  }
  return <AlertDialog open title={restart ? "ขอลบบิลใหม่" : "ลบบิลยาง"} busy={busy}
    description={canDeleteUnsubmittedRubberBill(bill)
      ? `ต้องการลบบิล ${bill.localBillNo} ของ ${bill.customerName} ที่ยังไม่ส่งใช่ไหม? บิลและงานรอส่งจะถูกลบจากเครื่อง และจะไม่ส่งเมื่อกลับมาออนไลน์`
      : `ต้องการลบบิล ${bill.serverBillNo ?? bill.localBillNo} ของ ${bill.customerName} ใช่ไหม? ระบบจะตรวจสิทธิ์และกติกาปัจจุบัน คำขอใหม่ที่ผ่านกติกาจะแทนคำขอเดิมที่ยังรออยู่ และส่งอนุมัติหากจำเป็น`}
    confirmLabel={restart ? "ขอลบใหม่" : "ยืนยันลบ"} onCancel={() => { if (!submitLockRef.current) onClose(); }} onConfirm={() => void submit()}>
    {error && <p role="alert" className="mt-3 text-pretty text-sm text-danger">{error}</p>}
  </AlertDialog>;
}
