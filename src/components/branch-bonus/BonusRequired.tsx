"use client";
import { useState } from "react";
import type { BonusRequiredExport, BonusReview } from "@/types/branch-bonus";
import { formatBangkokDateTime } from "@/lib/bangkok-date";
import { bonusNumber, secondaryButton } from "./bonus-display";

export function BonusRequired({ review, openOld, openSource }: { review: BonusReview; openOld: (id: string) => void; openSource?: (id: string) => void }) {
  const [visible, setVisible] = useState(50);
  const rows = review.rows.filter(r => r.kind === "required");
  const label = (r: BonusRequiredExport) => <><strong>{r.exportNo}</strong><p className="text-pretty text-xs text-ink/60">{formatBangkokDateTime(r.createdAt)} · {r.history ? "ประวัติ" : "กำลังดำเนินการ"}</p>{openSource && <button type="button" className="focus-ring min-h-11 rounded text-sm font-semibold text-leaf underline" onClick={()=>openSource(r.id)}>เปิดต้นทาง {r.exportNo}</button>}</>;
  const issues = (r: BonusRequiredExport) => r.issues.length ? <div className="text-clay">{r.issues.map(issue => <p key={issue} className="text-pretty">{issue}</p>)}</div> : <p className="text-pretty text-leaf">พร้อมประเมิน</p>;
  return <div className="space-y-4">
    <p className="text-pretty text-sm tabular-nums" role="status">ทั้งหมด {review.requiredCount} · พร้อม {review.requiredCount-review.blockedCount} · ต้องแก้ไข {review.blockedCount}</p>
    <p className="text-pretty text-sm text-ink/60">รวมทุกหน้า ทั้งกำลังดำเนินการและประวัติ เอาออกทีละใบไม่ได้ ทุกใบต้องอยู่ในประวัติและมีน้ำหนักลดลงจริงมากกว่า 0</p>
    {rows.some(r => "averageAgeHours" in r && (r.averageAgeHours == null || !r.ageCutoffAt || r.estimatedAgeItemCount == null)) && <p className="text-pretty rounded-lg bg-sand p-3 text-sm" role="status">บาง REX ขาดอายุ ณ ตรวจสอบ ยังไปตั้งค่าได้ แต่ต้องแก้ต้นทางหรือปรับสัดส่วนอายุยางเป็น 0% ก่อนยืนยัน</p>}
    <table className="hidden w-full text-left text-sm md:table"><caption className="sr-only">REX ที่ต้องประเมินทั้งหมด</caption><thead><tr><th className="p-3">REX / วันสร้าง</th><th className="p-3">น้ำหนักที่ลดลง</th><th className="p-3">ผลตรวจ</th></tr></thead><tbody>{rows.slice(0,visible).map(r => <tr key={r.id} className="border-t border-black/10"><td className="p-3">{label(r)}</td><td className="p-3 tabular-nums">{bonusNumber(r.currentWeight == null ? null : r.originalWeight-r.currentWeight)} กก.<p>{bonusNumber(r.lossPercent)}%</p></td><td className="p-3">{issues(r)}</td></tr>)}</tbody></table>
    <div className="space-y-3 md:hidden">{rows.slice(0,visible).map(r => <article key={r.id} className="space-y-2 rounded-lg border border-black/10 bg-white p-4">{label(r)}<p className="text-pretty text-sm tabular-nums">ลดลง {bonusNumber(r.currentWeight == null ? null : r.originalWeight-r.currentWeight)} กก. · {bonusNumber(r.lossPercent)}%</p>{issues(r)}</article>)}</div>
    {rows.length === 0 && <p className="text-pretty rounded-lg bg-sand p-4">ไม่มี REX ที่รอประเมิน กดโหลดใหม่หลังมีรายการเพิ่ม</p>}
    <p className="text-pretty text-xs tabular-nums">แสดง {Math.min(visible,rows.length)} จาก {rows.length} รายการ</p>
    {visible<rows.length && <button type="button" className={secondaryButton} onClick={() => setVisible(n=>n+50)}>โหลด REX เพิ่ม</button>}
    {([['leftover','รายการตกค้างในช่วงโบนัสเดิม'],['self','รับกลับสาขาเดิม · ไม่คิดโบนัส']] as const).map(([kind,title]) => {
      const excluded=review.rows.filter(r=>r.kind===kind);
      return excluded.length>0 && <details key={kind} className="rounded-lg border border-black/10 p-4"><summary className="focus-ring min-h-11 font-semibold">{title} ({excluded.length})</summary><p className="text-pretty text-sm text-ink/60">ไม่เข้ารอบใหม่และไม่ขวางการทำโบนัส</p>{excluded.map(r=><div key={r.id} className="border-t border-black/10 py-3">{label(r)}{kind==='leftover' && r.bonusId && <button type="button" className={secondaryButton} onClick={()=>openOld(r.bonusId!)}>เปิดผลโบนัสเดิม {r.exportNo}</button>}</div>)}</details>;
    })}
  </div>;
}
