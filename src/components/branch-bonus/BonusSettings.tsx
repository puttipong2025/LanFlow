"use client";
import { useId } from "react";
import { NumberField } from "@/components/shared/NumberField";
import type { BonusPreview, BonusSettings as Settings } from "@/types/branch-bonus";
import { BONUS_METRICS } from "@/types/branch-bonus";
import { bonusNumber, metricLabels, metricHelp, metricUnits, secondaryButton } from "./bonus-display";
import { BonusDecimalField } from "./BonusDecimalField";

export function BonusSettings({ input, change, preview }: { input: Settings; change: (input: Settings) => void; preview: BonusPreview | null }) {
  const countTargetDescription = useId();
  const sum = BONUS_METRICS.reduce((n, key) => n + input.metrics[key].weight, 0);
  return <div className="space-y-5">
    <div><h3 className="text-balance text-lg font-semibold">ตั้งเป้าของสาขาครั้งนี้</h3><p className="mt-1 text-pretty text-sm text-ink/60">ตั้งเป้าภาระดำเนินงาน น้ำหนักลดลง และอายุยางเอง เป้านับเงินคิดตามจำนวนวัน ด้านที่ไม่ใช้ปรับสัดส่วนเป็น 0%</p></div>
    <button type="button" className={secondaryButton} onClick={() => change({ ...input, metrics: { burden: { ...input.metrics.burden, weight: 50 }, loss: { ...input.metrics.loss, weight: 40 }, counts: { ...input.metrics.counts, weight: 10 }, age: { ...input.metrics.age, weight: 0 } } })}>ใช้สัดส่วนทดลอง 50 / 40 / 10 / 0</button>
    {BONUS_METRICS.map(key => {
      const metric = input.metrics[key];
      const actual = { burden: preview?.burdenActual, loss: preview?.lossActual, counts: preview?.countActual, age: preview?.ageActual }[key];
      const targetValue = key === "counts" ? preview?.periodDays ?? 0 : metric.target ?? 0;
      const invalidTarget = metric.weight > 0 && (!Number.isFinite(targetValue) || targetValue <= 0);
      const descriptionId = `${countTargetDescription}-${key}`;
      return <section key={key} className="space-y-3 rounded-lg border border-black/10 p-4">
        <h4 className="text-balance font-semibold">{metricLabels[key]}</h4>
        <p className="text-pretty text-sm text-ink/60">ค่าจริง <span className="tabular-nums font-semibold text-ink">{bonusNumber(actual, key === "counts" ? 0 : 2)} {metricUnits[key]}</span> · {key === "counts" || key === "age" ? "ยิ่งมากกว่าเป้ายิ่งดี" : "ยิ่งต่ำกว่าเป้ายิ่งดี"}</p>
        {key === "age" && preview?.ageEstimatedExportCount != null && preview.ageEstimatedExportCount > 0 && <p className="text-pretty text-sm text-ink/60">อายุประมาณ · {preview.ageEstimatedExportCount} REX</p>}
        {key === "age" && metric.weight > 0 && preview && preview.ageActual == null && <p role="alert" className="text-pretty text-sm text-clay">REX บางใบขาดอายุ ณ ตรวจสอบ กรุณาแก้ต้นทางหรือปรับสัดส่วนอายุยางเป็น 0%</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div><NumberField label={`สัดส่วน ${metricLabels[key]} (%)`} value={metric.weight} min={0} max={100} step={1} ariaInvalid={!Number.isInteger(metric.weight)} onChange={weight => change({ ...input, metrics: { ...input.metrics, [key]: { ...metric, weight } } })} />{!Number.isInteger(metric.weight) && <p role="alert" className="text-pretty text-sm text-clay">สัดส่วนต้องเป็นจำนวนเต็ม</p>}</div>
          {metric.weight > 0 && <div>{key === "counts" ? <NumberField label="เป้า จำนวนรายการนับเงิน (ใบ)" value={targetValue} readOnly ariaDescribedBy={countTargetDescription} /> : <BonusDecimalField label={`เป้า ${metricLabels[key]} (${metricUnits[key]})`} value={targetValue} ariaInvalid={invalidTarget} ariaDescribedBy={descriptionId} change={target => change({ ...input, metrics: { ...input.metrics, [key]: { ...metric, target } } })} />}
            {key === "counts" && <p id={countTargetDescription} className="mt-1 text-pretty text-xs text-ink/60">คำนวณอัตโนมัติวันละ 1 ใบ รวมวันเริ่มและวันสิ้นสุด ({targetValue} วัน)</p>}
            <p id={descriptionId} className="mt-1 text-pretty text-sm text-clay" role={invalidTarget ? "alert" : undefined}>{invalidTarget ? key === "counts" ? "กรุณาเลือก REX เพื่อกำหนดช่วงประเมิน" : "กรุณากรอกเป้ามากกว่า 0" : ""}</p></div>}
        </div>
        <p className="text-pretty text-xs text-ink/60">{metricHelp[key]}</p>
      </section>;
    })}
    <p role="status" className="text-pretty font-semibold tabular-nums">สัดส่วนรวม {bonusNumber(sum)}% / 100%</p>
    {Math.round(sum * 100) !== 10000 && <p role="alert" className="text-pretty text-sm text-clay">ปรับสัดส่วนให้รวมเป็น 100% ก่อนยืนยัน</p>}
    <section className="space-y-3 rounded-lg border border-black/10 p-4"><h3 className="text-balance font-semibold">อัตราโบนัส</h3>
      <div className="flex flex-wrap gap-2">{[.01,.02,.03].map(rate => <button key={rate} type="button" className={secondaryButton} aria-pressed={input.rate === rate} onClick={() => change({ ...input, rate })}>{bonusNumber(rate)} บาท/กก.</button>)}</div>
      <BonusDecimalField label="อัตราโบนัสต่อกิโลกรัม (บาท)" value={input.rate} change={rate => change({ ...input, rate })} />
      {input.rate <= 0 && <p className="text-pretty text-sm text-clay">กรุณาเลือกหรือกรอกอัตรามากกว่า 0</p>}
      <p className="text-pretty text-xs text-ink/60">อัตราทดลองใช้เปรียบเทียบยอด เจ้าของเป็นผู้เลือกอัตราที่ใช้จริง</p>
      {preview?.scenarios && <div className="overflow-x-auto"><table className="w-full text-left text-sm tabular-nums"><caption className="sr-only">เปรียบเทียบอัตราโบนัส</caption><thead><tr><th className="p-2">บาท/กก.</th><th className="p-2">ฐาน</th><th className="p-2">เพิ่ม–ลด</th><th className="p-2">แนะนำ</th></tr></thead><tbody>{preview.scenarios.map(row => <tr key={row.rate}><td className="p-2">{bonusNumber(row.rate)}</td><td className="p-2">{bonusNumber(row.base)}</td><td className="p-2">{bonusNumber(row.adjustmentAmount)}</td><td className="p-2 font-semibold">{bonusNumber(row.amount)}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
