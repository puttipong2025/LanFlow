"use client";

import { useEffect, useRef, useState } from "react";
import { ModalShell } from "@/components/shared/ModalShell";
import { AlertDialog } from "@/components/shared/AlertDialog";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";

export type BankCapture = { file: File; evidenceId: string; amount: number; confirmed: boolean };

export function BankBalanceCapture({ sessionId, slotId, label, value, onChange, onBusy, onOmit }: {
  sessionId: string; slotId: string; label: string; value: BankCapture | null; onChange: (value: BankCapture | null) => void;
  onBusy: (busy: boolean) => void;
  onOmit: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const request = useRef(0);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [omit, setOmit] = useState(false);
  useEffect(() => () => { request.current++; stream.current?.getTracks().forEach((track) => track.stop()); }, []);
  useEffect(() => {
    if (!camera) return;
    let active = true;
    if (!navigator.mediaDevices?.getUserMedia) { setError("อุปกรณ์นี้เปิดกล้องไม่ได้"); setCamera(false); return; }
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then((media) => {
      if (!active) { media.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      if (video.current) { video.current.srcObject = media; void video.current.play(); }
    }).catch(() => { setError("เปิดกล้องไม่ได้ กรุณาอนุญาตกล้องและลองใหม่"); setCamera(false); });
    return () => { active = false; stream.current?.getTracks().forEach((track) => track.stop()); };
  }, [camera]);
  useEffect(() => {
    if (!value) return;
    const url = URL.createObjectURL(value.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);
  async function capture() {
    if (!video.current || busy) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.current.videoWidth; canvas.height = video.current.videoHeight;
    if (!canvas.width || !canvas.height) return;
    canvas.getContext("2d")?.drawImage(video.current, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) return;
    const file = new File([blob], "bank-balance.jpg", { type: "image/jpeg" });
    const run = ++request.current;
    setCamera(false); onChange(null); setBusy(true); onBusy(true); setError(null);
    let readable = false;
    try {
      const form = new FormData(); form.set("image", file); form.set("sessionId", sessionId); form.set("slotId", slotId);
      const response = await authFetch("/api/lanflow/cash-counts/ocr", { method: "POST", body: form });
      await assertApiResponse(response);
      const result = await response.json();
      if (run === request.current) onChange({ file, evidenceId: result.evidenceId, amount: result.amount, confirmed: false });
      readable = true;
    } catch (cause) {
      if (run === request.current) setError(cause instanceof Error ? cause.message : "อ่านยอดไม่สำเร็จ กรุณาถ่ายใหม่");
    } finally {
      if (run === request.current) { setBusy(false); onBusy(!readable); }
    }
  }
  const button = "focus-ring min-h-11 rounded-md border border-black/15 bg-white px-3 text-sm font-semibold";
  return <section className="mt-4 space-y-3 rounded-lg border border-black/10 p-4">
    <h3 className="text-balance font-bold tabular-nums">{label} = {value ? `${value.amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท` : "ยังไม่อ่านยอด"}</h3>
    <p className="text-pretty text-sm text-ink/65">ถ่ายบัญชีเดียวให้เห็นยอดชัดเจน ยอดอ่านอย่างเดียว หากอ่านผิดให้ถ่ายใหม่</p>
    {value && <><div className="flex flex-wrap items-start gap-4">
      {/* Local camera blob only; never an external image URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {preview && <img src={preview} alt="รูปยอดบัญชีที่ถ่าย" className="max-h-64 max-w-full rounded-md object-contain" />}
    </div><label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={value.confirmed} onChange={(event) => onChange({ ...value, confirmed: event.target.checked })} />ยอดตรงกับรูป</label></>}
    <div className="flex flex-wrap gap-2"><button className={button} type="button" disabled={busy} onClick={() => { setCamera(true); onBusy(true); }}>{busy ? "กำลังอ่านยอด…" : value || error ? "ถ่ายใหม่" : "ถ่ายยอดบัญชี"}</button>
      {(value || error) && <button className={button} type="button" disabled={busy} onClick={() => setOmit(true)}>ไม่นำเงินในบัญชีมารวม</button>}</div>
    {error && <p role="alert" className="text-pretty text-sm text-clay">{error}</p>}
    {camera && <ModalShell title="ถ่ายยอดบัญชี" onClose={() => { setCamera(false); onBusy(Boolean(error)); }}><video ref={video} playsInline muted className="w-full rounded-md" /><button type="button" className={button} onClick={() => void capture()}>ถ่ายรูป</button></ModalShell>}
    <AlertDialog open={omit} title="ไม่นำเงินในบัญชีมารวม?" description="นำช่องนี้ออกจากยอดรวมของการนับครั้งนี้" confirmLabel="ยืนยันไม่รวมบัญชี" onCancel={() => setOmit(false)} onConfirm={onOmit} />
  </section>;
}
