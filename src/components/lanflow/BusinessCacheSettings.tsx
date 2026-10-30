"use client";

import { useEffect, useId, useRef, useState } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { ModalShell } from "@/components/shared/ModalShell";
import { NumberField } from "@/components/shared/NumberField";
import { authFetch, assertApiResponse } from "@/lib/auth-fetch";
import { businessCacheSettingsKey, isBusinessCacheSettings, isCacheInterval,
  type BusinessCacheSettings as Settings } from "@/lib/business-cache/settings";

export function BusinessCacheSettings({ owner, canEdit, online }: { owner: string; canEdit: boolean; online: boolean }) {
  const { data } = useQuery<Settings>({ queryKey: businessCacheSettingsKey(owner), queryFn: skipToken });
  const [open, setOpen] = useState(false);
  return <>
    {canEdit && <button type="button" onClick={() => setOpen(true)} className="focus-ring min-h-11 rounded-md border border-mint px-3 font-semibold">ตั้งรอบตรวจแคช</button>}
    <p className="order-last w-full text-pretty tabular-nums">รอบตรวจเวอร์ชันแคช: {data ? data.intervalMinutes === null ? "ปิด" : `ทุก ${data.intervalMinutes} นาที` : "ยังไม่ได้อ่านค่ากลาง"}</p>
    {open && <CacheSettingsModal owner={owner} online={online} onClose={() => setOpen(false)} />}
  </>;
}

function CacheSettingsModal({ owner, online, onClose }: { owner: string; online: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const [loaded, setLoaded] = useState<Settings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [minutes, setMinutes] = useState(10);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const helpId = useId();
  useEffect(() => {
    if (!online || loaded) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await authFetch("/api/lanflow/business-cache/settings", {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        await assertApiResponse(response);
        const data: unknown = await response.json();
        if (!isBusinessCacheSettings(data)) throw new Error("รูปแบบรอบตรวจแคชไม่ถูกต้อง");
        if (!controller.signal.aborted) {
          setLoaded(data); setEnabled(data.intervalMinutes !== null); setMinutes(data.intervalMinutes ?? 10);
          setError(""); client.setQueryData<Settings>(businessCacheSettingsKey(owner), current =>
            current && current.revision > data.revision ? current : data);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "โหลดรอบตรวจไม่สำเร็จ");
      }
    })();
    return () => controller.abort();
  }, [client, loaded, online, owner]);

  async function save(form: HTMLFormElement) {
    if (!loaded || !online || lock.current) return;
    // Read the displayed value: NumberField keeps a blank edit separate from
    // its last numeric value, including when Enter submits before blur.
    const intervalMinutes = enabled ? form.querySelector<HTMLInputElement>('input[type="number"]')?.valueAsNumber : null;
    if (!isCacheInterval(intervalMinutes)) { setError("กรุณากรอกจำนวนเต็ม 10–120 นาที"); return; }
    lock.current = true; setSaving(true); setError("");
    try {
      const response = await authFetch("/api/lanflow/business-cache/settings", { method: "PUT",
        signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervalMinutes, expectedRevision: loaded.revision }) });
      await assertApiResponse(response);
      const data: unknown = await response.json();
      if (!isBusinessCacheSettings(data) || data.intervalMinutes !== intervalMinutes) throw new Error("ยังยืนยันผลบันทึกไม่ได้ กรุณาเปิดตรวจค่าล่าสุดอีกครั้ง");
      client.setQueryData<Settings>(businessCacheSettingsKey(owner), current =>
        current && current.revision > data.revision ? current : data); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "บันทึกไม่สำเร็จ"); }
    finally { lock.current = false; setSaving(false); }
  }
  return <ModalShell title="ตั้งรอบตรวจเวอร์ชันแคช" subtitle="ค่ากลางสำหรับทุกเครื่อง · เฉพาะ superadmin" size="compact"
    nativeModal renderInPortal closeOnEscape closeDisabled={saving} onClose={onClose}>
    <form className="space-y-4 tabular-nums" noValidate onSubmit={event => { event.preventDefault(); void save(event.currentTarget); }}>
      <p className="text-pretty text-sm text-ink/70">ตรวจบิลยางและรับ–จ่ายเฉพาะเมื่อออนไลน์และเปิดแท็บใช้งานอยู่ การเปิดหน้าและกลับมาออนไลน์ยังตรวจตามเดิม</p>
      {!loaded && online && !error && <p role="status">กำลังอ่านค่ากลาง…</p>}
      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={enabled}
        disabled={!loaded || saving || !online} onChange={event => { setEnabled(event.target.checked); setError(""); }} />เปิดตรวจตามรอบ</label>
      <NumberField label="รอบตรวจ (นาที)" value={minutes} onChange={value => { setMinutes(value); setError(""); }}
        readOnly={!enabled || !loaded || saving || !online} min={10} max={120} step={1} ariaDescribedBy={helpId}
        ariaInvalid={enabled && !isCacheInterval(minutes)} />
      <p id={helpId} className="text-pretty text-xs text-ink/60">กำหนดจำนวนเต็ม 10–120 นาที เครื่องอื่นรับค่าเมื่อเปิดหน้า กลับมาออนไลน์ หรือถึงรอบตรวจเดิม</p>
      {!online && <p role="status" className="text-pretty text-sm">ต้องออนไลน์เพื่ออ่านและบันทึกค่ากลาง</p>}
      {error && <p role="alert" className="text-pretty text-sm text-rose-700">{error}</p>}
      <button type="submit" disabled={!loaded || saving || !online} className="focus-ring min-h-11 rounded-md bg-commit px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "กำลังบันทึก…" : "บันทึกค่ากลาง"}</button>
    </form>
  </ModalShell>;
}
