"use client";

import { useMemo, type ReactNode } from "react";
import { FileUp } from "lucide-react";
import { toast } from "sonner";

import { ModalShell } from "@/components/shared/ModalShell";
import { SharePdfWaitingModal } from "@/components/shared/SharePdfWaitingModal";
import { useSharePdf } from "@/hooks/useSharePdf";
import { cn } from "@/lib/cn";
import { createReportPdfFile } from "@/lib/reports/report-pdf";
import {
  buildReportPresentation,
  formatMoney,
  formatQuantity,
  formatThaiDate,
  formatThaiDateTime,
  formatWholeMoney,
  reportShareTitle,
  reportStatusLabel,
  rubberBillTotals,
  type RubberBillRow,
} from "@/lib/reports/report-presentation";
import type { ReportDetails, ReportSummary } from "@/types/reports";

const cellClass = "whitespace-nowrap border-b border-black/10 px-3 py-2 text-left align-top";
const numberCellClass = `${cellClass} text-right tabular-nums`;
const headerClass = "whitespace-nowrap bg-mint/60 px-3 py-2 text-left font-bold text-ink";
const numberHeaderClass = `${headerClass} text-right`;

function ReportTable({
  children,
  minWidth = "min-w-[64rem]",
}: {
  children: ReactNode;
  minWidth?: string;
}) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-black/10">
      <table className={cn("w-full border-collapse text-sm tabular-nums", minWidth)}>{children}</table>
    </div>
  );
}

function EmptyRow({ columns }: { columns: number }) {
  return (
    <tr>
      <td colSpan={columns} className="px-3 py-6 text-center text-ink/50">ไม่มีรายการ</td>
    </tr>
  );
}

function TotalCell({ children, colSpan, className = "" }: {
  children?: ReactNode;
  colSpan?: number;
  className?: string;
}) {
  return (
    <td colSpan={colSpan} className={cn("bg-mint/35 px-3 py-2 font-bold text-ink", className)}>
      {children}
    </td>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-balance text-lg font-bold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function RubberBillTable({ rows }: { rows: RubberBillRow[] }) {
  const totals = rubberBillTotals(rows);

  return (
    <ReportTable minWidth="min-w-[78rem]">
      <thead>
        <tr>
          <th className={headerClass}>วันที่</th>
          <th className={headerClass}>เลขที่</th>
          <th className={headerClass}>ลูกค้า</th>
          <th className={headerClass}>ประเภท</th>
          <th className={numberHeaderClass}>น้ำหนักสุทธิ</th>
          <th className={numberHeaderClass}>ราคาเฉลี่ย</th>
          <th className={numberHeaderClass}>มูลค่ายาง</th>
          <th className={numberHeaderClass}>ยอดหักเงิน</th>
          <th className={numberHeaderClass}>ยอดที่ต้องจ่าย</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && <EmptyRow columns={9} />}
        {rows.map((row, index) => (
          <tr key={`${row.number}-${index}`}>
            <td className={cellClass}>{formatThaiDate(row.date)}</td>
            <td className={cellClass}>{row.number}</td>
            <td className={cellClass}>{row.customer}</td>
            <td className={cellClass}>{row.billType}</td>
            <td className={numberCellClass}>{formatQuantity(row.netWeight)}</td>
            <td className={numberCellClass}>{formatMoney(row.averagePrice)}</td>
            <td className={numberCellClass}>{formatMoney(row.rubberValue)}</td>
            <td className={numberCellClass}>{formatMoney(row.deduction)}</td>
            <td className={numberCellClass}>{formatWholeMoney(row.net)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <TotalCell colSpan={4}>รวม</TotalCell>
          <TotalCell className="text-right tabular-nums">{formatQuantity(totals.weight)}</TotalCell>
          <TotalCell className="text-right tabular-nums">{formatMoney(totals.weight > 0 ? totals.value / totals.weight : 0)}</TotalCell>
          <TotalCell className="text-right tabular-nums">{formatMoney(totals.value)}</TotalCell>
          <TotalCell className="text-right tabular-nums">{formatMoney(totals.deduction)}</TotalCell>
          <TotalCell className="text-right tabular-nums">{formatWholeMoney(totals.net)}</TotalCell>
        </tr>
      </tfoot>
    </ReportTable>
  );
}

function LoadingPreview() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดรายงาน">
      <p className="text-pretty text-sm font-semibold text-ink/60">กำลังโหลดรายงาน...</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="h-14 rounded-md bg-black/5" />
        ))}
      </div>
      <div className="h-10 rounded-md bg-mint/45" aria-hidden="true" />
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="h-9 rounded-md bg-black/5" />
        ))}
      </div>
    </div>
  );
}

export function ReportPreviewModal({
  report,
  details,
  error,
  online,
  onClose,
}: {
  report: ReportSummary;
  details: ReportDetails | null;
  error: string | null;
  online: boolean;
  onClose: () => void;
}) {
  const pdfShare = useSharePdf();

  const presentation = useMemo(
    () => details ? buildReportPresentation(details) : null,
    [details],
  );

  async function sharePdf() {
    if (!details || !online || pdfShare.busy) return;

    try {
      const delivery = await pdfShare.sharePdfFile(async (signal) => ({
        file: await createReportPdfFile(details, signal),
        title: reportShareTitle(details.report),
      }));
      if (delivery === "shared") {
        toast.success(`แชร์ ${details.report.reportNo} แล้ว`);
      } else if (delivery === "downloaded") {
        toast.info("อุปกรณ์นี้แชร์ไฟล์ไม่ได้ จึงดาวน์โหลด PDF แทนแล้ว");
      }
    } catch (shareError) {
      toast.error(shareError instanceof Error ? shareError.message : "สร้าง PDF รายงานไม่สำเร็จ");
    }
  }

  return (
    <>
      <ModalShell
        title={details ? "ชุดรายงาน LanFlow" : "พรีวิวรายงาน"}
        subtitle={details ? `${details.report.reportNo} · ${details.report.locationName}` : report.reportNo}
        onClose={onClose}
        size="wide"
        mobileFullScreen
      >
        {!details && !error && <LoadingPreview />}

        {error && (
          <div className="grid min-h-64 place-items-center px-4 text-center">
            <div>
              <h3 className="text-balance text-lg font-bold text-danger">โหลดรายงานไม่สำเร็จ</h3>
              <p className="mt-2 text-pretty text-sm font-semibold text-danger">{error}</p>
              <p className="mt-2 text-pretty text-sm text-ink/60">ปิดแล้วเปิดรายงานอีกครั้งเพื่อลองใหม่</p>
            </div>
          </div>
        )}

        {details && presentation && (
          <article className="mx-auto flex w-full max-w-7xl flex-col gap-6 text-ink">
            <div className="flex justify-end">
              <button
                type="button"
                aria-label="แชร์ PDF"
                onClick={() => void sharePdf()}
                disabled={pdfShare.busy || !online}
                title={online ? undefined : "รายงานใช้ได้เมื่อออนไลน์เท่านั้น"}
                className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg bg-river px-4 text-sm font-semibold text-white shadow-sm hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileUp size={17} />
                {pdfShare.busy ? "กำลังสร้าง PDF" : "แชร์ PDF"}
              </button>
            </div>

            <header className="rounded-lg border border-black/10 bg-sand p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-pretty text-sm font-semibold text-ink/60">รายงานสาขา {details.report.locationName}</p>
                  <h2 className="mt-1 text-balance text-2xl font-bold text-ink">{details.report.reportNo}</h2>
                </div>
                <span className="rounded-full bg-leaf/15 px-3 py-1 text-sm font-bold text-leaf">
                  {reportStatusLabel(details.report)}
                </span>
              </div>
              <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Cutoff", formatThaiDateTime(details.report.cutoffAt)],
                  ["ผู้สร้าง", details.report.createdByName],
                  ["สร้างเมื่อ", formatThaiDateTime(details.report.createdAt)],
                  ["จำนวน source", details.report.itemCount.toLocaleString("th-TH")],
                  ["ผลตรวจนับ", details.report.hasCashCount ? "มีผลตรวจนับเงินสด" : "ไม่มีผลตรวจนับเงินสด"],
                  ...(details.report.hasCashCount ? [
                    ["ผู้ตรวจนับ", details.report.cashCountCheckerName ?? "-"],
                    ["ตรวจนับเมื่อ", details.report.cashCountSubmittedAt ? formatThaiDateTime(details.report.cashCountSubmittedAt) : "-"],
                  ] : []),
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="font-semibold text-ink/55">{label}</dt>
                    <dd className="mt-0.5 break-words font-semibold tabular-nums text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </header>

            <Section title="1. บิลยาง">
              <div className="mt-4">
                <h4 className="text-balance font-bold text-ink">1.1 ผู้ค้าขาย</h4>
                <RubberBillTable rows={presentation.traderRubberBills} />
              </div>
              <div className="mt-5">
                <h4 className="text-balance font-bold text-ink">1.2 ชาวสวน</h4>
                <RubberBillTable rows={presentation.farmerRubberBills} />
              </div>
              <div>
                <h4 className="text-balance font-bold text-ink">1.3 ยางรับเข้าและยางคงเหลือภายในสาขา</h4>
                <RubberBillTable rows={presentation.branchReceiptRubberBills} />
              </div>
            </Section>

            <Section title="2. อ่านใบชั่ง">
              <ReportTable minWidth="min-w-[76rem]">
                <thead><tr><th className={headerClass}>วันที่</th><th className={headerClass}>เลขที่</th><th className={headerClass}>ลูกค้า</th><th className={headerClass}>ทะเบียน</th><th className={numberHeaderClass}>ชั่งเข้า</th><th className={numberHeaderClass}>ชั่งออก</th><th className={numberHeaderClass}>สุทธิ</th><th className={numberHeaderClass}>หัก</th><th className={numberHeaderClass}>คงเหลือ</th><th className={numberHeaderClass}>ยอดเงิน</th></tr></thead>
                <tbody>
                  {details.ocrTickets.length === 0 && <EmptyRow columns={10} />}
                  {details.ocrTickets.map((row, index) => <tr key={`${row.number}-${index}`}><td className={cellClass}>{formatThaiDate(row.date)}</td><td className={cellClass}>{row.number}</td><td className={cellClass}>{row.customer}</td><td className={cellClass}>{row.licensePlate}</td><td className={numberCellClass}>{formatQuantity(row.weightIn)}</td><td className={numberCellClass}>{formatQuantity(row.weightOut)}</td><td className={numberCellClass}>{formatQuantity(row.weightNet)}</td><td className={numberCellClass}>{formatQuantity(row.weightDeducted)}</td><td className={numberCellClass}>{formatQuantity(row.weightRemaining)}</td><td className={numberCellClass}>{formatMoney(row.amount)}</td></tr>)}
                </tbody>
                <tfoot><tr><TotalCell colSpan={6}>รวม</TotalCell><TotalCell className="text-right">{formatQuantity(presentation.totals.ocrNet)}</TotalCell><TotalCell /><TotalCell className="text-right">{formatQuantity(presentation.totals.ocrRemaining)}</TotalCell><TotalCell className="text-right">{formatMoney(presentation.totals.ocrAmount)}</TotalCell></tr></tfoot>
              </ReportTable>
            </Section>

            <Section title="3. รับ–จ่ายรวม">
              <ReportTable>
                <thead><tr><th className={headerClass}>วันที่</th><th className={headerClass}>เลขที่</th><th className={headerClass}>รายการ</th><th className={numberHeaderClass}>รายรับ</th><th className={numberHeaderClass}>รายจ่าย</th></tr></thead>
                <tbody>
                  {presentation.incomeExpense.length === 0 && <EmptyRow columns={5} />}
                  {presentation.incomeExpense.map((row, index) => <tr key={`${row.number}-${index}`}><td className={cellClass}>{formatThaiDate(row.date)}</td><td className={cellClass}>{row.number}</td><td className={cellClass}>{row.title}</td><td className={numberCellClass}>{row.income === null ? "" : formatMoney(row.income)}</td><td className={numberCellClass}>{row.expense === null ? "" : formatMoney(row.expense)}</td></tr>)}
                </tbody>
                <tfoot><tr><TotalCell colSpan={3}>รวม</TotalCell><TotalCell className="text-right">{formatMoney(presentation.totals.income)}</TotalCell><TotalCell className="text-right">{formatMoney(presentation.totals.expense)}</TotalCell></tr><tr><TotalCell colSpan={5} className="text-right text-base">ยอดคงเหลือสุทธิ {formatMoney(presentation.totals.balance)}</TotalCell></tr></tfoot>
              </ReportTable>
            </Section>

            <Section title="4. สต็อกสินค้า">
              <ReportTable>
                <thead><tr><th className={headerClass}>วันที่</th><th className={headerClass}>เลขที่</th><th className={headerClass}>สินค้า</th><th className={headerClass}>ประเภท</th><th className={numberHeaderClass}>จำนวนเคลื่อนไหว</th><th className={numberHeaderClass}>ยอดเงินประกอบ</th></tr></thead>
                <tbody>
                  {details.stock.length === 0 && <EmptyRow columns={6} />}
                  {details.stock.map((row, index) => <tr key={`${row.number}-${index}`}><td className={cellClass}>{formatThaiDate(row.date)}</td><td className={cellClass}>{row.number}</td><td className={cellClass}>{row.product}</td><td className={cellClass}>{row.type}</td><td className={numberCellClass}>{formatQuantity(row.quantity)}</td><td className={numberCellClass}>{formatMoney(row.amount)}</td></tr>)}
                </tbody>
                <tfoot><tr><TotalCell colSpan={4}>รวมการเคลื่อนไหว</TotalCell><TotalCell className="text-right">{formatQuantity(presentation.totals.stockQuantity)}</TotalCell><TotalCell className="text-right">{formatMoney(presentation.totals.stockAmount)}</TotalCell></tr></tfoot>
              </ReportTable>
              <p className="mt-3 text-pretty text-right text-sm font-bold tabular-nums text-ink">ยอดคงเหลือ ณ cutoff: {details.stockBalances.length === 0 ? "ไม่มีรายการ" : details.stockBalances.map((row) => `${row.product} ${formatQuantity(row.quantity)}`).join(" · ")}</p>
            </Section>

            <Section title="5. เวลาและเงินเดือน">
              <ReportTable minWidth="min-w-[70rem]">
                <thead><tr><th className={headerClass}>วันที่</th><th className={headerClass}>เลขที่</th><th className={headerClass}>ประเภท</th><th className={headerClass}>พนักงาน</th><th className={headerClass}>รายละเอียด</th><th className={numberHeaderClass}>ชั่วโมง/วัน</th><th className={numberHeaderClass}>จำนวนเงิน</th></tr></thead>
                <tbody>
                  {details.timePayroll.length === 0 && <EmptyRow columns={7} />}
                  {details.timePayroll.map((row, index) => <tr key={`${row.number}-${index}`}><td className={cellClass}>{formatThaiDate(row.date)}</td><td className={cellClass}>{row.number}</td><td className={cellClass}>{row.category}</td><td className={cellClass}>{row.employee}</td><td className={cellClass}>{row.detail}</td><td className={numberCellClass}>{row.quantity === null ? "-" : formatQuantity(row.quantity)}</td><td className={numberCellClass}>{row.amount === null ? "-" : formatMoney(row.amount)}</td></tr>)}
                </tbody>
                <tfoot><tr><TotalCell colSpan={7} className="text-right">เวลาทำงาน {formatQuantity(presentation.totals.workHours)} ชม. · ธุรกรรม/เงินเดือน {formatMoney(presentation.totals.payrollAmount)}</TotalCell></tr></tfoot>
              </ReportTable>
            </Section>

            <Section title="6. โอนเงิน (ธนาคารเท่านั้น)">
              <ReportTable minWidth="min-w-[72rem]">
                <thead><tr><th className={headerClass}>วันที่</th><th className={headerClass}>เลขที่</th><th className={headerClass}>ทิศทาง</th><th className={headerClass}>คู่รายการ</th><th className={headerClass}>สถานะ</th><th className={numberHeaderClass}>ยอดที่ต้องจ่าย</th><th className={numberHeaderClass}>ยอดสลิป</th><th className={numberHeaderClass}>ค่าธรรมเนียม</th><th className={numberHeaderClass}>สาขาจ่าย</th></tr></thead>
                <tbody>
                  {details.bankTransfers.length === 0 && <EmptyRow columns={9} />}
                  {details.bankTransfers.map((row, index) => <tr key={`${row.number}-${index}`}><td className={cellClass}>{formatThaiDate(row.date)}</td><td className={cellClass}>{row.number}</td><td className={cellClass}>{row.direction === "out" ? "ออก" : "เข้า"}</td><td className={cellClass}>{row.party}</td><td className={cellClass}>{row.status}</td><td className={numberCellClass}>{formatMoney(row.amount)}</td><td className={numberCellClass}>{formatMoney(row.slipAmount)}</td><td className={numberCellClass}>{formatMoney(row.fee)}</td><td className={numberCellClass}>{formatMoney(row.branchPaid)}</td></tr>)}
                </tbody>
                <tfoot><tr><TotalCell colSpan={5}>รวม</TotalCell><TotalCell className="text-right">{formatMoney(presentation.totals.transferAmount)}</TotalCell><TotalCell className="text-right">{formatMoney(presentation.totals.slipAmount)}</TotalCell><TotalCell className="text-right">{formatMoney(presentation.totals.fee)}</TotalCell><TotalCell className="text-right">{formatMoney(presentation.totals.branchPaid)}</TotalCell></tr></tfoot>
              </ReportTable>
            </Section>
          </article>
        )}
      </ModalShell>
      <SharePdfWaitingModal open={pdfShare.waiting} onCancel={pdfShare.cancel} />
    </>
  );
}
