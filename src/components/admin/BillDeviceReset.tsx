"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertDialog } from "@/components/shared/AlertDialog";
import { authFetch } from "@/lib/auth-fetch";
import { DEVICE_RESET_CONFIRMATION, DEVICE_RESET_MODE, isDeviceResetPreview, isDeviceResetReceipt, type DeviceResetPreview } from "@/lib/rubber-bills/device-reset-contract";

const endpoint = "/api/lanflow/admin/rubber-bill-issuers/reset";
export function BillDeviceReset({ ownerUserId }: { ownerUserId: string }) {
  const client = useQueryClient(), lock = useRef(false), generation = useRef(0);
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<DeviceResetPreview | null>(null), [requestId, setRequestId] = useState("");
  const [confirmation, setConfirmation] = useState(""), [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  async function loadPreview() {
    const current = ++generation.current;
    setLoading(true); setPreview(null); setConfirmation(""); setRequestId("");
    try {
      const response = await authFetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      const result: unknown = await response.json();
      if (!response.ok || !isDeviceResetPreview(result)) throw new Error("โหลดจำนวนเครื่องไม่สำเร็จ กรุณาลองใหม่");
      if (current !== generation.current) return;
      setPreview(result); setRequestId(crypto.randomUUID());
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "โหลดจำนวนเครื่องไม่สำเร็จ");
    } finally { if (current === generation.current) setLoading(false); }
  }
  function show() {
    setOpen(true); setMessage("");
    if (!uncertain) { setError(""); void loadPreview(); }
  }
  async function reset() {
    if (lock.current || !preview?.count || !requestId || (!uncertain && confirmation !== DEVICE_RESET_CONFIRMATION)) return;
    lock.current = true; setSaving(true); setError("");
    try {
      const response = await authFetch(endpoint, { method: "POST", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: DEVICE_RESET_MODE, requestId, snapshot: preview.snapshot, confirmation: DEVICE_RESET_CONFIRMATION }) });
      const result: unknown = await response.json();
      if (response.status === 409 && result && typeof result === "object" && "errorCode" in result
        && result.errorCode === "DEVICE_RESET_CONFLICT") {
        setUncertain(false); setError("รายชื่อเครื่องเปลี่ยน กรุณาตรวจจำนวนล่าสุดและพิมพ์ยืนยันใหม่");
        await loadPreview(); return;
      }
      if (!response.ok || !isDeviceResetReceipt(result) || result.requestId !== requestId || result.snapshot !== preview.snapshot
        || result.retiredCount !== preview.count) throw new Error("ยังยืนยันผลไม่ได้ กรุณาตรวจผลคำสั่งเดิมอีกครั้ง");
      setUncertain(false); setOpen(false); setPreview(null); setConfirmation("");
      setMessage(`ล้างทะเบียนรหัสเครื่อง ${result.retiredCount.toLocaleString("th-TH")} รายการสำเร็จ`);
      void client.invalidateQueries({ queryKey: ["rubberBillIssuers", ownerUserId] });
    } catch (cause) {
      setUncertain(true); setError(cause instanceof Error ? cause.message : "ยังยืนยันผลไม่ได้ กรุณาตรวจผลคำสั่งเดิมอีกครั้ง");
    } finally { lock.current = false; setSaving(false); }
  }
  return <div className="space-y-2">
    <button type="button" onClick={show} className="focus-ring h-10 rounded-md border border-clay px-3 text-sm font-semibold text-clay">รีเซ็ตทั้งหมด</button>
    {message && <p role="status" className="text-pretty text-sm tabular-nums">{message} · เครื่องจะรับรหัสใหม่เมื่อตรวจทะเบียนสำเร็จครั้งถัดไป</p>}
    <AlertDialog open={open} title="รีเซ็ตรหัสเครื่องทั้งหมด?"
      description="ล้างทะเบียนทุกสาขารวมรหัสที่เลิกใช้แล้ว ร่วมกับบิลยางและรับ–จ่าย เริ่มแจก D01 และลำดับบิล 0001 ใหม่ บิลเดิมและงานค้างคงเลขเดิม โดยเลขท้ายจะนับต่อเมื่อฐานซ้ำ"
      confirmLabel={uncertain ? "ตรวจผลคำสั่งเดิม" : "ยืนยันรีเซ็ตทั้งหมด"} busy={saving}
      confirmDisabled={loading || !preview?.count || (!uncertain && confirmation !== DEVICE_RESET_CONFIRMATION)}
      onConfirm={() => void reset()} onCancel={() => { generation.current++; setLoading(false); setOpen(false); }}>
      {loading ? <p role="status" className="mt-4 text-pretty text-sm">กำลังโหลดจำนวนเครื่องทุกสาขา...</p>
        : preview && <p className="mt-4 text-pretty text-sm tabular-nums">ทะเบียนรหัสเครื่องทั้งหมด รวมที่เลิกใช้แล้ว <strong>{preview.count.toLocaleString("th-TH")} รายการ</strong>{preview.count === 0 && " · ไม่มีรหัสที่ต้องรีเซ็ต"}</p>}
      {uncertain ? <p className="mt-3 text-pretty text-sm text-ink/70">กำลังตรวจคำสั่งเดิม การลองอีกครั้งจะไม่เริ่มรีเซ็ตรอบใหม่</p>
        : !!preview?.count && <label className="mt-4 grid gap-2 text-sm font-semibold">พิมพ์ “รีเซ็ตทั้งหมด” เพื่อยืนยัน
          <input value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={saving}
            autoComplete="off" className="focus-ring h-11 w-full rounded-md border border-black/20 px-3" />
        </label>}
      {error && <p role="alert" className="mt-3 text-pretty text-sm text-danger">{error}</p>}
      {!loading && !preview && <button type="button" onClick={() => { setError(""); void loadPreview(); }} className="focus-ring mt-3 min-h-11 rounded-md border border-black/15 px-3 text-sm">โหลดจำนวนอีกครั้ง</button>}
    </AlertDialog>
  </div>;
}
