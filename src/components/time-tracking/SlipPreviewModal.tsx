"use client";

import { useEffect, useState } from "react";
import { FileUp, LoaderCircle } from "lucide-react";

import { useSharePdf } from "@/hooks/useSharePdf";
import { authFetch } from "@/lib/auth-fetch";
import { cn } from "@/lib/cn";
import { createTimePayrollSlipPdfFile } from "@/lib/time-tracking/slip-pdf";
import type { SlipDocumentRow, TimePayrollSlipDocument } from "@/lib/time-tracking/slip-document";
import { ModalShell } from "@/components/shared/ModalShell";
import { SharePdfWaitingModal } from "@/components/shared/SharePdfWaitingModal";

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  dateStyle: "medium",
  timeStyle: "short",
});
const moneyFormatter = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });

function displayDate(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : "-";
}

function DocumentRows({ rows }: { rows: SlipDocumentRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-ink/50">ไม่มีรายการ</p>;

  return (
    <div className="divide-y divide-black/10 rounded-lg border border-black/10">
      {rows.map((row) => (
        <div key={row.id} className="flex items-start justify-between gap-4 px-3 py-2 text-sm">
          <div className="min-w-0">
            <p className="font-semibold text-ink">{row.label}</p>
            {row.description && <p className="text-pretty text-xs text-ink/60">{row.description}</p>}
          </div>
          <p className="shrink-0 font-semibold tabular-nums text-ink">{moneyFormatter.format(row.amount)} บาท</p>
        </div>
      ))}
    </div>
  );
}

export function SlipPreviewModal({
  sourceType,
  sourceId,
  online,
  onClose,
}: {
  sourceType: "withdrawal" | "payroll";
  sourceId: string;
  online: boolean;
  onClose: () => void;
}) {
  const [document, setDocument] = useState<TimePayrollSlipDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pdfShare = useSharePdf();

  useEffect(() => {
    const controller = new AbortController();
    setDocument(null);
    setError(null);
    void authFetch(`/api/lanflow/time-tracking/documents/${sourceType}/${sourceId}`, {
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "โหลดเอกสารไม่สำเร็จ");
      }
      setDocument(await response.json() as TimePayrollSlipDocument);
    }).catch((fetchError) => {
      if (fetchError instanceof Error && fetchError.name === "AbortError") return;
      setError(fetchError instanceof Error ? fetchError.message : "โหลดเอกสารไม่สำเร็จ");
    });
    return () => controller.abort();
  }, [sourceId, sourceType]);

  async function sharePdf() {
    if (!document || !online) return;
    try {
      await pdfShare.sharePdfFile(async (signal) => ({
        file: await createTimePayrollSlipPdfFile(document, signal),
        title: document.title,
      }));
    } catch (shareError) {
      console.error("Failed to share time/payroll PDF:", shareError);
      alert("สร้างหรือแชร์ PDF ไม่สำเร็จ");
    }
  }

  const metadata = document ? [
    { label: "ชื่อพนักงาน", value: document.employeeName },
    { label: "เดือน", value: document.month },
    ...(document.amount == null ? [] : [{ label: "ยอดเบิก", value: `${moneyFormatter.format(document.amount)} บาท` }]),
    ...(document.effectiveDate ? [{ label: "วันที่รายการ", value: displayDate(`${document.effectiveDate}T00:00:00+07:00`) }] : []),
    { label: "วันที่สร้างคำขอ/สลิป", value: displayDate(document.createdAt) },
    ...(document.description ? [{ label: "รายละเอียด", value: document.description }] : []),
    { label: "รหัสอ้างอิง", value: document.sourceId },
    ...(document.approverName ? [{ label: "ผู้อนุมัติ", value: document.approverName }] : []),
    ...(document.approvedAt ? [{ label: "วันที่อนุมัติ", value: displayDate(document.approvedAt) }] : []),
    ...(document.paymentLabel ? [{ label: "วิธีจ่าย", value: document.paymentLabel }] : []),
    ...(document.adminComment ? [{ label: "หมายเหตุผู้อนุมัติ", value: document.adminComment }] : []),
    { label: "สร้างเอกสารเมื่อ", value: displayDate(document.generatedAt) },
  ] : [];

  return (
    <>
      <ModalShell
        title={document?.title || "พรีวิวเอกสาร"}
        subtitle={document ? `${document.statusLabel} · ${document.employeeName}` : undefined}
        onClose={onClose}
        size="wide"
        mobileFullScreen
        nativeModal
        closeOnEscape
        closeDisabled={pdfShare.busy}
      >
        {!document && !error && (
          <div className="grid min-h-64 place-items-center text-ink/60" role="status">
            <div className="flex items-center gap-2">
              <LoaderCircle className="animate-spin motion-reduce:animate-none" size={20} aria-hidden="true" />
              กำลังโหลดเอกสาร...
            </div>
          </div>
        )}
        {error && (
          <div className="grid min-h-64 place-items-center px-4 text-center">
            <p className="text-pretty font-semibold text-danger">{error}</p>
          </div>
        )}
        {document && (
          <div className="mx-auto flex max-w-[210mm] flex-col gap-3">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void sharePdf()}
                disabled={pdfShare.busy || !online}
                title={online ? undefined : "เอกสารใช้ได้เมื่อออนไลน์เท่านั้น"}
                className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg bg-river px-4 text-sm font-semibold text-white shadow-sm hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileUp size={17} aria-hidden="true" />
                แชร์ PDF
              </button>
            </div>

            <article className="min-h-[297mm] w-full bg-white px-4 py-6 text-ink shadow-sm ring-1 ring-black/10 sm:px-8 sm:py-9">
              <header className="border-b-2 border-ink pb-5 text-center">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <strong>LanFlow</strong>
                  <span className={cn(
                    "rounded-full px-3 py-1 font-semibold",
                    document.status === "APPROVED" ? "bg-leaf/15 text-leaf" : "bg-amber/15 text-amber",
                  )}>
                    {document.statusLabel}
                  </span>
                </div>
                <h3 className="mt-5 text-balance text-2xl font-bold sm:text-3xl">{document.title}</h3>
              </header>

              <section className="mt-6">
                <h4 className="rounded-md bg-mint/55 px-3 py-2 font-bold">ข้อมูลเอกสาร</h4>
                <dl className="divide-y divide-black/10">
                  {metadata.map((item) => (
                    <div key={item.label} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[13rem_1fr] sm:gap-4">
                      <dt className="font-semibold text-ink/60">{item.label}</dt>
                      <dd className="min-w-0 break-words font-medium tabular-nums sm:text-right">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="mt-6">
                <h4 className="rounded-md bg-mint/55 px-3 py-2 font-bold">
                  {document.kind === "withdrawal" ? "สรุปค่าแรงประกอบการเบิกเงิน" : "สรุปเงินเดือน"}
                </h4>
                <dl className="divide-y divide-black/10">
                  {document.summary.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                      <dt className="text-ink/65">{item.label}</dt>
                      <dd className="shrink-0 font-bold tabular-nums">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="mt-6">
                <h4 className="rounded-md bg-mint/55 px-3 py-2 font-bold">ตารางการทำงาน เดือน {document.month}</h4>
                <div className="mt-3 grid grid-cols-7 text-center text-xs font-semibold text-ink/65" aria-hidden="true">
                  {['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'].map((day) => <span key={day}>{day}</span>)}
                </div>
                <div className="mt-2 grid grid-cols-7 gap-1">
                  {Array.from({ length: new Date(`${document.month}-01T00:00:00+07:00`).getDay() }, (_, index) => (
                    <span key={`blank-${index}`} aria-hidden="true" />
                  ))}
                  {document.calendar.map((day) => (
                    <div
                      key={day.date}
                      aria-label={`${day.date}${day.paidDays > 0 ? ` ทำงาน ${moneyFormatter.format(day.paidDays)} วัน` : " ไม่ได้ทำงาน"}`}
                      className={cn(
                        "flex min-h-11 flex-col items-center justify-center rounded-md border text-xs font-semibold tabular-nums",
                        day.paidDays >= 1 && "border-leaf bg-leaf text-white",
                        day.paidDays > 0 && day.paidDays < 1 && "border-leaf/40 bg-leaf/20 text-leaf",
                        day.paidDays <= 0 && "border-black/10 text-ink/35",
                      )}
                    >
                      <span>{day.day}</span>
                      {day.paidDays > 0 && day.paidDays < 1 && <span className="text-[10px]">{moneyFormatter.format(day.paidDays)} วัน</span>}
                    </div>
                  ))}
                </div>
              </section>

              {document.kind === "payroll" && (
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <section>
                    <h4 className="mb-2 rounded-md bg-mint/55 px-3 py-2 font-bold">รายการหักเงิน</h4>
                    <DocumentRows rows={document.deductionRows} />
                  </section>
                  <section>
                    <h4 className="mb-2 rounded-md bg-mint/55 px-3 py-2 font-bold">รายการหนี้สินและเบิกเงิน</h4>
                    <DocumentRows rows={document.sourceRows} />
                  </section>
                </div>
              )}

              <p className="mt-7 text-pretty rounded-md bg-mint/40 p-3 text-sm text-ink/65">{document.notice}</p>
            </article>
          </div>
        )}
      </ModalShell>
      <SharePdfWaitingModal open={pdfShare.waiting} onCancel={pdfShare.cancel} />
    </>
  );
}
