"use client";

import { useRef, useState } from "react";
import { ModalShell } from "@/components/shared/ModalShell";
import { authFetch } from "@/lib/auth-fetch";
import type { Profile } from "@/types";

export function AccountSecurityControls({ user, actorId, mode = "phone" }: { user: Profile; actorId: string; mode?: "phone" | "sms" }) {
  const [required, setRequired] = useState(user.smsRequired === true);
  const [phone, setPhone] = useState(user.phone);
  const [editing, setEditing] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmSms, setConfirmSms] = useState(false);
  const lock = useRef(false);

  async function save(kind: "sms" | "phone") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await authFetch(`/api/lanflow/admin/users/${user.id}/${kind}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "sms" ? { required: !required } : { phone: newPhone, currentPassword: password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "บันทึกไม่สำเร็จ");
      if (kind === "sms") { setRequired(data.smsRequired); setConfirmSms(false); }
      else { setPhone(data.phone); setEditing(false); setPassword(""); }
      setMessage("บันทึกแล้ว งานค้างในเครื่องของพนักงานจะถูกเก็บไว้");
      if (kind === "phone" && user.id === actorId) window.location.assign("/login");
    } catch (error) { setMessage(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ"); }
    finally { lock.current = false; setBusy(false); }
  }

  return <section className="space-y-3 border-t border-black/10 pt-4">
    {mode === "phone" && <div className="flex flex-wrap items-center gap-3">
      <p className="text-pretty text-sm text-ink/60">เบอร์โทร: <span className="tabular-nums">{phone}</span></p>
      <button type="button" disabled={busy} onClick={() => { setNewPhone(phone); setMessage(""); setEditing(true); }} className="focus-ring h-10 rounded-lg border border-river/25 px-3 text-sm font-semibold text-river disabled:opacity-50">เปลี่ยนเบอร์โทร</button>
    </div>}
    {mode === "sms" && user.role !== "super_admin" && <label className="flex items-center gap-2 text-sm font-semibold">
      <input type="checkbox" checked={required} disabled={busy} onChange={() => { setMessage(""); setConfirmSms(true); }} />ยืนยัน SMS เพิ่มอีกขั้น
    </label>}
    {message && <p role="status" className="text-pretty text-sm text-ink">{message}</p>}
    {confirmSms && <ModalShell title={required ? "ปิดการยืนยัน SMS?" : "เปิดการยืนยัน SMS?"} nativeModal renderInPortal role="alertdialog" closeDisabled={busy} onClose={() => setConfirmSms(false)}>
      <p className="mb-4 text-pretty text-sm">{required ? "ครั้งถัดไปใช้เบอร์โทรและรหัสผ่านเดิม ไม่บังคับออกจากระบบ" : "เซสชันเดิมทุกเครื่องจะใช้ต่อไม่ได้ ต้องเข้าสู่ระบบและยืนยัน SMS ใหม่ งานค้างยังอยู่"}</p>
      <button type="button" disabled={busy} onClick={() => void save("sms")} className="focus-ring h-10 rounded-lg bg-river px-4 font-semibold text-white disabled:opacity-50">ยืนยัน</button>
      {message && <p role="alert" className="mt-3 text-pretty text-sm">{message}</p>}
    </ModalShell>}
    {editing && <ModalShell title="เปลี่ยนเบอร์โทร" nativeModal renderInPortal role="alertdialog" closeDisabled={busy} onClose={() => { setEditing(false); setPassword(""); }}>
      <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void save("phone"); }}>
        <p className="text-pretty text-sm text-ink/60">ไม่ส่ง OTP ตอนเปลี่ยน บัญชีนี้ต้องเข้าสู่ระบบใหม่ทุกเครื่องด้วยเบอร์ใหม่และรหัสผ่านเดิม</p>
        <label className="grid gap-2 text-sm font-semibold">เบอร์โทรใหม่<input type="tel" autoComplete="tel" value={newPhone} onChange={(event) => setNewPhone(event.target.value)} required className="focus-ring h-10 rounded-lg border border-black/15 px-3 tabular-nums" /></label>
        {user.id === actorId && <label className="grid gap-2 text-sm font-semibold">รหัสผ่านปัจจุบัน<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required className="focus-ring h-10 rounded-lg border border-black/15 px-3" /></label>}
        <button disabled={busy} className="focus-ring h-10 rounded-lg bg-river px-4 font-semibold text-white disabled:opacity-50">{busy ? "กำลังบันทึก..." : "ยืนยันเปลี่ยนเบอร์"}</button>
        {message && <p role="alert" className="text-pretty text-sm">{message}</p>}
      </form>
    </ModalShell>}
  </section>;
}
