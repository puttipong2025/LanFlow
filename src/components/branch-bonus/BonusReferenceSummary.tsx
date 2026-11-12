import type { BonusReference } from "@/types/branch-bonus";
import { bonusNumber } from "./bonus-display";

export function BonusReferenceSummary({ reference }: { reference: BonusReference }) {
  return <section className="space-y-2 rounded-lg bg-sand p-4 text-sm">
    <h4 className="text-balance font-semibold">เป้าอ้างอิงทั้งระบบ</h4>
    <p className="text-pretty tabular-nums">อายุ {bonusNumber(reference.ageTarget)} วัน · น้ำหนักลดลง {bonusNumber(reference.lossTarget)}%</p>
    <p className="text-pretty">สาขาที่ใช้: {reference.branches.filter(b=>b.included).map(b=>b.name).join(", ")}</p>
    <details><summary className="focus-ring min-h-11 cursor-pointer rounded py-2 text-leaf">รายละเอียดเป้าอ้างอิงก่อนปัด</summary>
      <p className="text-pretty tabular-nums">อายุ {bonusNumber(reference.ageTarget,6)} วัน · น้ำหนักลดลง {bonusNumber(reference.lossTarget,6)}%</p>
      <p className="text-pretty tabular-nums">REX ที่ใช้ {bonusNumber(reference.count,0)} ใบ · น้ำหนักต้นทาง {bonusNumber(reference.weight)} กก.</p>
      {reference.estimatedCount>0&&<p className="text-pretty tabular-nums">รวมอายุประมาณ {reference.estimatedCount} REX</p>}
      <p className="text-pretty">สาขาที่ไม่รวม: {reference.branches.filter(b=>!b.included).map(b=>`${b.name}${b.hasPending?" (มี REX ยังไม่เข้าประวัติ)":""}`).join(", ")||"ไม่มี"}</p>
    </details>
  </section>;
}
