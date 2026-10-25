"use client";

import { useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { useAuthContext } from "@/components/AuthProvider";

export function SmsLoginVerification() {
  const { refreshProfile, logout } = useAuthContext();
  const [challengeId, setChallengeId] = useState(() => typeof window !== "undefined" ? sessionStorage.getItem("lanflow:sms-challenge") ?? "" : "");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const lock = useRef(false);

  async function submit(action: "send" | "verify") {
    if (lock.current) return;
    if (action === "send" && Date.now() < retryAt) {
      setMessage(`กรุณารออีก ${Math.ceil((retryAt - Date.now()) / 1000)} วินาทีก่อนส่งซ้ำ`);
      return;
    }
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await authFetch("/api/auth/sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, challengeId, code }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "ยืนยันไม่สำเร็จ กรุณาลองใหม่");
      if (action === "send") {
        setChallengeId(data.challengeId);
        sessionStorage.setItem("lanflow:sms-challenge", data.challengeId);
        setCode("");
        setRetryAt(Date.now() + data.retryAfter * 1000);
        setMessage("ส่งรหัสแล้ว ใช้ได้ภายใน 5 นาที ขอส่งซ้ำได้หลัง 60 วินาที");
      } else {
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
    <button type="button" disabled={busy} onClick={() => void submit("send")} className="focus-ring h-10 rounded-lg border border-river/25 px-3 text-sm font-semibold text-river disabled:opacity-50">{challengeId ? "ส่งรหัสอีกครั้ง" : "รับรหัส SMS"}</button>
    <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void submit("verify"); }}>
      <label className="grid gap-2 text-sm font-semibold">รหัส SMS 6 หลัก
        <input autoFocus autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} required className="focus-ring h-12 rounded-lg border border-black/15 px-3 text-lg tabular-nums" />
      </label>
      <button disabled={busy || !challengeId} className="focus-ring h-10 rounded-lg bg-river px-3 font-semibold text-white disabled:opacity-50">{busy ? "กำลังดำเนินการ..." : "ยืนยันรหัส"}</button>
    </form>
    {message && <p role="status" className="text-pretty text-sm text-ink">{message}</p>}
    <button type="button" disabled={busy} onClick={() => void logout()} className="focus-ring h-10 rounded-lg border border-black/15 px-3 text-sm">กลับไปเข้าสู่ระบบ</button>
  </main>;
}
