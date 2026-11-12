"use client";
import type { BonusReferenceBranch } from "@/types/branch-bonus";

export function BonusReferencePicker({ branches, locationId, excluded, change }: {
  branches: BonusReferenceBranch[]; locationId: string; excluded: string[]; change: (ids: string[]) => void;
}) {
  return <fieldset className="space-y-3 rounded-lg border border-black/10 bg-white p-4">
    <legend className="px-1 text-balance font-semibold">สาขาอ้างอิงสำหรับคำนวณเป้า</legend>
    <p className="text-pretty text-sm text-ink/60">ใช้ชุดสาขาเดียวกันทุกช่วง เฉลี่ยเฉพาะ REX ในประวัติที่ลดลงมากกว่า 0% ตามวันของแต่ละช่วง</p>
    <div className="grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">{branches.map(branch=>{
      const own=branch.id===locationId,blocked=!own&&branch.hasPending,description=`bonus-reference-${branch.id}`;
      return <label key={branch.id} className="flex min-h-11 items-start gap-3 rounded-md border border-black/10 bg-white px-3 py-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-5 accent-leaf" aria-label={`รวมสาขา ${branch.name} ในค่าเฉลี่ย`} aria-describedby={description}
          checked={own||(!blocked&&!excluded.includes(branch.id))} disabled={own||blocked}
          onChange={()=>change(excluded.includes(branch.id)?excluded.filter(id=>id!==branch.id):[...excluded,branch.id].sort())}/>
        <span className="min-w-0"><span className="block text-pretty font-semibold">{branch.name}</span>
          <span id={description} className="block text-pretty text-xs text-ink/60">{own?"สาขาที่กำลังประเมิน · รวมเสมอ":blocked?"มี REX ยังไม่เข้าประวัติ · ไม่รวมในค่าเฉลี่ย":excluded.includes(branch.id)?"ไม่รวมในค่าเฉลี่ย":"รวมสาขานี้ในค่าเฉลี่ย"}</span>
        </span>
      </label>;
    })}</div>
  </fieldset>;
}
