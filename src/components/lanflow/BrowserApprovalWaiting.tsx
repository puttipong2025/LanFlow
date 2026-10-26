"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthContext } from "@/components/AuthProvider";
import { bootstrapBrowserApproval } from "@/lib/browser-bootstrap";

export function BrowserApprovalWaiting() {
  const { refreshProfile, logout } = useAuthContext();
  const [status, setStatus] = useState("PENDING");
  const [remaining, setRemaining] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const check = useCallback(async (resubmit = false) => {
    if (lock.current || !navigator.onLine) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = resubmit ? await bootstrapBrowserApproval("resubmit") : await fetch("/api/auth/browser", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(10_000) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setStatus("SESSION_REVOKED");
        throw new Error(data.error || "ตรวจสถานะไม่สำเร็จ กรุณาลองใหม่");
      }
      setStatus(data.status);
      if (data.status === "READY") {
        if (!await refreshProfile()) throw new Error("อนุมัติแล้ว แต่โหลดบัญชีไม่สำเร็จ กรุณาตรวจสถานะอีกครั้ง");
        window.location.assign("/");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "เชื่อมต่อไม่สำเร็จ"); }
    finally { lock.current = false; setBusy(false); setRemaining(10); }
  }, [refreshProfile]);

  useEffect(() => {
    void check();
    const reconnect = () => { void check(); };
    window.addEventListener("online", reconnect);
    const timer = setInterval(() => {
      if (!navigator.onLine || document.hidden || lock.current) return;
      setRemaining(value => Math.max(0, value - 1));
    }, 1000);
    return () => { clearInterval(timer); window.removeEventListener("online", reconnect); };
  }, [check]);
  useEffect(() => { if (remaining === 0) void check(); }, [remaining, check]);

  const cancelled = ["CANCELLED", "REVOKED", "MISSING"].includes(status);
  const signedOut = ["SESSION_REVOKED", "SIGNED_OUT", "PASSWORD_REQUIRED"].includes(status);
  return <main className="mx-auto grid min-h-dvh max-w-md content-center gap-5 p-6">
    <h1 className="text-balance text-2xl font-bold text-ink">รออนุมัติเบราว์เซอร์</h1>
    <p className="text-pretty text-sm text-ink/60">ให้ผู้ดูแลอนุมัติจากหน้าจัดการพนักงาน เมื่ออนุมัติแล้วเบราว์เซอร์นี้จะใช้งานต่อได้ งานค้างยังอยู่ในเครื่อง</p>
    <p role="status" className="text-pretty text-sm tabular-nums">{signedOut ? "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" : cancelled ? "คำขอยังไม่ได้รับอนุมัติ กดขออนุมัติอีกครั้งเมื่อต้องการ" : `ตรวจสถานะอีกครั้งใน ${remaining} วินาที`}</p>
    {!signedOut && <button type="button" disabled={busy} onClick={() => void check(cancelled)} className="focus-ring h-10 rounded-lg bg-leaf px-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "กำลังตรวจสถานะ..." : cancelled ? "ขออนุมัติอีกครั้ง" : "ตรวจสถานะอีกครั้ง"}</button>}
    {error && <p role="alert" className="text-pretty text-sm text-danger">{error}</p>}
    <button type="button" disabled={busy} onClick={() => void logout()} className="focus-ring h-10 rounded-lg border border-black/15 px-3 text-sm">กลับไปเข้าสู่ระบบ</button>
  </main>;
}
