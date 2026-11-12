import type { BonusPreview } from "@/types/branch-bonus";
import { bonusNumber, metricLabels, metricHelp, metricUnits } from "./bonus-display";

export function BonusSummary({ preview, finalAmount }: { preview: BonusPreview | null; finalAmount?: number | null }) {
  if (!preview) return <p className="text-pretty text-sm text-ink/60">เลือก REX ในประวัติเพื่อเริ่มประเมิน</p>;
  const currentWeight = preview.exports.every(row => row.currentWeight !== null)
    ? preview.exports.reduce((total, row) => total + row.currentWeight!, 0) : null;
  const calculated = preview.metrics.length > 0 && preview.metrics.every(m => m.actual !== null && m.adjustment !== null)
    && Math.round(preview.metrics.reduce((n, m) => n + m.weight, 0) * 100) === 10000 && preview.rate > 0 && preview.suggestedAmount<=9999999999.99;
  return <div className="max-w-3xl space-y-4">
    <div><h3 className="text-balance font-semibold">ช่วงประเมินอัตโนมัติ</h3><p className="mt-1 text-pretty text-sm tabular-nums">{preview.periodStart} ถึง {preview.periodEnd}</p><p className="text-pretty text-xs text-ink/60">วันสร้าง REX ตามเวลาไทย</p></div>
    <div><p className="text-pretty text-sm text-ink/60">น้ำหนักที่ใช้คิดโบนัส</p><p className="text-xl font-bold tabular-nums">{bonusNumber(preview.weight)} กก.</p><p className="text-pretty text-xs text-ink/60">น้ำหนักต้นทางก่อนลดของ REX ในช่วงนี้</p></div>
    <dl className="grid grid-cols-2 gap-3 text-sm tabular-nums"><div><dt className="text-pretty text-ink/60">น้ำหนักหลังลด</dt><dd>{bonusNumber(currentWeight)} กก.</dd></div><div><dt className="text-pretty text-ink/60">น้ำหนักที่ลดลง</dt><dd>{bonusNumber(currentWeight === null ? null : preview.weight - currentWeight)} กก.</dd></div></dl>
    <dl className="space-y-2 text-sm tabular-nums"><div className="flex justify-between gap-3"><dt>อัตราต่อกิโลกรัม</dt><dd>{bonusNumber(preview.rate,preview.requestVersion ? 2 : 4)} บาท</dd></div><div className="flex justify-between gap-3"><dt>โบนัสฐาน</dt><dd>{bonusNumber(preview.base)} บาท</dd></div></dl>
    {preview.metrics.filter(metric => metric.weight > 0).map(metric => <div key={metric.key} className="border-t border-black/10 pt-3 text-sm">
      <p className="text-pretty font-semibold">{metricLabels[metric.key]} <span className="tabular-nums">({bonusNumber(metric.weight,preview.requestVersion ? 0 : 2)}%)</span></p>
      <p className="mt-1 text-pretty tabular-nums">จริง {bonusNumber(metric.actual,metric.key === "counts" ? 0 : 2)} / เป้า {bonusNumber(metric.target,metric.key === "counts" ? 0 : 2)} {metricUnits[metric.key]}</p>
      <p className="text-pretty tabular-nums">ปรับด้านนี้ {bonusNumber(metric.adjustment)}%</p>
      {metric.weightedAdjustment != null && <p className="text-pretty tabular-nums">หลังถ่วงสัดส่วน {bonusNumber(metric.weightedAdjustment)}%</p>}
      {metric.key === "age" && <><p className="text-pretty text-xs text-ink/60">{preview.ageEstimatedExportCount ? `รวมอายุประมาณ ${preview.ageEstimatedExportCount} REX` : "อายุ ณ ตรวจสอบ REX"}</p><details className="mt-2"><summary className="focus-ring min-h-11 cursor-pointer rounded text-leaf">รายละเอียดคะแนนอายุยาง</summary><p className="text-pretty tabular-nums">อายุเฉลี่ย {bonusNumber(metric.actual,6)} วัน · ผลต่างเทียบเป้า {bonusNumber(metric.relative,6)}%</p><p className="text-pretty text-xs text-ink/60">จัดระดับคะแนนจากค่าก่อนปัดเศษ ตัวเลขที่แสดงสองตำแหน่งอาจดูเหมือนถึงเกณฑ์แล้ว</p></details></>}
      <p className="mt-1 text-pretty text-xs text-ink/60">{metricHelp[metric.key]}</p>
    </div>)}
    <div className="border-t border-black/10 pt-3"><p className="text-pretty text-sm">ปรับรวม <span className="tabular-nums">{calculated ? bonusNumber(preview.adjustment) : "—"}%</span></p><p className="mt-2 text-pretty text-sm text-ink/60">โบนัสแนะนำ</p><p className="text-2xl font-bold text-leaf tabular-nums">{calculated ? bonusNumber(preview.suggestedAmount) : "—"} บาท</p></div>
    {finalAmount != null && <div><p className="text-pretty text-sm">ยอดสุดท้าย</p><p className="text-xl font-bold tabular-nums">{bonusNumber(finalAmount)} บาท</p><p className="text-pretty text-xs tabular-nums">ต่างจากยอดแนะนำ {bonusNumber(finalAmount - preview.suggestedAmount)} บาท</p></div>}
  </div>;
}
