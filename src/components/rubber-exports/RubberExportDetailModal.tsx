"use client";

import { useMemo, useState } from "react";
import { Loader2, Share2 } from "lucide-react";
import { ModalShell } from "@/components/shared/ModalShell";
import { RubberExportLoadingModal } from "@/components/rubber-exports/RubberExportLoadingModal";
import {
  calculatePurchaseCostIncludingWork,
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
  const [useTotalWeight, setUseTotalWeight] = useState(
    details.status === "draft" && details.currentWeight === details.originalWeightTotal
  );
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const isDraft = details.status === "draft";
  const weightValid = isValidCurrentWeight(details.originalWeightTotal, currentWeight);
  const workTotal = useMemo(
    () => calculateWorkTotal(details.originalWeightTotal, workRate, otherCost),
    [details.originalWeightTotal, workRate, otherCost]
  );
  const purchaseCost = calculatePurchaseCostIncludingWork(
    details.rubberValueTotal,
    workTotal,
    details.originalWeightTotal
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
    setVerifyError(null);
    setVerifying(true);
    try {
      await onVerify(destination, values);
      setShowVerify(false);
    } catch (error) {
      setVerifyError(error instanceof Error ? error.message : "ตรวจสอบรายการไม่สำเร็จ");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <>
      <ModalShell
        title={details.exportNo}
        subtitle={`${details.locationName} · ${details.status === "draft" ? "ฉบับร่าง" : "ตรวจสอบแล้ว"}`}
        onClose={onClose}
        closeDisabled={saving || verifying}
        size="wide"
      >
        <div className="space-y-5">
        {details.reportLockNo && (
          <div className="rounded-md bg-amber/20 px-4 py-3 text-sm font-semibold text-amber-900">
            รายการนี้ถูกล็อกโดยรายงาน {details.reportLockNo}
          </div>
        )}
        {details.receiptBillNo && (
          <div className="rounded-md bg-mint px-4 py-3 text-pretty text-sm font-semibold text-ink">
            รับเข้าแล้วที่ {details.receiptLocationName} · {details.receiptBillNo}
          </div>
        )}
        {details.soldOutAt && (
          <div className="rounded-md bg-amber px-4 py-3 text-pretty text-sm font-semibold text-white">
            ขายออกแล้ว · {details.soldOutByName || "—"} · <span className="tabular-nums">{dateTime(details.soldOutAt)}</span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-5">
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">น้ำหนักสุทธิรวม</div><div className="font-bold tabular-nums">{number(details.originalWeightTotal)} กก.</div></div>
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">ต้นทุนซื้อรวมค่าทำงาน</div><div className="font-bold tabular-nums">{purchaseCost.total === null ? "—" : `฿${number(purchaseCost.total)}`}</div></div>
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">ต้นทุนซื้อเฉลี่ยรวมค่าทำงาน</div><div className="font-bold tabular-nums">{purchaseCost.average === null ? "—" : `฿${number(purchaseCost.average)}/กก.`}</div></div>
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">อายุเฉลี่ยถ่วงน้ำหนัก</div><div className="font-bold tabular-nums">{formatRubberAge(details.averageAgeHours)}</div></div>
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">อายุมากที่สุด</div><div className="font-bold tabular-nums">{formatRubberAge(details.oldestAgeHours)}</div></div>
        </div>

        <p className="text-pretty text-xs text-ink/55">
          คำนวณโดย Server ณ <span className="tabular-nums">{dateTime(details.ageCalculatedAt)}</span>
          {Boolean(details.estimatedAgeItemCount) && ` · มีอายุประมาณการ ${details.estimatedAgeItemCount} บิล`}
        </p>

        {isDraft && (
          <label className="flex items-start gap-3 rounded-md border border-black/10 bg-field/60 p-3 text-ink">
            <input
              type="checkbox"
              checked={useTotalWeight}
              onChange={(event) => {
                const checked = event.target.checked;
                setUseTotalWeight(checked);
                if (checked) setCurrentWeight(details.originalWeightTotal);
              }}
              className="focus-ring mt-0.5 size-4 shrink-0 accent-leaf"
            />
            <span>
              <span className="block text-sm font-semibold">
                ใช้น้ำหนักสุทธิรวมเป็นน้ำหนักปัจจุบัน
              </span>
              <span className="mt-0.5 block text-pretty text-xs text-ink/60">
                ใช้เมื่อน้ำหนักไม่เปลี่ยน · น้ำหนักหาย 0%
              </span>
            </span>
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-5">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink/70">น้ำหนักปัจจุบัน</span>
            <input
              type="number"
              min="0"
              max={details.originalWeightTotal}
              step="0.01"
              value={currentWeight ?? ""}
              readOnly={!isDraft || useTotalWeight}
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
              <dt className="text-ink/60">สถานะขาย</dt>
              <dd className="font-semibold text-ink">
                {details.soldOutAt
                  ? <>ขายออกแล้ว · {details.soldOutByName || "—"} · <span className="tabular-nums">{dateTime(details.soldOutAt)}</span></>
                  : "—"}
              </dd>
            </div>
          </dl>
        </section>

        <div className="modal-actions flex flex-wrap justify-end gap-2">
          {details.status === "verified" && (
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
                setSaveError(null);
                setSaving(true);
                void onSave(values)
                  .catch((error) => {
                    setSaveError(error instanceof Error ? error.message : "บันทึกฉบับร่างไม่สำเร็จ");
                  })
                  .finally(() => setSaving(false));
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

        {isDraft && saveError && (
          <p role="alert" className="text-pretty text-right text-sm font-semibold text-red-600">{saveError}</p>
        )}

        {isDraft && showVerify && (
          <ModalShell
            role="alertdialog"
            title="ยืนยันปลายทางค่าใช้จ่าย"
            subtitle={`${details.exportNo} · ยอดค่าทำงาน ฿${number(workTotal)}`}
            onClose={() => setShowVerify(false)}
            closeDisabled={verifying}
            size="compact"
          >
            <p className="text-pretty text-sm font-semibold text-ink/70">
              เลือกปลายทางที่ถูกต้อง เมื่อยืนยันแล้วจะแก้ไขรายการนี้ไม่ได้
            </p>
            {verifyError && (
              <p role="alert" className="mt-3 text-pretty text-sm font-semibold text-red-600">{verifyError}</p>
            )}
            {verifying && (
              <p role="status" className="mt-3 inline-flex items-center gap-2 text-pretty text-sm font-semibold text-ink/70">
                <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />
                กำลังยืนยันรายการ
              </p>
            )}
            <div className="modal-actions mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={verifying}
                onClick={() => void verify("branch")}
                className="focus-ring rounded-md bg-leaf px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                ยืนยันลงรายจ่ายสาขานี้
              </button>
              <button
                type="button"
                disabled={verifying}
                onClick={() => void verify("external")}
                className="focus-ring rounded-md bg-river px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                ยืนยันจ่ายภายนอก
              </button>
              <button type="button" disabled={verifying} onClick={() => setShowVerify(false)} className="focus-ring rounded-md bg-actionSecondary px-4 py-2 font-semibold text-white hover:bg-actionSecondary/90 disabled:opacity-50">ยกเลิก</button>
            </div>
          </ModalShell>
        )}
        </div>
      </ModalShell>
      {saving && (
        <RubberExportLoadingModal
          title="กำลังบันทึกฉบับร่าง"
          message="ระบบกำลังบันทึกข้อมูลและอัปเดตตารางส่งออกยาง"
        />
      )}
    </>
  );
}
