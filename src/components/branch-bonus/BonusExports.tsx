"use client";
import { useState } from "react";
import type { BonusExport } from "@/types/branch-bonus";
import { formatBangkokDateTime } from "@/lib/bangkok-date";
import { cn } from "@/lib/cn";
import { bonusNumber, secondaryButton } from "./bonus-display";

export function BonusExports({ rows, selected }: {
  rows: BonusExport[]; selected: string[];
}) {
  const [visible,setVisible] = useState(50);
  return <div className="space-y-3">
    {rows.length === 0 && <p className="text-pretty rounded-lg bg-sand p-4 text-sm">ไม่มี REX ในผลประเมินนี้</p>}
    {rows.slice(0,visible).map(row => {
      const ready = row.currentWeight !== null && row.currentWeight > 0 && row.currentWeight < row.originalWeight;
      return <article key={row.id} className={cn("flex items-start gap-3 rounded-lg border p-4", selected.includes(row.id) ? "border-leaf bg-mint/30" : "border-black/10 bg-white")}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{row.exportNo}</span><span className="text-sm tabular-nums">ลดลง {bonusNumber(row.lossPercent)}%</span></div>
          <p className="mt-1 text-pretty text-xs text-ink/60">สร้าง {formatBangkokDateTime(row.createdAt)}</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm tabular-nums sm:grid-cols-3">
            <div><dt className="text-ink/60">ก่อนลด</dt><dd className="font-semibold">{bonusNumber(row.originalWeight)} กก.</dd></div>
            <div><dt className="text-ink/60">หลังลด</dt><dd className="font-semibold">{bonusNumber(row.currentWeight)} กก.</dd></div>
            <div className="col-span-2 sm:col-span-1"><dt className="text-ink/60">ลดลงจริง</dt><dd>{bonusNumber(row.currentWeight === null ? null : row.originalWeight - row.currentWeight)} กก.</dd></div>
          </dl>
          {!ready && <p className="mt-2 text-pretty text-sm text-clay">ข้อมูลไม่พร้อม — อาจยังไม่ได้บันทึกน้ำหนักลดลง</p>}
          {row.bonusId && <p className="mt-2 text-pretty text-xs text-ink/60">มีผลโบนัสที่ผูกอยู่แล้ว ช่วงซ้อนจะยืนยันซ้ำไม่ได้</p>}
        </div>
      </article>;
    })}
    {visible<rows.length && <button type="button" className={secondaryButton} onClick={()=>setVisible(n=>n+50)}>โหลด REX เพิ่ม</button>}
  </div>;
}
