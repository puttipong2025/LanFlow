"use client";
import { useEffect, useRef, useState } from "react";
import type { BonusChange } from "@/types/branch-bonus";
import { cn } from "@/lib/cn";
import { bonusNumber, secondaryButton } from "./bonus-display";

export function BonusChanges({ rows, total, fingerprint, load, saved = false }: {
  rows: BonusChange[]; total: number; fingerprint: string; saved?: boolean;
  load: (offset: number, signal?: AbortSignal) => Promise<{ rows: BonusChange[]; sourceFingerprint: string }>;
}) {
  const [extra, setExtra] = useState<{ fingerprint: string; rows: BonusChange[] }>({ fingerprint: "", rows: [] });
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null), current = useRef(fingerprint); current.current = fingerprint;
  const visible = [...rows, ...(extra.fingerprint === fingerprint ? extra.rows : [])];
  useEffect(() => {
    setLoading(false); setError(null);
    return () => { request.current?.abort(); request.current = null; };
  }, [fingerprint]);
  async function more() {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(null);
    try {
      const page = await load(visible.length, controller.signal);
      if (controller.signal.aborted || current.current !== fingerprint) return;
      if (page.sourceFingerprint !== fingerprint) throw new Error("ส่วนต่างเปลี่ยนแล้ว กรุณาคำนวณและตรวจยอดใหม่");
      if (!page.rows.length) throw new Error("โหลดส่วนต่างไม่ครบ กรุณาลองใหม่");
      setExtra({ fingerprint, rows: [...(extra.fingerprint === fingerprint ? extra.rows : []), ...page.rows] });
    } catch (caught) { if (!controller.signal.aborted && current.current === fingerprint) setError(caught instanceof Error ? caught.message : "โหลดส่วนต่างไม่ได้"); }
    finally { if (request.current === controller) { request.current = null; setLoading(false); } }
  }
  return <details className="rounded-lg border border-black/10 p-4">
    <summary className="focus-ring cursor-pointer font-semibold">ข้อมูลที่เปลี่ยนจากโบนัสเดิม <span className="tabular-nums">({total})</span></summary>
    <p className="mt-2 text-pretty text-sm text-ink/60">ใช้ประกอบการปรับยอดสุดท้ายเอง ข้อมูลส่วนนี้ไม่รวมในตัวชี้วัดของช่วงปัจจุบัน</p>
    <p className="mt-2 text-pretty text-sm text-ink/60">{saved ? "ส่วนต่างที่ตรวจพบขณะยืนยันผลนี้" : "เมื่อยืนยัน ถือว่าพิจารณาส่วนต่างที่ตรวจได้ทั้งหมดแล้ว รวมรายการหน้าถัดไป ครั้งหน้าจะแสดงเฉพาะการเปลี่ยนแปลงใหม่ ส่วนที่ตรวจไม่ได้ยังคงแจ้งเตือน"}</p>
    {visible.map(row => <div key={`${row.bonus_id}:${row.source_key}`} className="mt-3 border-t border-black/5 pt-3 text-sm">
      <p className="text-pretty break-words">{row.label}</p>
      <p className="text-pretty text-xs text-ink/60 tabular-nums">โบนัสเดิม {row.period_start} ถึง {row.period_end}</p>
      {row.old_date && row.new_date && row.old_date !== row.new_date && <p className="text-pretty text-xs text-ink/60 tabular-nums">วันที่รายการ {row.old_date} → {row.new_date}</p>}
      <p className="text-pretty tabular-nums">{row.unknown ? "ตรวจส่วนต่างไม่ได้ — ข้อมูลต้นทางถูกล้าง" : `${bonusNumber(row.old_amount ?? 0)} → ${bonusNumber(row.new_amount ?? 0)}`}</p>
      {row.old_included === false && <p className="text-pretty text-xs text-ink/60">ยกเว้นจากการคำนวณเดิม</p>}
    </div>)}
    {loading && <p role="status" className="mt-3 text-pretty text-sm">กำลังตรวจข้อมูล…</p>}
    {visible.length < total && <button type="button" disabled={loading} className={cn(secondaryButton,"mt-3")} onClick={() => void more()}>ดูส่วนต่างเพิ่ม</button>}
    {error && <p role="alert" className="mt-2 text-pretty text-sm text-clay">{error}</p>}
  </details>;
}
