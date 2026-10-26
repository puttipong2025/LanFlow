"use client";

import { useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { useAuthContext } from "@/components/AuthProvider";

export function SmsLoginVerification() {
  const { refreshProfile, logout } = useAuthContext();
  const [challengeId, setChallengeId] = useState(() => typeof window !== "undefined" ? sessionStorage.getItem("lanflow:sms-challenge") ?? "" : "");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [verificationAccepted, setVerificationAccepted] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [usage, setUsage] = useState<{ sentCount: number; sendLimit: number; resetAt?: string } | null>(null);
  const lock = useRef(false);
  const hasSubmitted = useRef(false);

  useEffect(() => {
    let active = true;
    void authFetch("/api/auth/sms", { cache: "no-store" }).then(async response => {
      if (!response.ok) return;
      const data = await response.json();
      if (!active || hasSubmitted.current) return;
      setUsage(data);
      if (data.resendAt) setRetryAt(Date.parse(data.resendAt));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const resetAt = usage?.resetAt;
    if (!resetAt) return;
    const timer = setTimeout(() => {
      setUsage(current => current?.resetAt === resetAt ? { ...current, sentCount: 0, resetAt: undefined } : current);
    }, Math.max(0, Date.parse(resetAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [usage?.resetAt]);

  useEffect(() => {
    const update = () => {
      setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    };
    update();
    if (retryAt <= Date.now()) return;
    const timer = setInterval(() => {
      update();
      if (Date.now() >= retryAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  async function submit(action: "send" | "verify") {
    if (lock.current) return;
    if (action === "send" && Date.now() < retryAt) {
      setMessage(`กรุณารออีก ${Math.ceil((retryAt - Date.now()) / 1000)} วินาทีก่อนส่งซ้ำ`);
      return;
    }
    lock.current = true;
    hasSubmitted.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (action === "verify" && verificationAccepted) {
        if (!await refreshProfile()) throw new Error("กรุณาลองตรวจสถานะอีกครั้ง");
        window.location.assign("/");
        return;
      }
      const response = await authFetch("/api/auth/sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, challengeId, code }) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 429 && typeof data.retryAfter === "number") setRetryAt(Date.now() + data.retryAfter * 1000);
        if (["account", "cooldown"].includes(data.quota?.scope)) setUsage(current => ({ sentCount: data.quota.count, sendLimit: data.quota.limit, resetAt: data.quota.scope === "account" ? data.availableAt : current?.resetAt }));
        throw new Error(data.error || "ยืนยันไม่สำเร็จ กรุณาลองใหม่");
      }
      if (action === "send") {
        setUsage(data);
        setChallengeId(data.challengeId);
        sessionStorage.setItem("lanflow:sms-challenge", data.challengeId);
        setCode("");
        const quotaFull = data.sentCount >= data.sendLimit;
        setRetryAt(Math.max(Date.now() + data.retryAfter * 1000, quotaFull && data.resetAt ? Date.parse(data.resetAt) : 0));
        setMessage(quotaFull ? "ส่งรหัสแล้ว ใช้ได้ภายใน 5 นาที ใช้โควตาบัญชีครบแล้ว ดูเวลาขอได้อีกครั้งด้านบน" : `ส่งรหัสแล้ว ใช้ได้ภายใน 5 นาที ขอส่งซ้ำได้หลัง ${data.retryAfter} วินาที`);
      } else {
        setVerificationAccepted(true);
        sessionStorage.removeItem("lanflow:sms-challenge");
        if (!await refreshProfile()) throw new Error("กรุณาลองตรวจสถานะอีกครั้ง");
        window.location.assign("/");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "เชื่อมต่อไม่สำเร็จ"); }
    finally { lock.current = false; setBusy(false); }
  }

  return <main className="mx-auto grid min-h-dvh max-w-md content-center gap-5 p-6">
    <h1 className="text-balance text-2xl font-bold text-ink">ยืนยันการเข้าสู่ระบบ</h1>
    <p className="text-pretty text-sm text-ink/60">รับรหัส SMS ที่เบอร์ในบัญชีของคุณ งานที่ยังไม่ส่งยังเก็บไว้ในเครื่อง</p>
    {usage && <p className="text-sm tabular-nums text-ink/60">ขอรหัสแล้ว {usage.sentCount}/{usage.sendLimit} ครั้งในรอบ 30 นาทีนี้</p>}
    {remaining > 0 && <p className="text-pretty text-sm tabular-nums text-ink/60">ขอได้อีกครั้ง {new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(retryAt))} · อีก {Math.floor(remaining / 60)} นาที {remaining % 60} วินาที</p>}
    <button type="button" disabled={busy || verificationAccepted || remaining > 0} onClick={() => void submit("send")} className="focus-ring h-10 rounded-lg border border-river/25 px-3 text-sm font-semibold text-river disabled:opacity-50">{challengeId ? "ส่งรหัสอีกครั้ง" : "รับรหัส SMS"}</button>
    <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void submit("verify"); }}>
      <label className="grid gap-2 text-sm font-semibold">รหัส SMS 6 หลัก
        <input autoFocus autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} disabled={busy || verificationAccepted} required className="focus-ring h-12 rounded-lg border border-black/15 px-3 text-lg tabular-nums" />
      </label>
      <button disabled={busy || (!challengeId && !verificationAccepted)} className="focus-ring h-10 rounded-lg bg-river px-3 font-semibold text-white disabled:opacity-50">{busy ? "กำลังดำเนินการ..." : verificationAccepted ? "ตรวจสถานะอีกครั้ง" : "ยืนยันรหัส"}</button>
    </form>
    {message && <p role="status" className="text-pretty text-sm text-ink">{message}</p>}
    <button type="button" disabled={busy} onClick={() => void logout()} className="focus-ring h-10 rounded-lg border border-black/15 px-3 text-sm">กลับไปเข้าสู่ระบบ</button>
  </main>;
}
