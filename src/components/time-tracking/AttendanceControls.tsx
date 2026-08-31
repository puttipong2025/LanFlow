"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Settings2 } from "lucide-react";
import { ModalShell } from "@/components/shared/ModalShell";
import { formatCurrency } from "@/lib/format";
import type {
  AttendanceExceptionDto,
  AttendanceMonthDto,
  AttendancePeriodDto,
  PayrollPeriodAction,
  TimePayrollSettingsDto,
} from "@/lib/time-tracking/attendance-contract";

const MONTH_FORMATTER = new Intl.DateTimeFormat("th-TH", {
  month: "long",
  year: "numeric",
  timeZone: "Asia/Bangkok",
});

type AttendanceCalendarProps = {
  attendance: AttendanceMonthDto;
  month: string;
  editable?: boolean;
  saving?: boolean;
  disabledReason?: string;
  onMonthChange: (month: string) => void;
  onSave?: (selections: AttendanceExceptionDto[]) => Promise<boolean>;
};

function monthLabel(month: string) {
  return MONTH_FORMATTER.format(new Date(`${month}-01T00:00:00+07:00`));
}

function monthDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const numberOfDays = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: numberOfDays }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

function shiftMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function statusLabel(status: "FULL" | "HALF_DAY" | "OFF") {
  if (status === "HALF_DAY") return "ครึ่งวัน";
  if (status === "OFF") return "หยุด";
  return "เต็มวัน";
}

function calendarStatusLabel(status: "FULL" | "HALF_DAY" | "OFF" | "INACTIVE" | "PENDING") {
  if (status === "INACTIVE") return "ไม่ได้เปิดเงินเดือน";
  if (status === "PENDING") return "ยังไม่ถึงวันทำงาน";
  return statusLabel(status);
}

function dayOfWeek(date: string) {
  return new Intl.DateTimeFormat("th-TH", { weekday: "short", timeZone: "Asia/Bangkok" }).format(
    new Date(`${date}T00:00:00+07:00`),
  );
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
  }, [month, attendance.month]);

  function cycleDay(date: string) {
    if (!editable || saving || !isActiveDate(date) || !isEligibleDate(date)) return;
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
    const saved = await onSave(Object.entries(selections)
      .filter(([date]) => isActiveDate(date) && isEligibleDate(date))
      .map(([date, status]) => ({ date, status })));
    if (saved) setDraft(null);
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
              <span className="block text-[10px]">{status === "INACTIVE" ? "ไม่ได้เปิด" : status === "PENDING" ? "ยังไม่ถึงวันทำงาน" : statusLabel(status)}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t border-black/10 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-pretty text-sm text-ink/70">ค่าแรงขั้นต้น: <strong className="tabular-nums text-ink">{formatCurrency(attendance.summary.grossPay)}</strong></p>
        {editable && (
          <div className="flex flex-wrap gap-2">
            {dirty && <button type="button" onClick={() => setDraft(null)} disabled={saving} className="focus-ring rounded-md border border-black/15 px-3 py-2 text-sm font-semibold disabled:opacity-50">ยกเลิกการแก้</button>}
            <button type="button" onClick={() => void save()} disabled={!dirty || saving} title={disabledReason} className="focus-ring rounded-md bg-commit px-3 py-2 text-sm font-bold text-white hover:bg-commit/90 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? "กำลังบันทึก..." : "บันทึกปฏิทิน"}
            </button>
          </div>
        )}
      </div>
      {editable && <p className="mt-2 text-pretty text-xs text-ink/55">กดวันที่หนึ่งครั้งเป็นครึ่งวัน สองครั้งเป็นหยุด และสามครั้งกลับเป็นเต็มวัน</p>}
    </section>
  );
}

export function TimePayrollConfigPanel({
  settings,
  canConfigure,
  online,
  saving,
  onSave,
}: {
  settings: TimePayrollSettingsDto;
  canConfigure: boolean;
  online: boolean;
  saving?: boolean;
  onSave: (time: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(settings.pendingWorkdayEndTime ?? settings.workdayEndTime);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!/^\d{2}:\d{2}$/.test(time)) {
      setError("กรุณาระบุเวลาในรูปแบบ ชั่วโมง:นาที");
      return;
    }
    if (await onSave(time)) setOpen(false);
    else setError("บันทึกการตั้งค่าไม่สำเร็จ กรุณาลองใหม่");
  }

  return (
    <>
      <section className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-balance font-bold text-ink"><Settings2 size={18} aria-hidden="true" />เวลาสิ้นสุดวันทำงาน</h3>
            <p className="mt-1 text-pretty text-sm text-ink/70">ปัจจุบัน {settings.workdayEndTime} น.</p>
            {settings.pendingWorkdayEndTime && <p className="mt-1 text-pretty text-xs text-amber">รอใช้ {settings.pendingWorkdayEndTime} น. ตั้งแต่ {settings.pendingEffectiveDate}</p>}
          </div>
          {canConfigure ? <button type="button" onClick={() => { setTime(settings.pendingWorkdayEndTime ?? settings.workdayEndTime); setOpen(true); }} disabled={!online} title={online ? "ตั้งค่าเวลาสิ้นสุดวันทำงาน" : "เวลาและเงินเดือนใช้ได้เมื่อออนไลน์เท่านั้น"} aria-label="ตั้งค่าเวลาสิ้นสุดวันทำงาน" className="focus-ring inline-flex size-10 items-center justify-center rounded-md bg-river text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50"><Settings2 size={18} aria-hidden="true" /></button> : <span className="text-xs text-ink/55">ดูได้เท่านั้น</span>}
        </div>
      </section>
      {open && (
        <ModalShell title="ตั้งค่าเวลาสิ้นสุดวันทำงาน" subtitle="การเปลี่ยนแปลงจะมีผลในวันถัดไป" onClose={() => setOpen(false)} nativeModal closeOnEscape size="compact" closeDisabled={saving}>
          <form onSubmit={(event) => void submit(event)} className="space-y-4" aria-busy={saving}>
            <label className="grid gap-1 text-sm font-semibold text-ink">เวลาใหม่
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="focus-ring h-10 rounded-md border border-black/15 px-3" required aria-invalid={Boolean(error)} aria-describedby={error ? "time-payroll-config-error" : undefined} />
            </label>
            {error && <p id="time-payroll-config-error" role="alert" className="text-sm font-semibold text-danger">{error}</p>}
            <button type="submit" disabled={saving || !online} className="focus-ring h-10 rounded-md bg-commit px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving ? "กำลังบันทึก..." : "บันทึกให้มีผลวันถัดไป"}</button>
          </form>
        </ModalShell>
      )}
    </>
  );
}

export function AttendancePeriodControls({
  userName,
  periods,
  online,
  saving,
  onAction,
}: {
  userName: string;
  periods: AttendancePeriodDto[];
  online: boolean;
  saving?: boolean;
  onAction: (action: PayrollPeriodAction, effectiveDate: string) => Promise<string | null>;
}) {
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }));
  const [error, setError] = useState<string | null>(null);
  const current = periods.find((period) => period.endOn === null);
  const actions: PayrollPeriodAction[] = current ? ["PAUSE", "END"] : periods.length ? ["RESUME"] : ["ENABLE"];

  async function handle(action: PayrollPeriodAction) {
    setError(null);
    if (!date) {
      setError("กรุณาเลือกวันที่มีผล");
      return;
    }
    const actionError = await onAction(action, date);
    if (actionError) setError(actionError);
  }

  return (
    <section className="rounded-xl border border-black/10 bg-white p-4 shadow-sm" aria-busy={saving}>
      <h3 className="text-balance font-bold text-ink">ช่วงทำงานของ {userName}</h3>
      <p className="mt-1 text-pretty text-sm text-ink/60">{current ? `กำลังทำงานตั้งแต่ ${current.startOn}` : "ไม่มีช่วงทำงานที่เปิดอยู่"}</p>
      <label className="mt-3 grid max-w-xs gap-1 text-sm font-semibold">วันที่มีผล<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="focus-ring h-10 rounded-md border border-black/15 px-3" aria-invalid={Boolean(error)} aria-describedby={error ? "period-action-error" : undefined} /></label>
      <div className="mt-3 flex flex-wrap gap-2">
        {actions.map((action) => <button key={action} type="button" onClick={() => void handle(action)} disabled={saving || !online} className="focus-ring rounded-md bg-river px-3 py-2 text-sm font-bold text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50">{action === "ENABLE" ? "เปิดใช้เงินเดือน" : action === "PAUSE" ? "พักงาน" : action === "RESUME" ? "กลับเข้าทำงาน" : "สิ้นสุดงาน"}</button>)}
      </div>
      {error && <p id="period-action-error" role="alert" className="mt-2 text-sm font-semibold text-danger">{error}</p>}
    </section>
  );
}
