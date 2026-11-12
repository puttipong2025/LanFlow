"use client";
import { useEffect, useRef, useState } from "react";
import type { BonusPreview, BonusSettings, BonusSource, BonusSourceSection } from "@/types/branch-bonus";
import { bonusNumber, costLabels, secondaryButton } from "./bonus-display";

export function BonusSources({ preview, input, change, load, saved = false }: {
  preview: BonusPreview; input: BonusSettings; change?: (next: BonusSettings) => void; saved?: boolean;
  load: (section: BonusSourceSection, offset: number, signal?: AbortSignal) => Promise<{ rows: BonusSource[]; sourceFingerprint: string }>;
}) {
  const [extra, setExtra] = useState<{ fingerprint: string; rows: Partial<Record<BonusSourceSection, BonusSource[]>> }>({ fingerprint: "", rows: {} });
  const [busy, setBusy] = useState<BonusSourceSection | null>(null), [error, setError] = useState<string | null>(null);
  const [expensesOpen,setExpensesOpen] = useState(false), [expenseLimit,setExpenseLimit] = useState(50);
  const request = useRef<AbortController|null>(null), current = useRef(preview.sourceFingerprint); current.current = preview.sourceFingerprint;
  const extraRows = extra.fingerprint === preview.sourceFingerprint ? extra.rows : {};
  const groups = Object.entries(costLabels);
  useEffect(()=>{
    setBusy(null);setError(null);
    return()=>{request.current?.abort();request.current=null;};
  },[preview.sourceFingerprint]);
  useEffect(()=>{
    if(expensesOpen && preview.expenses.length + (extraRows.expenses?.length ?? 0) < preview.sourceCounts.expenses) void more("expenses");
    // Reload all pages when a changed calculation replaces the open expense list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[expensesOpen,preview.sourceFingerprint]);
  function toggleGroup(kind: string) {
    change?.({ ...input, excludedGroups: input.excludedGroups.includes(kind) ? input.excludedGroups.filter(k => k !== kind) : [...input.excludedGroups, kind] });
  }
  function toggleSource(key: string) {
    change?.({ ...input, excludedKeys: input.excludedKeys.includes(key) ? input.excludedKeys.filter(k => k !== key) : [...input.excludedKeys, key] });
  }
  async function more(section: BonusSourceSection) {
    if (request.current) return;
    const controller=new AbortController();request.current=controller;setBusy(section);setError(null);
    const fingerprint = preview.sourceFingerprint;
    try {
      const loaded = [...(extraRows[section] ?? [])];
      do {
        const result = await load(section, preview[section].length + loaded.length, controller.signal);
        if (controller.signal.aborted || current.current !== fingerprint) return;
        if (result.sourceFingerprint !== fingerprint) throw new Error("ข้อมูลเปลี่ยนแล้ว กรุณาคำนวณใหม่ก่อนตรวจรายการต่อ");
        if (!result.rows.length) throw new Error("โหลดรายการไม่ครบ กรุณาลองใหม่");
        loaded.push(...result.rows);
        setExtra({ fingerprint, rows: { ...extraRows, [section]: [...loaded] } });
      } while (section === "expenses" && preview[section].length + loaded.length < preview.sourceCounts[section]);
    } catch (caught) { if(!controller.signal.aborted&&current.current===fingerprint)setError(caught instanceof Error ? caught.message : "โหลดรายละเอียดไม่สำเร็จ"); }
    finally { if(request.current===controller){request.current=null;setBusy(null);} }
  }
  return <div className="space-y-4">
    <p className="text-pretty text-sm text-ink/60">{preview.overlap ? "ช่วงนี้ซ้อนกับผลโบนัสเดิม แสดงข้อมูลในช่วงสำหรับทดลองเท่านั้น ยืนยันซ้ำไม่ได้" : "รายการที่เคยพิจารณาในโบนัสแล้วไม่รวมยอดทั้งใบซ้ำ แม้แก้วันที่มาอยู่ในช่วงนี้ ให้ตรวจส่วนต่างจากโบนัสเดิมประกอบการปรับยอดเอง"}</p>
    {!preview.complete && <p role="alert" className="text-pretty rounded-lg border border-clay/30 bg-sand p-3 text-sm text-clay">ข้อมูลต้นทางบางส่วนถูกล้าง จึงตรวจความครบหรือคำนวณด้านที่เกี่ยวข้องใหม่ไม่ได้ ผลที่บันทึกไว้ยังแสดงค่าตามวันที่ยืนยัน</p>}
    <div className="grid gap-3 rounded-lg bg-sand p-4 sm:grid-cols-3">
      <div><p className="text-pretty text-sm text-ink/60">ต้นทุนที่เลือก</p><strong className="tabular-nums">{bonusNumber(preview.expenseTotal)} บาท</strong></div>
      <div><p className="text-pretty text-sm text-ink/60">ยอดซื้อพร้อมจ่าย</p><strong className="tabular-nums">{bonusNumber(preview.purchaseTotal)} บาท</strong></div>
      <div><p className="text-pretty text-sm text-ink/60">ภาระดำเนินงานต่อยอดซื้อ</p><strong className="tabular-nums">{bonusNumber(preview.burdenActual)}%</strong></div>
    </div>
    <div className="space-y-2">
      <h3 className="text-balance font-semibold">ตรวจค่าใช้จ่าย</h3>
      {groups.map(([kind, label]) => <label key={kind} className="flex min-h-11 items-center gap-3 rounded-lg border border-black/10 px-3 py-2 text-sm">
        <input type="checkbox" className="size-5 accent-leaf" checked={!input.excludedGroups.includes(kind)} disabled={!change} onChange={() => toggleGroup(kind)} />
        <span className="flex-1">รวม{label}</span><span className="tabular-nums">{bonusNumber(preview.expenseGroups.find(g => g.kind === kind)?.amount ?? 0)}</span>
      </label>)}
    </div>
    {([['expenses', 'รายการค่าใช้จ่าย'], ['purchases', 'ยอดซื้อที่ใช้เป็นตัวหาร'], ['counts', 'ใบนับเงินที่นำมานับ']] as const).map(([section, label]) => {
      const rows = [...preview[section], ...(extraRows[section] ?? [])];
      const sorting = section === "expenses" && rows.length < preview.sourceCounts.expenses;
      if (section === "expenses" && !sorting) rows.sort((a,b) => b.amount-a.amount || a.key.localeCompare(b.key));
      return <details key={section} className="rounded-lg border border-black/10 bg-white p-3" onToggle={event=>{if(section==="expenses")setExpensesOpen(event.currentTarget.open);}}>
        <summary className="focus-ring cursor-pointer py-1 font-semibold">{label} <span className="tabular-nums">({bonusNumber(preview.selectedSourceCounts?.[section] ?? preview.sourceCounts[section], 0)})</span></summary>
        {section === "expenses" && <p className="mt-2 text-pretty text-xs text-ink/60">นับเฉพาะรายการที่เลือกคำนวณ รายการที่ยกเว้นยังเปิดดูและเลือกกลับได้</p>}
        {sorting && <p role="status" className="mt-3 text-sm text-ink/60">{busy === "expenses" ? "กำลังโหลดค่าใช้จ่ายทุกหน้าเพื่อเรียงจากมากไปน้อย…" : "ต้องโหลดค่าใช้จ่ายให้ครบก่อนแสดงลำดับจากมากไปน้อย"}</p>}
        <div className="mt-3 divide-y divide-black/5">
          {!sorting && (section==="expenses"?rows.slice(0,expenseLimit):rows).map(row => <label key={row.key} className="flex items-start gap-3 py-3 text-sm">
            {section === "expenses" && <input type="checkbox" aria-label={`รวม ${row.label}`} className="mt-1 size-5 accent-leaf" checked={!input.excludedGroups.includes(row.kind) && !input.excludedKeys.includes(row.key)} disabled={!change || input.excludedGroups.includes(row.kind)} onChange={() => toggleSource(row.key)} />}
            <span className="min-w-0 flex-1"><span className="block break-words">{row.label}</span><span className="text-xs text-ink/60">{row.date} {costLabels[row.kind] ?? ""}{saved && !row.included ? " · ยกเว้น" : ""}</span></span>
            <span className="shrink-0 tabular-nums">{section === "counts" ? "1 ใบ" : bonusNumber(row.amount)}</span>
          </label>)}
          {!sorting && rows.length === 0 && <p className="py-3 text-pretty text-sm text-ink/60">ไม่มีรายการในช่วงประเมินนี้</p>}
        </div>
        {rows.length < preview.sourceCounts[section] && <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => void more(section)}>{busy === section ? "กำลังโหลด…" : "โหลดรายละเอียดเพิ่ม"}</button>}
        {section==="expenses"&&!sorting&&rows.length>expenseLimit&&<button type="button" className={secondaryButton} onClick={()=>setExpenseLimit(n=>n+50)}>โหลดรายละเอียดเพิ่ม</button>}
      </details>;
    })}
    {error && <p role="alert" className="text-pretty text-sm text-clay">{error}</p>}
  </div>;
}
