import { useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { formatPayrollCurrency } from "@/lib/time-tracking/format";
import type { AttendanceExceptionDto, AttendanceMonthDto } from "@/lib/time-tracking/attendance-contract";
import { monthLabel, shiftMonth } from "../display";

type AttendanceCalendarProps = {
  attendance: AttendanceMonthDto; month: string; editable?: boolean; saving?: boolean; disabledReason?: string;
  onMonthChange: (month: string) => void;
  onSave?: (selections: AttendanceExceptionDto[]) => Promise<string | null>;
};
function monthDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const numberOfDays = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: numberOfDays }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}
function statusLabel(status: "FULL" | "HALF_DAY" | "OFF") {
  if (status === "HALF_DAY") return "ครึ่งวัน";
  if (status === "OFF") return "หยุด";
  return "เต็มวัน";
}
function calendarStatusLabel(status: "FULL" | "HALF_DAY" | "OFF" | "INACTIVE" | "PENDING") {
  if (status === "INACTIVE") return "ไม่ได้คิดค่าแรง";
  if (status === "PENDING") return "ยังไม่ถึงวันทำงาน";
  return statusLabel(status);
}
function dayOfWeek(date: string) {
  return new Intl.DateTimeFormat("th-TH", { weekday: "short", timeZone: "Asia/Bangkok" }).format(new Date(`${date}T00:00:00+07:00`));
}

export function AttendanceCalendar({
  attendance,
  month,
  editable = false,
  saving = false,
  disabledReason,
  onMonthChange,
  onSave,
}: AttendanceCalendarProps) {
  const [draft, setDraft] = useState<Record<string, "HALF_DAY" | "OFF"> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const exceptions = useMemo(() => Object.fromEntries(attendance.exceptions.map((item) => [item.date, item.status])), [attendance.exceptions]);
  const selections = draft ?? exceptions;
  const dirty = draft !== null;
  const days = useMemo(() => monthDays(month), [month]);
  // A missing boundary means this client is ahead of the server contract. Keep
  // the calendar read-only instead of assuming a future date is a paid full day.
  const eligibleThrough = attendance.eligibleThrough ?? "0000-00-00";
  const isActiveDate = (date: string) => attendance.periods.some((period) => (
    period.startOn <= date && (period.endOn === null || period.endOn >= date)
  ));
  const isEligibleDate = (date: string) => date <= eligibleThrough;

  useEffect(() => {
    setDraft(null);
    setSaveError(null);
  }, [month, attendance.month]);

  function cycleDay(date: string) {
    if (!editable || saving || !isActiveDate(date) || !isEligibleDate(date)) return;
    setSaveError(null);
    setDraft((current) => {
      const next = { ...(current ?? exceptions) };
      if (!next[date]) next[date] = "HALF_DAY";
      else if (next[date] === "HALF_DAY") next[date] = "OFF";
      else delete next[date];
      return next;
    });
  }

  async function save() {
    if (!onSave || !dirty) return;
    setSaveError(null);
    const error = await onSave(Object.entries(selections)
      .filter(([date]) => isActiveDate(date) && isEligibleDate(date))
      .map(([date, status]) => ({ date, status })));
    if (error) {
      setSaveError(error);
      return;
    }
    setDraft(null);
  }

  return (
    <section className="rounded-xl border border-black/10 bg-white p-4 shadow-sm" aria-busy={saving}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-balance font-bold text-ink"><CalendarDays size={18} aria-hidden="true" />ปฏิทินวันทำงาน</h3>
          <p className="mt-1 text-pretty text-sm text-ink/60">
            วันเต็มเป็นค่าอัตโนมัติหลังเวลา {attendance.workdayEndTime} น. บันทึกเฉพาะครึ่งวันหรือหยุด
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm tabular-nums sm:flex sm:flex-wrap">
          <span className="rounded-md bg-river/10 px-2 py-1 text-river">เต็ม {attendance.summary.fullDays}</span>
          <span className="rounded-md bg-amber/15 px-2 py-1 text-amber">ครึ่ง {attendance.summary.halfDays}</span>
          <span className="rounded-md bg-clay/10 px-2 py-1 text-clay">หยุด {attendance.summary.offDays}</span>
          <span className="rounded-md bg-leaf/10 px-2 py-1 text-leaf">รับ {attendance.summary.paidDays}</span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button type="button" onClick={() => onMonthChange(shiftMonth(month, -1))} className="focus-ring rounded-md border border-black/15 px-3 py-2 text-sm font-semibold">เดือนก่อน</button>
        <p className="text-center text-balance font-semibold text-ink">{monthLabel(month)}</p>
        <button type="button" onClick={() => onMonthChange(shiftMonth(month, 1))} className="focus-ring rounded-md border border-black/15 px-3 py-2 text-sm font-semibold">เดือนถัดไป</button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1" aria-label={`ปฏิทิน ${monthLabel(month)}`}>
        {days.map((date) => {
          const activeDate = isActiveDate(date);
          const eligibleDate = isEligibleDate(date);
          const status = !activeDate ? "INACTIVE" : !eligibleDate ? "PENDING" : selections[date] ?? "FULL";
          const color = status === "INACTIVE"
            ? "border-black/10 bg-black/5 text-ink/45"
            : status === "PENDING"
              ? "border-amber/20 bg-amber/5 text-ink/45"
            : status === "OFF"
            ? "border-clay/30 bg-clay/10 text-clay"
            : status === "HALF_DAY"
              ? "border-amber/35 bg-amber/15 text-amber"
              : "border-river/20 bg-river/10 text-river";
          return (
            <button
              key={date}
              type="button"
              onClick={() => cycleDay(date)}
              disabled={!activeDate || !eligibleDate || !editable || saving}
              title={`${date}: ${calendarStatusLabel(status)}${activeDate && eligibleDate && editable ? " — กดเพื่อเปลี่ยน" : ""}`}
              aria-label={`${date} ${dayOfWeek(date)}: ${calendarStatusLabel(status)}${activeDate && eligibleDate && editable ? ", กดเพื่อเปลี่ยน" : ""}`}
              className={`focus-ring min-h-14 rounded-md border px-1 py-1 text-center text-xs font-semibold tabular-nums ${color} ${activeDate && eligibleDate && editable ? "hover:brightness-95" : "cursor-default"} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <span className="block text-[10px] font-medium opacity-80">{dayOfWeek(date)}</span>
              <span className="block text-sm">{date.slice(-2)}</span>
              <span className="block text-[10px]">{status === "INACTIVE" ? "ไม่คิดค่าแรง" : status === "PENDING" ? "ยังไม่ถึงวันทำงาน" : statusLabel(status)}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t border-black/10 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-pretty text-sm text-ink/70">ค่าแรงขั้นต้น: <strong className="tabular-nums text-ink">{formatPayrollCurrency(attendance.summary.grossPay)}</strong></p>
        {editable && (
          <div className="flex flex-wrap gap-2">
            {dirty && <button type="button" onClick={() => { setDraft(null); setSaveError(null); }} disabled={saving} className="focus-ring rounded-md border border-black/15 px-3 py-2 text-sm font-semibold disabled:opacity-50">ยกเลิกการแก้</button>}
            <button type="button" onClick={() => void save()} disabled={!dirty || saving} title={disabledReason} className="focus-ring rounded-md bg-commit px-3 py-2 text-sm font-bold text-white hover:bg-commit/90 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? "กำลังบันทึก..." : "บันทึกปฏิทิน"}
            </button>
          </div>
        )}
      </div>
      {saveError && <p id="attendance-calendar-error" role="alert" className="mt-2 text-pretty text-sm font-semibold text-danger">{saveError}</p>}
      {editable && <p className="mt-2 text-pretty text-xs text-ink/55">กดวันที่หนึ่งครั้งเป็นครึ่งวัน สองครั้งเป็นหยุด และสามครั้งกลับเป็นเต็มวัน</p>}
    </section>
  );
}

