"use client";

import { useRef, useState } from "react";
import { ModalShell } from "@/components/shared/ModalShell";
import { authFetch } from "@/lib/auth-fetch";
import type { BrowserApprovalUser } from "@/hooks/useBrowserApprovals";

function time(value: string) {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value));
}
export function BrowserApprovalActions({ user, onChanged }: { user: BrowserApprovalUser; onChanged: () => unknown }) {
  const [confirmation, setConfirmation] = useState<{ action: "cancel" | "revoke"; id?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function act(action: "approve" | "cancel" | "revoke", id?: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await authFetch("/api/lanflow/admin/browser-approvals", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: user.userId, action, id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "ดำเนินการไม่สำเร็จ");
      setConfirmation(null); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ดำเนินการไม่สำเร็จ"); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="mt-3 grid min-w-56 gap-2">
    {user.pending.length > 0 && <span className="text-sm font-semibold tabular-nums text-leaf">รออนุมัติ {user.pending.length}</span>}
    {user.pending.map(request => <div key={request.id} className="grid gap-2 rounded-md border border-mint p-2">
      <p className="text-pretty text-xs text-ink/60">{request.label} · {time(request.requestedAt)}</p>
      <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void act("approve", request.id)} className="focus-ring h-10 rounded-md bg-leaf px-3 text-sm font-semibold text-white disabled:opacity-50">อนุมัติ</button>
        <button type="button" disabled={busy} onClick={() => { setError(""); setConfirmation({ action: "cancel", id: request.id }); }} className="focus-ring h-10 rounded-md border border-black/15 px-3 text-sm disabled:opacity-50">ยกเลิกคำขอ</button></div>
    </div>)}
    <p className="text-pretty text-xs text-ink/60">{user.lastApprovedAt ? `อนุมัติล่าสุด: ${user.lastApprovedBy ?? "ผู้ดูแลเดิม"} · ${time(user.lastApprovedAt)}` : "ยังไม่มีการอนุมัติ"}</p>
    {user.required && <button type="button" disabled={busy} onClick={() => { setError(""); setConfirmation({ action: "revoke" }); }} className="focus-ring h-10 rounded-md border border-black/15 px-3 text-sm disabled:opacity-50">ถอนอนุมัติทั้งหมด</button>}
    {error && !confirmation && <p role="alert" className="text-pretty text-sm text-danger">{error}</p>}
    {confirmation && <ModalShell title={confirmation.action === "revoke" ? "ถอนอนุมัติทั้งหมด?" : "ยกเลิกคำขอ?"} nativeModal renderInPortal role="alertdialog" closeDisabled={busy} onClose={() => setConfirmation(null)}>
      <p className="mb-4 text-pretty text-sm">{confirmation.action === "revoke" ? "ทุกเบราว์เซอร์ต้องเข้าสู่ระบบและขออนุมัติใหม่ งานค้างยังอยู่" : "ผู้ใช้ต้องกดขออนุมัติอีกครั้งเอง"}</p>
      <button type="button" disabled={busy} onClick={() => void act(confirmation.action, confirmation.id)} className="focus-ring h-10 rounded-md bg-leaf px-4 text-white disabled:opacity-50">ยืนยัน</button>
      {error && <p role="alert" className="mt-3 text-pretty text-sm text-danger">{error}</p>}
    </ModalShell>}
  </div>;
}
