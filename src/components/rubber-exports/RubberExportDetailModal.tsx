"use client";

import { useMemo, useState } from "react";
import { Loader2, Share2 } from "lucide-react";
import { ModalShell } from "@/components/shared/ModalShell";
import {
  calculateWeightLossPercent,
  calculateWorkTotal,
  isValidCurrentWeight,
} from "@/lib/rubber-exports/calculations";
import type {
  RubberExportDetails,
  RubberExportExpenseDestination,
} from "@/types/rubber-exports";
import { formatRubberAge } from "@/lib/rubber-exports/rubber-export-presentation";

function number(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function nullableNumber(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

const previousStatusLabel = {
  draft: "ฉบับร่าง",
  verified: "ตรวจสอบแล้ว",
};

export function RubberExportDetailModal({
  details,
  canVerify,
  shareBusy,
  sharing,
  onSave,
  onVerify,
  onShare,
  onClose,
}: {
  details: RubberExportDetails;
  canVerify: boolean;
  shareBusy: boolean;
  sharing: boolean;
  onSave: (values: {
    currentWeight: number | null;
    workRate: number | null;
    otherOperatingCost: number;
  }) => Promise<void>;
  onVerify: (destination: RubberExportExpenseDestination, values: {
    currentWeight: number | null;
    workRate: number | null;
    otherOperatingCost: number;
  }) => Promise<void>;
  onShare: () => void;
  onClose: () => void;
}) {
  const [currentWeight, setCurrentWeight] = useState<number | null>(details.currentWeight ?? null);
  const [workRate, setWorkRate] = useState<number | null>(details.workRate ?? null);
  const [otherCost, setOtherCost] = useState(details.otherOperatingCost);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const isDraft = details.status === "draft";
  const weightValid = isValidCurrentWeight(details.originalWeightTotal, currentWeight);
  const workTotal = useMemo(
    () => calculateWorkTotal(details.originalWeightTotal, workRate, otherCost),
    [details.originalWeightTotal, workRate, otherCost]
  );
  const lossPercent = useMemo(
    () => currentWeight === null
      ? null
      : calculateWeightLossPercent(details.originalWeightTotal, currentWeight),
    [currentWeight, details.originalWeightTotal]
  );
  const values = { currentWeight, workRate, otherOperatingCost: otherCost };
  const verifyDisabledReason = !canVerify
    ? "รอ super_admin หรือผู้มีสิทธิ์จัดการระบบตรวจสอบรายการ"
    : !weightValid
      ? "กรุณากรอกน้ำหนักปัจจุบันให้ถูกต้อง"
      : workRate === null
        ? "กรุณากรอกค่าทำงาน"
        : null;

  async function verify(destination: RubberExportExpenseDestination) {
    setVerifying(true);
    try {
      await onVerify(destination, values);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <ModalShell
      title={details.exportNo}
      subtitle={`${details.locationName} · ${details.status === "draft" ? "ฉบับร่าง" : details.status === "verified" ? "ตรวจสอบแล้ว" : "ลบแล้ว"}`}
      onClose={onClose}
      size="wide"
    >
      <div className="space-y-5">
        {details.reportLockNo && (
          <div className="rounded-md bg-amber/20 px-4 py-3 text-sm font-semibold text-amber-900">
            รายการนี้ถูกล็อกโดยรายงาน {details.reportLockNo}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-5">
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">น้ำหนักสุทธิรวม</div><div className="font-bold tabular-nums">{number(details.originalWeightTotal)} กก.</div></div>
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">ยอดจ่ายจริงรวม</div><div className="font-bold tabular-nums">฿{number(details.paidTotal)}</div></div>
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">ต้นทุนซื้อเฉลี่ย</div><div className="font-bold tabular-nums">฿{number(details.averagePrice)}/กก.</div></div>
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">อายุเฉลี่ยถ่วงน้ำหนัก</div><div className="font-bold tabular-nums">{formatRubberAge(details.averageAgeHours)}</div></div>
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">อายุมากที่สุด</div><div className="font-bold tabular-nums">{formatRubberAge(details.oldestAgeHours)}</div></div>
        </div>

        <p className="text-pretty text-xs text-ink/55">
          คำนวณโดย Server ณ <span className="tabular-nums">{dateTime(details.ageCalculatedAt)}</span>
          {Boolean(details.estimatedAgeItemCount) && ` · มีอายุประมาณการ ${details.estimatedAgeItemCount} บิล`}
        </p>

        <div className="grid gap-3 sm:grid-cols-5">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink/70">น้ำหนักปัจจุบัน</span>
            <input
              type="number"
              min="0"
              max={details.originalWeightTotal}
              step="0.01"
              value={currentWeight ?? ""}
              readOnly={!isDraft}
              onChange={(event) => setCurrentWeight(nullableNumber(event.target.value))}
              className="focus-ring h-11 w-full rounded-md border border-black/10 px-3 read-only:bg-slate-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink/70">ค่าทำงาน/กก.</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={workRate ?? ""}
              readOnly={!isDraft}
              onChange={(event) => setWorkRate(nullableNumber(event.target.value))}
              className="focus-ring h-11 w-full rounded-md border border-black/10 px-3 read-only:bg-slate-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink/70">ค่าดำเนินการอื่น</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={otherCost}
              readOnly={!isDraft}
              onChange={(event) => setOtherCost(Math.max(0, Number(event.target.value || 0)))}
              className="focus-ring h-11 w-full rounded-md border border-black/10 px-3 read-only:bg-slate-100"
            />
          </label>
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">น้ำหนักหาย</div><div className="font-bold tabular-nums">{number(lossPercent)}%</div></div>
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">ยอดค่าทำงาน</div><div className="font-bold tabular-nums">฿{number(workTotal)}</div></div>
        </div>

        <p className="text-xs text-ink/55">
          ยอดค่าทำงาน = น้ำหนักสุทธิรวม × ค่าทำงาน/กก. + ค่าดำเนินการอื่น
        </p>

        {currentWeight !== null && !weightValid && (
          <p className="text-sm font-semibold text-red-600">
            น้ำหนักปัจจุบันต้องมากกว่า 0 และไม่เกิน {number(details.originalWeightTotal)} กก.
          </p>
        )}

        <div className="overflow-x-auto rounded-md border border-black/10">
          <table className="min-w-full text-sm">
            <thead className="bg-mint/50">
              <tr><th className="px-3 py-2 text-left">วันที่</th><th className="px-3 py-2 text-left">บิล</th><th className="px-3 py-2 text-left">ลูกค้า</th><th className="px-3 py-2 text-right">น้ำหนัก</th><th className="px-3 py-2 text-right">จ่ายจริง</th><th className="px-3 py-2 text-right">อายุยาง</th></tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {details.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">{item.billDate}</td>
                  <td className="px-3 py-2">{item.billNo}</td>
                  <td className="px-3 py-2">{item.customerName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{number(item.netWeight)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{number(item.paidAmount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatRubberAge(item.ageHours)}
                    {item.ageIsEstimated && <div className="text-xs text-amber-800">ประมาณการ</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="rounded-md border border-black/10 bg-sand p-4" aria-labelledby="rubber-export-audit-title">
          <h3 id="rubber-export-audit-title" className="text-balance font-bold text-ink">ประวัติรายการ</h3>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink/60">ผู้สร้าง</dt>
              <dd className="font-semibold text-ink">{details.createdByName || "—"} · <span className="tabular-nums">{dateTime(details.createdAt)}</span></dd>
            </div>
            <div>
              <dt className="text-ink/60">ผู้รับรอง</dt>
              <dd className="font-semibold text-ink">{details.verifiedByName || "—"} · <span className="tabular-nums">{dateTime(details.verifiedAt)}</span></dd>
            </div>
            <div>
              <dt className="text-ink/60">ปลายทางค่าใช้จ่าย</dt>
              <dd className="font-semibold text-ink">{details.expenseDestination === "branch" ? "ลงรายจ่ายสาขานี้" : details.expenseDestination === "external" ? "จ่ายภายนอก" : "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/60">สถานะก่อนลบ</dt>
              <dd className="font-semibold text-ink">{details.previousStatus ? previousStatusLabel[details.previousStatus] : "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-ink/60">ผู้ลบ</dt>
              <dd className="font-semibold text-ink">{details.deletedByName || "—"} · <span className="tabular-nums">{dateTime(details.deletedAt)}</span></dd>
            </div>
          </dl>
        </section>

        <div className="modal-actions flex flex-wrap justify-end gap-2">
          {(details.status === "verified" || details.status === "deleted") && (
            <button
              type="button"
              onClick={onShare}
              disabled={shareBusy}
              aria-label={`แชร์ PDF รายการส่งออกยาง ${details.exportNo}`}
              className="focus-ring inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              {sharing
                ? <Loader2 size={16} className="animate-spin" />
                : <Share2 size={16} />}
              {sharing ? "กำลังสร้าง PDF" : "แชร์ PDF"}
            </button>
          )}
          {isDraft && (
            <button
              type="button"
              disabled={saving || (currentWeight !== null && !weightValid)}
              onClick={() => {
                setSaving(true);
                void onSave(values).finally(() => setSaving(false));
              }}
              className="focus-ring inline-flex items-center gap-2 rounded-md bg-commit px-4 py-2 font-semibold text-white hover:bg-commit/90 disabled:opacity-50"
            >
              {saving && <Loader2 size={16} className="animate-spin" />} บันทึกร่าง
            </button>
          )}
          {isDraft && (
            <button
              type="button"
              disabled={Boolean(verifyDisabledReason) || verifying}
              title={verifyDisabledReason ?? "ตรวจสอบรายการ"}
              onClick={() => {
                if (!verifyDisabledReason) setShowVerify(true);
              }}
              className="focus-ring rounded-md bg-leaf px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {canVerify ? "ตรวจสอบแล้ว" : "รอผู้รับรอง"}
            </button>
          )}
        </div>

        {isDraft && verifyDisabledReason && (
          <p className="text-pretty text-right text-sm font-semibold text-ink/60">{verifyDisabledReason}</p>
        )}

        {showVerify && (
          <div className="rounded-md border border-leaf/30 bg-mint/30 p-4">
            <h3 className="font-bold">ยืนยันปลายทางค่าใช้จ่าย</h3>
            <p className="mt-1 text-sm text-ink/65">ยอดสุดท้าย ฿{number(workTotal)} เมื่อยืนยันแล้วจะแก้ไขไม่ได้</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={verifying}
                onClick={() => void verify("branch")}
                className="focus-ring rounded-md bg-leaf px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                ลงรายจ่ายสาขานี้
              </button>
              <button
                type="button"
                disabled={verifying}
                onClick={() => void verify("external")}
                className="focus-ring rounded-md bg-river px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                จ่ายภายนอก
              </button>
              <button type="button" onClick={() => setShowVerify(false)} className="focus-ring rounded-md bg-actionSecondary px-4 py-2 font-semibold text-white hover:bg-actionSecondary/90">ยกเลิก</button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
