import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { ModalShell } from "@/components/shared/ModalShell";
import { bangkokDateString } from "@/lib/bangkok-date";
import { cn } from "@/lib/cn";
import type { PayrollPeriodAction, PayrollPeriodStateDto } from "@/lib/time-tracking/attendance-contract";
import { formatThaiDate, monthLabel, payrollPeriodActionLabel, shiftMonth } from "../display";

function previousDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0, 10);
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
function scheduledActionText(action: PayrollPeriodAction, selectedDate: string, activationDate: string) {
  const summary = action === "END"
    ? `วันที่สิ้นสุดสถานะเงินเดือน ${formatThaiDate(selectedDate)} · คิดค่าแรงถึง ${formatThaiDate(previousDate(selectedDate))}`
    : `${actionDateLabel(action)} ${formatThaiDate(selectedDate)} เวลา 00:00`;
  return selectedDate === activationDate ? summary : `${summary} · สถานะเปลี่ยนจริง ${formatThaiDate(activationDate)} เวลา 00:00`;
}
function formatPayrollUiError(message: string) {
  return message.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => formatThaiDate(date))
    .replace(/\b\d{4}-\d{2}\b/g, (month) => monthLabel(month))
    .replaceAll("เปิดใช้เงินเดือน", "เริ่มคิดค่าแรง").replaceAll("กลับเข้าทำงาน", "กลับมาคิดค่าแรง")
    .replaceAll("พักงาน", "พักคิดค่าแรง").replaceAll("สิ้นสุดงาน", "สิ้นสุดสถานะเงินเดือน")
    .replaceAll("เปลี่ยนสถานะเงินเดือน", "เปลี่ยนสถานะการคิดค่าแรง");
}
function affectedMonths(firstDate: string, secondDate: string) {
  const [startDate, endExclusive] = firstDate <= secondDate ? [firstDate, secondDate] : [secondDate, firstDate];
  const affectedEnd = new Date(`${endExclusive}T00:00:00Z`); affectedEnd.setUTCDate(affectedEnd.getUTCDate() - 1);
  const start = startDate.slice(0, 7); const end = affectedEnd.toISOString().slice(0, 7); const months: string[] = [];
  for (let month = start; month <= end; month = shiftMonth(month, 1)) months.push(month);
  return months;
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

