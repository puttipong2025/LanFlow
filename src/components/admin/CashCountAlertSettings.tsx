"use client";
import { useEffect, useState } from "react";
import { useLocations } from "@/hooks/useLocations";
import { authFetch, assertApiResponse } from "@/lib/auth-fetch";
import { AlertDialog } from "@/components/shared/AlertDialog";

type Group = { id: string; dueDays: number; locationIds: string[]; lockEnabled?: boolean; graceHours?: number | null; unlockHours?: number | null; discrepancyThreshold?: number | null };
export function CashCountAlertSettings() {
  const { locations } = useLocations();
  const [data, setData] = useState<{ groups: Group[]; availableLocationIds: string[] } | null>(null);
  const [editing, setEditing] = useState<Group | null>(null);
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(1);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [graceHours, setGraceHours] = useState("");
  const [unlockHours, setUnlockHours] = useState("");
  const [discrepancyThreshold, setDiscrepancyThreshold] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Group | null>(null);
  const endpoint = "/api/lanflow/cash-count-alert/groups";
  async function load() {
    const response = await authFetch(endpoint, { cache: "no-store" });
    await assertApiResponse(response); setData(await response.json());
  }
  useEffect(() => { let active = true; void authFetch(endpoint, { cache: "no-store" }).then(async (response) => {
    await assertApiResponse(response); const body = await response.json(); if (active) setData(body);
  }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "โหลดกลุ่มไม่สำเร็จ"); }); return () => { active = false; }; }, []);
  const button = "focus-ring min-h-11 rounded-md border border-black/15 bg-white px-3 text-sm font-semibold disabled:opacity-50";
  function edit(group: Group | null) { setEditing(group); setDays(group?.dueDays ?? 1); setIds(group?.locationIds ?? []); setLockEnabled(group?.lockEnabled ?? false); setGraceHours(String(group?.graceHours ?? "")); setUnlockHours(String(group?.unlockHours ?? "")); setDiscrepancyThreshold(String(group?.discrepancyThreshold ?? "")); setOpen(true); setError(null); }
  async function save(remove = false) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await authFetch(remove ? `${endpoint}?id=${deleting?.id}` : endpoint, {
        method: remove ? "DELETE" : "POST", headers: { "Content-Type": "application/json" },
        ...(remove ? {} : { body: JSON.stringify({ id: editing?.id, dueDays: days, locationIds: ids, lockEnabled, discrepancyThreshold: discrepancyThreshold === "" ? null : Number(discrepancyThreshold),
          ...(lockEnabled && graceHours ? { graceHours: Number(graceHours) } : {}), ...(lockEnabled && unlockHours ? { unlockHours: Number(unlockHours) } : {}) }) }),
      });
      await assertApiResponse(response); setOpen(false); setDeleting(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "บันทึกกลุ่มไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-md border border-black/10 bg-white p-4">
    <h3 className="text-balance text-lg font-bold">กลุ่มเกณฑ์นับเงิน</h3>
    <p className="text-pretty text-sm text-ink/65">กำหนด 1–5 วันปฏิทินไทย สาขานอกกลุ่มไม่แจ้งเตือน ใช้รอบตรวจร่วมกับเงินและน้ำหนัก</p>
    {error && <p role="alert" className="text-pretty text-sm text-clay">{error}</p>}
    {!data ? <button type="button" className={button} onClick={() => void load().catch((cause) => setError(String(cause)))}>โหลดกลุ่ม</button> : <>
      {!open && <button type="button" className={button} onClick={() => edit(null)}>สร้างกลุ่ม</button>}
      {open && <form className="space-y-3 rounded-md bg-field p-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label className="grid gap-1 text-sm font-semibold">กำหนดนับเงิน (วัน)<input type="number" min={1} max={5} step={1} required value={days} disabled={busy} onChange={(event) => setDays(Number(event.target.value))} className="focus-ring min-h-11 rounded-md border px-3 tabular-nums" /></label>
        <label className="grid gap-1 text-sm font-semibold">แจ้งเตือนเมื่อขาดหรือเกินมากกว่า (บาท)<input type="number" min={0} max={9999999999.99} step="0.01" value={discrepancyThreshold} disabled={busy} onChange={(event) => setDiscrepancyThreshold(event.target.value)} className="focus-ring min-h-11 rounded-md border px-3 tabular-nums" /><span className="text-pretty font-normal text-ink/65">เว้นว่างเพื่อปิด · 0 บาทแจ้งทุกส่วนต่างที่ไม่เป็นศูนย์ ไม่ทำให้สาขาถูกล็อก</span></label>
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" className="size-5 accent-leaf" checked={lockEnabled} disabled={busy} onChange={(event) => setLockEnabled(event.target.checked)} />ล็อกเมื่อเกินกำหนดนับเงิน</label>
        {lockEnabled && <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold">ผ่อนผันก่อนล็อก (ชั่วโมง)<input type="number" min={1} max={48} step={1} required value={graceHours} disabled={busy} onChange={(event) => setGraceHours(event.target.value)} className="focus-ring min-h-11 rounded-md border px-3 tabular-nums" /></label>
          <label className="grid gap-1 text-sm font-semibold">ใช้งานหลังปลดล็อก (ชั่วโมง)<input type="number" min={1} max={48} step={1} required value={unlockHours} disabled={busy} onChange={(event) => setUnlockHours(event.target.value)} className="focus-ring min-h-11 rounded-md border px-3 tabular-nums" /></label>
          <p className="text-pretty text-sm text-ink/65 sm:col-span-2">ผ่อนผันเริ่มเที่ยงคืนไทยหลังวันครบกำหนด แก้ผ่อนผันมีผลทันที ระยะหลังปลดล็อกใช้กับครั้งถัดไป ทุกคนในสาขาใช้ช่วงเวลาร่วมกัน</p>
        </div>}
        <fieldset disabled={busy}><legend className="text-sm font-semibold">สาขาในกลุ่ม</legend><div className="grid gap-2 sm:grid-cols-2">{locations.filter((l) => data.availableLocationIds.includes(l.id) || editing?.locationIds.includes(l.id)).map((l) =>
          <label key={l.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={ids.includes(l.id)} onChange={() => setIds((current) => current.includes(l.id) ? current.filter((id) => id !== l.id) : [...current, l.id])} />{l.name}</label>)}</div></fieldset>
        <div className="flex gap-2"><button className={button} disabled={busy || !ids.length} type="submit">บันทึกกลุ่ม</button><button className={button} disabled={busy} type="button" onClick={() => setOpen(false)}>ยกเลิก</button></div>
      </form>}
      {data.groups.length === 0 && <p className="text-pretty text-sm">ยังไม่มีกลุ่ม กดสร้างกลุ่มเพื่อเลือกสาขา</p>}
      {data.groups.map((group, index) => <section key={group.id} className="space-y-2 rounded-md border border-black/10 p-3"><h4 className="text-balance font-semibold">กลุ่ม {index + 1} · ทุก {group.dueDays} วัน</h4><p className="text-pretty text-sm">{group.locationIds.map((id) => locations.find((l) => l.id === id)?.name ?? id).join(" · ")}</p><p className="text-pretty text-sm text-ink/65">{group.lockEnabled ? `เปิดล็อก · ผ่อนผัน ${group.graceHours} ชม. · ปลดชั่วคราว ${group.unlockHours} ชม.` : "ปิดการล็อก · แจ้งเตือนตามเดิม"}</p><div className="flex gap-2"><button type="button" className={button} disabled={busy} onClick={() => edit(group)}>แก้ไข</button><button type="button" className={button} disabled={busy} onClick={() => setDeleting(group)}>ลบกลุ่ม</button></div></section>)}
    </>}
    <AlertDialog open={!!deleting} title="ลบกลุ่มเกณฑ์นับเงิน?" description="สาขาในกลุ่มนี้จะหยุดรับแจ้งเตือนนับเงิน" confirmLabel="ลบกลุ่ม" busy={busy} onCancel={() => setDeleting(null)} onConfirm={() => void save(true)} />
  </section>;
}
