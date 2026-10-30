import type { BusinessCacheStatus } from "@/hooks/useBusinessCacheStatus";
import type { CacheState } from "@/lib/business-cache/refresh";
import { cn } from "@/lib/cn";

const labels: Record<CacheState["state"], string> = { unchecked: "ยังไม่ตรวจรุ่น", checking: "กำลังตรวจ", updating: "กำลังอัปเดต",
  waiting: "รอปิดฟอร์ม", current: "รุ่นแคชปัจจุบัน", failed: "ใช้ข้อมูลเดิม" };

function cacheLabel(state: CacheState, online: boolean) {
  return !online ? "ออฟไลน์ · ใช้ข้อมูลเดิม" : labels[state.state];
}

export function businessCacheSummary(status: BusinessCacheStatus, online: boolean) {
  const states = [status.rubber.state, status.income.state];
  if (!online) return "ออฟไลน์ · ใช้แคชข้อมูลเดิม";
  if (states.includes("waiting")) return "รอปิดฟอร์มเพื่ออัปเดตข้อมูล";
  if (states.includes("updating")) return "กำลังอัปเดตแคชข้อมูล";
  if (states.includes("checking")) return "กำลังตรวจเวอร์ชันแคช";
  if (states.every(state => state === "current")) return "แคชข้อมูลตรงกับเวอร์ชันระบบ";
  if (states.includes("current")) return "อัปเดตแคชข้อมูลแล้วบางส่วน";
  if (states.includes("failed")) return "ตรวจแคชไม่สำเร็จ · ใช้ข้อมูลเดิม";
  return "ยังไม่ตรวจเวอร์ชันแคชข้อมูล";
}

export function BusinessCacheDetails({ status, online }: { status: BusinessCacheStatus; online: boolean }) {
  return <div className="mt-3 border-t border-mint pt-3">
    <p className="text-pretty font-semibold">แคชข้อมูลในเครื่อง</p>
    {([ ["บิลยาง", status.rubber], ["รับ–จ่าย", status.income] ] as const).map(([name, state]) =>
      <section key={name} aria-label={`แคช${name}`} className="mt-2 border-b border-mint pb-2 last:border-b-0">
        <div className="flex items-start justify-between gap-3"><h3 className="text-balance font-semibold">{name}</h3>
          <span className={cn("text-right", state.state === "failed" ? "text-amber-800" : "text-ink/75")}>{cacheLabel(state, online)}</span></div>
        <p className="mt-1 text-pretty text-ink/65">{state.state === "waiting" ? "บันทึกหรือปิดฟอร์ม แล้วจะอัปเดตต่อ"
          : state.detail ?? "สถานะนี้ตรวจรุ่นแคช ไม่ยืนยันข้อมูลทุกบิลล่าสุด"}</p>
        {state.updatedAt && <p className="mt-1 text-pretty tabular-nums text-ink/65">อัปเดตข้อมูลสำเร็จ {new Intl.DateTimeFormat("th-TH", {
          dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(state.updatedAt))}</p>}
      </section>)}
    <p className="mt-2 text-pretty tabular-nums">{status.pending === null ? "ยังตรวจจำนวนงานในเครื่องไม่ได้" : `งานที่ยังไม่จบในเครื่อง ${status.pending} รายการ`}</p>
    {status.work && <p className="mt-1 text-pretty tabular-nums text-ink/65">รอส่ง/รอยืนยัน {status.work.pending} · ส่งไม่สำเร็จ {status.work.failed} · ข้อมูลขัดแย้ง {status.work.conflict}</p>}
    <p className="mt-1 text-pretty text-ink/65">รักษางานค้างไว้ · จำนวนนี้ไม่รวมคำขอที่อยู่เฉพาะบนเซิร์ฟเวอร์</p>
  </div>;
}
