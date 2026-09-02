"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock3, Settings2 } from "lucide-react";
import { ModalShell } from "@/components/shared/ModalShell";
import { bangkokDateString } from "@/lib/bangkok-date";
import { cn } from "@/lib/cn";
import { formatPayrollCurrency } from "@/lib/time-tracking/format";
import type {
  AttendanceExceptionDto,
  AttendanceMonthDto,
  PayrollPeriodAction,
  PayrollPeriodStateDto,
  TimePayrollSettingsDto,
} from "@/lib/time-tracking/attendance-contract";

const MONTH_FORMATTER = new Intl.DateTimeFormat("th-TH", {
  month: "long",
  year: "numeric",
  timeZone: "Asia/Bangkok",
});

const THAI_DATE_FORMATTER = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Bangkok",
});

export function formatThaiDate(date: string) {
  const value = new Date(`${date}T00:00:00+07:00`);
  return Number.isNaN(value.getTime()) ? date : THAI_DATE_FORMATTER.format(value);
}

function previousDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function payrollPeriodActionLabel(action: PayrollPeriodAction) {
  if (action === "ENABLE") return "เริ่มคิดค่าแรง";
  if (action === "PAUSE") return "พักคิดค่าแรง";
  if (action === "RESUME") return "กลับมาคิดค่าแรง";
  return "สิ้นสุดสถานะเงินเดือน";
}

function actionDateLabel(action: PayrollPeriodAction) {
  if (action === "ENABLE") return "วันเริ่มคิดค่าแรง";
  if (action === "PAUSE") return "วันแรกที่พักคิดค่าแรง";
  if (action === "RESUME") return "วันแรกที่กลับมาคิดค่าแรง";
  return "วันที่สิ้นสุดสถานะเงินเดือน";
}

function actionDescription(action: PayrollPeriodAction) {
  if (action === "ENABLE") return "เปิดช่วงคิดค่าแรงครั้งแรก";
  if (action === "PAUSE") return "หยุดชั่วคราว และกลับมาคิดต่อได้";
  if (action === "RESUME") return "เปิดช่วงคิดค่าแรงต่อจากช่วงเดิม";
  return "ปิดช่วงการคิดค่าแรงปัจจุบัน";
}

function scheduledActionText(
  action: PayrollPeriodAction,
  selectedDate: string,
  activationDate: string,
) {
  const summary = action === "END"
    ? `วันที่สิ้นสุดสถานะเงินเดือน ${formatThaiDate(selectedDate)} · คิดค่าแรงถึง ${formatThaiDate(previousDate(selectedDate))}`
    : `${actionDateLabel(action)} ${formatThaiDate(selectedDate)} เวลา 00:00`;
  return selectedDate === activationDate
    ? summary
    : `${summary} · สถานะเปลี่ยนจริง ${formatThaiDate(activationDate)} เวลา 00:00`;
}

function formatPayrollUiError(message: string) {
  return message
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => formatThaiDate(date))
    .replace(/\b\d{4}-\d{2}\b/g, (month) => monthLabel(month))
    .replaceAll("เปิดใช้เงินเดือน", "เริ่มคิดค่าแรง")
    .replaceAll("กลับเข้าทำงาน", "กลับมาคิดค่าแรง")
    .replaceAll("พักงาน", "พักคิดค่าแรง")
    .replaceAll("สิ้นสุดงาน", "สิ้นสุดสถานะเงินเดือน")
    .replaceAll("เปลี่ยนสถานะเงินเดือน", "เปลี่ยนสถานะการคิดค่าแรง");
}

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

function affectedMonths(firstDate: string, secondDate: string) {
  const [startDate, endExclusive] = firstDate <= secondDate
    ? [firstDate, secondDate]
    : [secondDate, firstDate];
  const affectedEnd = new Date(`${endExclusive}T00:00:00Z`);
  affectedEnd.setUTCDate(affectedEnd.getUTCDate() - 1);
  const start = startDate.slice(0, 7);
  const end = affectedEnd.toISOString().slice(0, 7);
  const months: string[] = [];
  for (let month = start; month <= end; month = shiftMonth(month, 1)) months.push(month);
  return months;
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
              <span className="block text-[10px]">{status === "INACTIVE" ? "ไม่คิดค่าแรง" : status === "PENDING" ? "ยังไม่ถึงวันทำงาน" : statusLabel(status)}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t border-black/10 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-pretty text-sm text-ink/70">ค่าแรงขั้นต้น: <strong className="tabular-nums text-ink">{formatPayrollCurrency(attendance.summary.grossPay)}</strong></p>
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
  periodState,
  workdayEndTime,
  online,
  saving,
  onAction,
  onCancel,
  onCorrectPeriodStart,
}: {
  userName: string;
  periodState: PayrollPeriodStateDto;
  workdayEndTime: string;
  online: boolean;
  saving?: boolean;
  onAction: (action: PayrollPeriodAction, effectiveDate: string) => Promise<string | null>;
  onCancel: () => Promise<string | null>;
  onCorrectPeriodStart: (periodId: string, startOn: string) => Promise<string | null>;
}) {
  const [actionDraft, setActionDraft] = useState<{ action: PayrollPeriodAction; date: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionDate, setCorrectionDate] = useState(periodState.periodStartCorrection?.currentStartOn ?? "");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const current = periodState.currentPeriod;
  const actions: PayrollPeriodAction[] = periodState.currentStatus === "ACTIVE"
    ? ["PAUSE", "END"]
    : periodState.hasPeriodHistory ? ["RESUME"] : ["ENABLE"];
  const today = bangkokDateString();
  const correction = periodState.periodStartCorrection;
  const latestPeriodStart = correction?.currentStartOn ?? current?.startOn ?? null;
  const latestPeriodEnd = correction ? correction.endOn : current?.endOn ?? null;
  const correctionDateValid = Boolean(
    correction
    && correctionDate
    && correctionDate !== correction.currentStartOn
    && (!correction.earliestOn || correctionDate >= correction.earliestOn)
    && correctionDate <= correction.latestOn,
  );

  useEffect(() => {
    setCorrectionDate(periodState.periodStartCorrection?.currentStartOn ?? "");
    setCorrectionError(null);
    setCorrectionOpen(false);
  }, [periodState.periodStartCorrection?.periodId, periodState.periodStartCorrection?.currentStartOn]);

  function openAction(action: PayrollPeriodAction) {
    const pending = periodState.nextAction;
    setError(null);
    setActionDraft({
      action,
      date: pending?.action === action ? pending.selectedEffectiveOn : today,
    });
  }

  function effectText(action: PayrollPeriodAction, selectedDate: string) {
    if (!selectedDate) return "เลือกวันที่เพื่อดูเวลาที่มีผลจริง";
    if (action === "END") {
      return selectedDate === today
        ? `สิ้นสุดสถานะเงินเดือนทันทีในวันที่ ${formatThaiDate(selectedDate)} โดยระบบจะตรวจเวลาสิ้นสุดวันทำงานจากเซิร์ฟเวอร์และคงผลค่าแรงวันนี้หากได้รับแล้ว`
        : `สิ้นสุดสถานะเงินเดือนวันที่ ${formatThaiDate(selectedDate)} และคิดค่าแรงถึง ${formatThaiDate(previousDate(selectedDate))}`;
    }
    if (action === "PAUSE") {
      return `เริ่มพักคิดค่าแรง 00:00 วันที่ ${formatThaiDate(selectedDate)} และคิดค่าแรงถึง ${formatThaiDate(previousDate(selectedDate))}`;
    }
    if (action === "RESUME" && selectedDate < today) {
      return `${formatThaiDate(selectedDate)} เป็นวันแรกที่กลับมามีสิทธิ์ค่าแรง วันย้อนหลังนับเต็มวันตามปฏิทินเดิม เว้นแต่แก้เป็นครึ่งวันหรือหยุด; วันนี้นับเมื่อถึง ${workdayEndTime} น.`;
    }
    return `เริ่มมีสิทธิ์ค่าแรง 00:00 วันที่ ${formatThaiDate(selectedDate)}; ค่าแรงเต็มวันจะนับเมื่อถึง ${workdayEndTime} น.`;
  }

  async function runAction() {
    if (!actionDraft) return;
    const { action, date } = actionDraft;
    setError(null);
    if (!date) {
      setError(`กรุณาเลือก${actionDateLabel(action)}`);
      return;
    }
    if (action === "END" && date < today) {
      setError("สิ้นสุดสถานะเงินเดือนย้อนหลังไม่ได้ กรุณาเลือกวันนี้หรือวันในอนาคต");
      return;
    }
    if (action === "RESUME" && periodState.resumeEarliestOn && date < periodState.resumeEarliestOn) {
      setError(`วันกลับมาคิดค่าแรงต้องไม่ก่อน ${formatThaiDate(periodState.resumeEarliestOn)}`);
      return;
    }
    const actionError = await onAction(action, date);
    if (actionError) {
      setError(formatPayrollUiError(actionError));
      return;
    }
    setActionDraft(null);
  }

  async function correctPeriodStart() {
    const correction = periodState.periodStartCorrection;
    if (!correction) return;
    setCorrectionError(null);
    if (!correctionDateValid) {
      setCorrectionError("กรุณาเลือกวันเริ่มที่ถูกต้องภายในช่วงที่กำหนด");
      return;
    }
    const correctionFailure = await onCorrectPeriodStart(correction.periodId, correctionDate);
    if (correctionFailure) {
      setCorrectionError(formatPayrollUiError(correctionFailure));
      return;
    }
    setCorrectionOpen(false);
  }

  async function cancelSchedule() {
    setError(null);
    const cancelError = await onCancel();
    if (cancelError) {
      setError(formatPayrollUiError(cancelError));
      return;
    }
    setCancelOpen(false);
  }

  return (
    <section className="rounded-xl border border-black/10 bg-white p-4 shadow-sm" aria-busy={saving}>
      <div>
        <h3 className="text-balance font-bold text-ink">จัดการการคิดค่าแรง</h3>
        <p className="mt-1 text-pretty text-sm text-ink/60">{userName}</p>
        <p className="mt-2 text-pretty text-sm font-semibold text-ink">
          {periodState.currentStatus === "ACTIVE" && current
            ? `สถานะปัจจุบัน: กำลังคิดค่าแรงตั้งแต่ ${formatThaiDate(current.startOn)}`
            : "สถานะปัจจุบัน: ไม่ได้คิดค่าแรง"}
        </p>
      </div>

      {latestPeriodStart && (
        <div className="mt-3 rounded-lg border border-black/10 bg-field/35 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-balance text-sm font-semibold text-ink">ช่วงทำงานล่าสุด</p>
              <p className="mt-1 text-pretty text-sm text-ink/65 tabular-nums">
                {formatThaiDate(latestPeriodStart)} – {latestPeriodEnd ? formatThaiDate(latestPeriodEnd) : "ปัจจุบัน"}
              </p>
            </div>
            {correction && (
              <button
                type="button"
                onClick={() => {
                  setCorrectionDate(correction.currentStartOn);
                  setCorrectionError(null);
                  setCorrectionOpen(true);
                }}
                disabled={saving || !online}
                className="focus-ring inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-river/30 bg-white px-3 text-sm font-semibold text-river hover:bg-river/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                แก้ไขวันเริ่ม
              </button>
            )}
          </div>
        </div>
      )}

      {periodState.nextAction && (
        <div className="mt-3 rounded-lg border border-amber/40 bg-amber/10 p-3" role="status">
          <div className="flex items-start gap-2">
            <Clock3 className="mt-0.5 shrink-0 text-amber" size={18} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-balance font-semibold text-ink">กำหนดไว้: {payrollPeriodActionLabel(periodState.nextAction.action)}</p>
              <p className="mt-1 text-pretty text-sm text-ink/70 tabular-nums">{scheduledActionText(
                periodState.nextAction.action,
                periodState.nextAction.selectedEffectiveOn,
                periodState.nextAction.activationOn,
              )}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openAction(periodState.nextAction!.action)}
              disabled={saving || !online}
              className="focus-ring inline-flex h-10 items-center rounded-md border border-amber/40 bg-white px-3 text-sm font-semibold text-amber hover:bg-amber/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              แก้กำหนดการ
            </button>
            <button
              type="button"
              onClick={() => { setError(null); setCancelOpen(true); }}
              disabled={saving || !online}
              className="focus-ring inline-flex h-10 items-center rounded-md border border-danger/30 bg-white px-3 text-sm font-semibold text-danger hover:bg-danger/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ยกเลิกกำหนดการ
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {actions.map((action) => (
          <div key={action} className="rounded-lg border border-black/10 bg-field/35 p-3">
            <button
              type="button"
              onClick={() => openAction(action)}
              disabled={saving || !online}
              className={cn(
                "focus-ring inline-flex min-h-10 w-full items-center justify-center rounded-md px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50",
                action === "END" && "bg-danger text-white hover:bg-danger/90",
                action === "PAUSE" && "border border-amber/40 bg-amber/10 text-amber hover:bg-amber/15",
                (action === "ENABLE" || action === "RESUME") && "bg-commit text-white hover:bg-commit/90",
              )}
            >
              {payrollPeriodActionLabel(action)}
            </button>
            <p className="mt-2 text-pretty text-xs leading-5 text-ink/65">{actionDescription(action)}</p>
          </div>
        ))}
      </div>

      {cancelOpen && periodState.nextAction && (
        <ModalShell
          title="ยกเลิกกำหนดการ"
          subtitle={`${payrollPeriodActionLabel(periodState.nextAction.action)} จะไม่เกิดขึ้นตามวันที่กำหนด`}
          onClose={() => { setError(null); setCancelOpen(false); }}
          nativeModal
          closeOnEscape
          closeDisabled={saving}
          renderInPortal
          role="alertdialog"
          size="compact"
        >
          <p className="text-pretty text-sm text-ink/70">
            {scheduledActionText(
              periodState.nextAction.action,
              periodState.nextAction.selectedEffectiveOn,
              periodState.nextAction.activationOn,
            )}
          </p>
          {error && <p id="period-action-error" role="alert" className="mt-3 text-sm font-semibold text-danger">{error}</p>}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => { setError(null); setCancelOpen(false); }} disabled={saving} className="focus-ring h-10 rounded-md border border-black/15 bg-white px-3 text-sm font-semibold text-ink hover:bg-field disabled:opacity-50">ไม่ยกเลิก</button>
            <button type="button" onClick={() => void cancelSchedule()} disabled={saving || !online} className="focus-ring h-10 rounded-md bg-danger px-3 text-sm font-bold text-white hover:bg-danger/90 disabled:opacity-50">ยืนยันยกเลิก</button>
          </div>
        </ModalShell>
      )}

      {actionDraft && (
        <ModalShell
          title={payrollPeriodActionLabel(actionDraft.action)}
          subtitle={`กำหนดให้ ${userName}`}
          onClose={() => { setError(null); setActionDraft(null); }}
          nativeModal
          closeOnEscape
          closeDisabled={saving}
          renderInPortal
          role={actionDraft.action === "END" ? "alertdialog" : "dialog"}
          size="compact"
        >
          <form onSubmit={(event) => { event.preventDefault(); void runAction(); }} aria-busy={saving}>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              {actionDateLabel(actionDraft.action)}
              <input
                type="date"
                value={actionDraft.date}
                min={actionDraft.action === "RESUME" ? periodState.resumeEarliestOn ?? undefined : actionDraft.action === "END" ? today : undefined}
                onChange={(event) => { setActionDraft({ ...actionDraft, date: event.target.value }); setError(null); }}
                className="focus-ring h-10 rounded-md border border-black/15 bg-white px-3 tabular-nums"
                aria-invalid={Boolean(error)}
                aria-describedby={`period-action-effect${error ? " period-action-error" : ""}`}
                required
              />
            </label>
            <p id="period-action-effect" className="mt-3 text-pretty text-sm text-ink/70">{effectText(actionDraft.action, actionDraft.date)}</p>
            {periodState.nextAction && (
              <div className="mt-3 rounded-md border border-amber/40 bg-amber/10 p-3 text-pretty text-sm text-ink/75">
                กำหนดการนี้จะแทนที่ “{payrollPeriodActionLabel(periodState.nextAction.action)} {formatThaiDate(periodState.nextAction.selectedEffectiveOn)}”
              </div>
            )}
            {error && <p id="period-action-error" role="alert" className="mt-3 text-pretty text-sm font-semibold text-danger">{error}</p>}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => { setError(null); setActionDraft(null); }} disabled={saving} className="focus-ring h-10 rounded-md border border-black/15 bg-white px-3 text-sm font-semibold text-ink hover:bg-field disabled:opacity-50">ยกเลิก</button>
              <button
                type="submit"
                disabled={saving || !online}
                className={cn(
                  "focus-ring min-h-10 rounded-md px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50",
                  actionDraft.action === "END" ? "bg-danger hover:bg-danger/90" : "bg-commit hover:bg-commit/90",
                )}
              >
                {periodState.nextAction ? "ยืนยันและแทนที่กำหนดเดิม" : `ยืนยัน${payrollPeriodActionLabel(actionDraft.action)}`}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {correctionOpen && correction && (
        <ModalShell
          title="แก้ไขวันเริ่มช่วงล่าสุด"
          subtitle={`${formatThaiDate(correction.currentStartOn)} → ${formatThaiDate(correctionDate)}`}
          onClose={() => { setCorrectionError(null); setCorrectionOpen(false); }}
          nativeModal
          closeOnEscape
          closeDisabled={saving}
          renderInPortal
          size="compact"
        >
          <div className="rounded-md border border-black/10 bg-field/35 p-3">
            <p className="text-balance text-sm font-semibold text-ink">ช่วงเดิม</p>
            <p className="mt-1 text-pretty text-sm text-ink/65 tabular-nums">
              {formatThaiDate(correction.currentStartOn)} – {correction.endOn ? formatThaiDate(correction.endOn) : "ปัจจุบัน"}
            </p>
          </div>
          <label className="mt-3 grid gap-1 text-sm font-semibold text-ink">
            วันเริ่มที่ถูกต้อง
            <input
              type="date"
              value={correctionDate}
              min={correction.earliestOn ?? undefined}
              max={correction.latestOn}
              onChange={(event) => { setCorrectionDate(event.target.value); setCorrectionError(null); }}
              className="focus-ring h-10 rounded-md border border-black/15 bg-white px-3 tabular-nums"
              aria-invalid={Boolean(correctionError)}
              aria-describedby={`period-start-correction-help${correctionError ? " period-start-correction-error" : ""}`}
            />
          </label>
          <p id="period-start-correction-help" className="mt-2 text-pretty text-xs leading-5 text-ink/60">
            เลือกได้{correction.earliestOn ? `ตั้งแต่ ${formatThaiDate(correction.earliestOn)}` : "ย้อนหลังเมื่อเดือนยังเปิด"} ถึง {formatThaiDate(correction.latestOn)}
          </p>
          {correctionDateValid && (
            <p className="mt-3 text-pretty text-sm text-ink/70">
              ระบบจะตรวจเดือนที่ได้รับผล: {affectedMonths(correction.currentStartOn, correctionDate).map(monthLabel).join(", ")} และจะไม่เปลี่ยนวันสิ้นสุด สลิป หรือรายการหักเงินจริง
            </p>
          )}
          {correctionError && <p id="period-start-correction-error" role="alert" className="mt-3 text-pretty text-sm font-semibold text-danger">{correctionError}</p>}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => { setCorrectionError(null); setCorrectionOpen(false); }} disabled={saving} className="focus-ring h-10 rounded-md border border-black/15 bg-white px-3 text-sm font-semibold text-ink hover:bg-field disabled:opacity-50">ยกเลิก</button>
            <button type="button" onClick={() => void correctPeriodStart()} disabled={saving || !online || !correctionDateValid} className="focus-ring min-h-10 rounded-md bg-commit px-3 py-2 text-sm font-bold text-white hover:bg-commit/90 disabled:cursor-not-allowed disabled:opacity-50">ยืนยันแก้ไขวันเริ่ม</button>
          </div>
        </ModalShell>
      )}
    </section>
  );
}
