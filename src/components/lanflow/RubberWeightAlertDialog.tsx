"use client";
import { useState } from "react";
import { AlertDialog } from "@/components/shared/AlertDialog";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import type { AlertKind, BranchThresholdCheck } from "@/lib/lanflow/branch-threshold-alert";
import type { CashCountLockState } from "@/lib/cash-count-lock";
import { CashCountLockNotice } from "@/components/cash-counts/CashCountLockNotice";
import { countAlertGroups } from "@/lib/lanflow/count-alert-groups";

type LockProps = { locks?: CashCountLockState[]; offset?: number; working?: string | null; lockError?: string | null; onUnlock?: (id: string) => void; forceCount?: boolean };
export function RubberWeightAlertDialog({ alert, onAcknowledge, ...lockProps }: {
  alert: BranchThresholdCheck | null; onAcknowledge: () => void;
} & LockProps) {
  const hasLockNotice = lockProps.locks?.some((s) => s.enabled && (s.locked || (s.unlockedUntil && Date.parse(s.unlockedUntil) > Date.now() + (lockProps.offset ?? 0))));
  const description = !alert ? "ผลการตรวจแจ้งเตือน"
    : hasLockNotice ? "ตรวจสอบกำหนดนับเงิน สถานะล็อก และช่วงใช้งานชั่วคราวของสาขา"
    : alert.configuredCount === 0 ? "ยังไม่มีสาขาที่ตั้งค่ากลุ่มแจ้งเตือน"
    : alert.candidates.length ? `พบ ${new Set(alert.candidates.map((item) => item.locationId)).size} สาขา จาก ${new Set(alert.candidates.map((item) => `${item.kind}:${item.groupId}`)).size} กลุ่มที่ต้องตรวจสอบ`
    : alert.unavailable.length ? "ยังตรวจได้ไม่ครบ ไม่พบรายการเข้าเงื่อนไขในข้อมูลที่พร้อม"
    : "ไม่มีรายการเข้าเงื่อนไขแจ้งเตือน";
  return <AlertDialog open={alert !== null} title="แจ้งเตือน" description={description} confirmLabel="รับทราบ" cancelLabel={null} onCancel={onAcknowledge} onConfirm={onAcknowledge}>
    {alert && <ThresholdResult key={`${lockProps.forceCount}:${JSON.stringify(alert)}`} alert={alert} {...lockProps} />}
  </AlertDialog>;
}
function ThresholdResult({ alert, locks = [], offset = 0, working, lockError, onUnlock, forceCount }: { alert: BranchThresholdCheck } & LockProps) {
  const hasCash = alert.candidates.some((item) => item.kind === "cash");
  const hasWeight = alert.candidates.some((item) => item.kind === "weight");
  const visibleLocks = locks.filter((s) => s.enabled && (s.locked || (s.unlockedUntil && Date.parse(s.unlockedUntil) > Date.now() + offset)));
  const hasCount = alert.candidates.some((item) => item.kind === "count") || visibleLocks.length > 0;
  const countGroups = countAlertGroups(alert.candidates, locks, Date.now() + offset);
  const [kind, setKind] = useState<AlertKind>(forceCount ? "count" : hasCash ? "cash" : hasWeight ? "weight" : "count");
  const candidates = alert.candidates.filter((item) => kind !== "count" && item.kind === kind);
  const unit = kind === "cash" ? "บาท" : "กก.";
  const groups = candidates.reduce<Array<{ id: string; order: number; threshold: number; candidates: typeof candidates }>>((result, item) => {
    const group = result.find((entry) => entry.id === item.groupId);
    if (group) group.candidates.push(item);
    else result.push({ id: item.groupId, order: item.groupOrder, threshold: item.threshold, candidates: [item] });
    return result;
  }, []).sort((left, right) => left.order - right.order);
  return (
    <div className="mt-4 max-h-[min(50dvh,24rem)] space-y-3 overflow-y-auto pr-1" data-testid="threshold-alert-results">
      {[hasCash, hasWeight, hasCount].filter(Boolean).length > 1 && <div className="flex flex-wrap gap-2" aria-label="เลือกหน้าการแจ้งเตือน">
        {(["cash", "weight", "count"] as const).filter((value) => value === "count" ? hasCount : alert.candidates.some((item) => item.kind === value)).map((value) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}
          className={cn("focus-ring min-h-11 rounded-md border px-3 text-sm font-semibold", kind === value ? "border-river bg-river text-white" : "border-black/15 bg-white")}>
          {value === "count" ? "นับเงิน" : value === "cash" ? "ยอดเงิน" : "น้ำหนัก"} · {value === "count" ? new Set([...alert.candidates.filter((s) => s.kind === "count").map((s) => s.locationId), ...visibleLocks.map((s) => s.locationId)]).size : alert.candidates.filter((item) => item.kind === value).length}
        </button>)}
      </div>}
      {kind === "count" && countGroups.map((group) => <section key={group.id} className="rounded-md border border-black/10 p-3" aria-label={group.order ? `กลุ่ม ${group.order}` : "กลุ่มเกณฑ์นับเงิน"}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-balance text-sm font-bold">{group.order ? `กลุ่ม ${group.order}` : "กลุ่มเกณฑ์นับเงิน"}
            {group.threshold !== undefined && <span className="font-normal tabular-nums text-ink/65"> · ทุก {group.threshold} วัน</span>}
            {group.discrepancyThreshold != null && <span className="font-normal tabular-nums text-ink/65"> · ขาด–เกิน &gt; {formatNumber(group.discrepancyThreshold)} บาท</span>}
          </h4>
        </div>
        <ul className="mt-2 space-y-2">{group.rows.map((row) => <li key={row.locationId} data-testid="count-alert-row" className="flex items-start justify-between gap-4 rounded-md bg-field px-3 py-2.5">
          <div className="min-w-0 flex-1 space-y-2">
            <p className="break-words text-pretty text-sm font-semibold tabular-nums">{row.name}
              {row.candidate && row.candidate.value > 0 && <> · <span className="text-clay">เกินกำหนด {formatNumber(row.candidate.value)} วัน</span></>}
              {row.lock && <> · {row.lock.locked ? "ถูกล็อก" : "ปลดล็อกชั่วคราว"}</>}
            </p>
            {row.candidate?.discrepancy && <p className="text-pretty text-sm tabular-nums text-ink/65">
              นับล่าสุด {new Date(row.candidate.discrepancy.countedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })} · <strong className="text-clay">{row.candidate.discrepancy.amount < 0 ? "ขาด" : "เกิน"} {formatNumber(Math.abs(row.candidate.discrepancy.amount))} บาท</strong>
            </p>}
            {row.candidate?.discrepancyUnavailable && <p className="text-pretty text-sm text-ink/65">ผลนับเดิมไม่มีฐานยอดระบบ จึงยังตรวจส่วนต่างไม่ได้</p>}
            {row.lock && <CashCountLockNotice embedded state={row.lock} offset={offset} working={working === row.locationId} onUnlock={() => onUnlock?.(row.locationId)} />}
          </div>
        </li>)}</ul>
      </section>)}
      {kind === "count" && lockError && <p role="alert" className="text-pretty text-sm text-clay">{lockError}</p>}
      {kind !== "count" && candidates.length > 0 && <h4 className="text-balance font-semibold">{kind === "cash" ? "รับ–จ่ายสุทธิสะสมต่ำกว่าเกณฑ์" : "น้ำหนักยางสุทธิสะสมเกินเกณฑ์"}</h4>}
      {kind !== "count" && groups.map((group) => <section key={group.id} className="rounded-md border border-black/10 p-3" aria-label={`กลุ่ม ${group.order}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-balance text-sm font-bold text-ink">กลุ่ม {group.order}</h4>
          <p className="text-sm text-ink/65">{kind === "cash" ? "เกณฑ์ขั้นต่ำ" : "เกณฑ์"} <span className="font-semibold tabular-nums">{formatNumber(group.threshold)} {unit}</span></p>
        </div>
        <ul className="mt-2 space-y-2">{group.candidates.map((item) => <li key={item.locationId} className="flex items-start justify-between gap-4 rounded-md bg-field px-3 py-2.5">
          <span className="min-w-0 break-words text-pretty text-sm font-semibold text-ink">{item.locationName}</span>
          <span className="shrink-0 text-sm font-bold tabular-nums text-clay">{formatNumber(item.value)} {unit}</span>
        </li>)}</ul>
      </section>)}
      {alert.unavailable.length > 0 && <section className="rounded-md bg-field p-3">
        <h4 className="text-balance text-sm font-semibold">ข้อมูลยังไม่พร้อม · ยังตรวจไม่ได้</h4>
        <ul className="mt-2 space-y-1 text-sm text-ink/70">{alert.unavailable.map((item) => <li key={`${item.kind}:${item.locationId}`}>
          {item.locationName} · {item.kind === "cash" ? "ยอดเงิน" : "น้ำหนัก"} · {item.reason === "missing_snapshot" ? "ยังไม่มีผลคำนวณ" : item.reason === "missing_metric" ? "ข้อมูลไม่ครบ" : "รออัปเดตข้อมูล"}
        </li>)}</ul>
      </section>}
      {alert.configuredCount === 0 && visibleLocks.length === 0 && <p className="text-pretty text-sm text-ink/65">ผู้จัดการระบบสามารถตั้งกลุ่มได้ที่หน้า Admin → การแจ้งเตือน</p>}
    </div>
  );
}
