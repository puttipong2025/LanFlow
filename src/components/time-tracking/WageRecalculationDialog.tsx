"use client";

import { AlertTriangle } from "lucide-react";

import { AlertDialog } from "@/components/shared/AlertDialog";
import {
  formatDailyWageCurrency,
  formatPayrollCurrency,
} from "@/lib/time-tracking/format";

export type WageRecalculationMonth = {
  month: string;
  closed: boolean;
  slipStatus: string | null;
  paidDays: number | null;
  grossPay: number | null;
  oldDeduction: number;
  newDeduction: number;
  delta: number;
  restoredAmount: number;
  additionalDeduction: number;
};

export type WageRecalculationPreview = {
  profileId: string;
  oldWage: number;
  newWage: number;
  throughMonth: string;
  noOp: boolean;
  digest: string;
  months: WageRecalculationMonth[];
  totals: {
    oldDeduction: number;
    newDeduction: number;
    delta: number;
    restoredAmount: number;
    additionalDeduction: number;
  };
};

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("th-TH", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(new Date(`${month}-01T00:00:00+07:00`));
}

export function WageRecalculationDialog({
  open,
  employeeName,
  preview,
  busy,
  error,
  onCancel,
  onConfirm,
  onClosed,
}: {
  open: boolean;
  employeeName: string;
  preview: WageRecalculationPreview;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onClosed: () => void;
}) {
  const affectedMonths = preview.months.filter((month) => (
    !month.closed
    && (month.oldDeduction > 0 || month.newDeduction > 0 || month.delta !== 0)
  ));

  return (
    <AlertDialog
      open={open}
      title={`ตรวจยอดก่อนแก้ค่าแรงของ ${employeeName}`}
      description="ค่าแรงใหม่จะใช้กับทุกเดือนที่ยังไม่มีสลิป PENDING หรือ APPROVED ระบบจะคืนยอดจัดสรรเดิมแล้วคำนวณหนี้และเงินเบิกใหม่เมื่อยืนยัน"
      confirmLabel="ยืนยันแก้ค่าแรง"
      busy={busy}
      confirmClassName="bg-commit"
      onCancel={onCancel}
      onConfirm={onConfirm}
      onClosed={onClosed}
    >
      <div className="mt-4 space-y-4">
        {preview.newWage === 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <AlertTriangle className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
            <p className="text-pretty">ค่าแรงใหม่เป็น 0 บาท ยอดหักของเดือนเปิดทั้งหมดจะถูกคืนเป็นยอดค้าง</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-black/10 bg-field p-3">
            <p className="text-pretty text-xs text-ink/60">ค่าแรงเดิม</p>
            <p className="mt-1 font-bold tabular-nums text-ink">{formatDailyWageCurrency(preview.oldWage)}</p>
          </div>
          <div className="rounded-md border border-leaf/20 bg-mint p-3">
            <p className="text-pretty text-xs text-ink/60">ค่าแรงใหม่</p>
            <p className="mt-1 font-bold tabular-nums text-leaf">{formatDailyWageCurrency(preview.newWage)}</p>
          </div>
        </div>

        <div className="rounded-md border border-black/10 p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ink/65">ยอดหักเดือนเปิดเดิม</span>
            <strong className="shrink-0 tabular-nums">{formatPayrollCurrency(preview.totals.oldDeduction)}</strong>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-sm">
            <span className="text-ink/65">ยอดหักหลังคำนวณใหม่</span>
            <strong className="shrink-0 tabular-nums text-leaf">{formatPayrollCurrency(preview.totals.newDeduction)}</strong>
          </div>
          {preview.totals.additionalDeduction > 0 && (
            <p className="mt-2 text-pretty text-sm font-semibold text-clay tabular-nums">
              หักเพิ่ม {formatPayrollCurrency(preview.totals.additionalDeduction)}
            </p>
          )}
          {preview.totals.restoredAmount > 0 && (
            <p className="mt-2 text-pretty text-sm font-semibold text-river tabular-nums">
              คืนเป็นยอดค้าง {formatPayrollCurrency(preview.totals.restoredAmount)}
            </p>
          )}
        </div>

        {affectedMonths.length > 0 ? (
          <div className="max-h-56 overflow-y-auto rounded-md border border-black/10" role="region" aria-label="ยอดหักก่อนและหลังรายเดือน" tabIndex={0}>
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white text-ink/60">
                <tr className="border-b border-black/10">
                  <th className="p-2 font-semibold">เดือน</th>
                  <th className="p-2 text-right font-semibold">เดิม</th>
                  <th className="p-2 text-right font-semibold">ใหม่</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {affectedMonths.map((month) => (
                  <tr key={month.month}>
                    <td className="p-2 text-pretty">{monthLabel(month.month)}</td>
                    <td className="p-2 text-right tabular-nums">{formatPayrollCurrency(month.oldDeduction)}</td>
                    <td className="p-2 text-right font-semibold tabular-nums">{formatPayrollCurrency(month.newDeduction)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-md border border-black/10 bg-field p-3">
            <p className="text-pretty text-sm font-semibold text-ink">ไม่มีหนี้หรือเงินเบิกในเดือนเปิดที่ต้องจัดสรรใหม่</p>
            <p className="mt-1 text-pretty text-xs text-ink/60">ยืนยันเพื่อเปลี่ยนเฉพาะค่าแรงรายวัน</p>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-pretty text-sm font-semibold text-rose-700">
            {error}
          </p>
        )}
      </div>
    </AlertDialog>
  );
}
