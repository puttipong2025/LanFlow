"use client";

import type { MoneyTransfer, OcrTicket, RubberBill } from "@/types";
import { cn } from "@/lib/cn";
import { buildMoneyTransferSourceDetails } from "@/lib/money-transfers/source-details";
import { ModalShell } from "@/components/shared/ModalShell";

const DECIMAL_FORMATTER = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MONEY_FORMATTER = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function decimal(value: number | null) {
  return value == null ? "—" : DECIMAL_FORMATTER.format(value);
}

function money(value: number | null) {
  return value == null ? "—" : MONEY_FORMATTER.format(value);
}

export function MoneyTransferSourceDetailsModal({
  transfer,
  rubberBills,
  ocrTickets,
  isLoading,
  isError,
  onClose,
}: {
  transfer: MoneyTransfer;
  rubberBills: RubberBill[];
  ocrTickets: OcrTicket[];
  isLoading: boolean;
  isError: boolean;
  onClose: () => void;
}) {
  const details = buildMoneyTransferSourceDetails({
    items: transfer.items ?? [],
    rubberBills,
    ocrTickets,
  });

  return (
    <ModalShell
      title="รายละเอียดต้นทางรายการโอนเงิน"
      subtitle={`${details.rows.length} รายการ · ${transfer.customerName ?? transfer.transportStaffName ?? transfer.targetLocationName ?? "ไม่ระบุปลายทาง"}`}
      size="wide"
      closeOnEscape
      onClose={onClose}
    >
      {isLoading ? (
        <div aria-label="กำลังโหลดรายละเอียดต้นทาง" className="space-y-2">
          <div className="h-10 rounded-md bg-field" />
          <div className="h-14 rounded-md bg-field" />
          <div className="h-14 rounded-md bg-field" />
        </div>
      ) : isError ? (
        <div role="alert" className="rounded-md border border-clay/30 bg-clay/10 px-4 py-3 text-pretty text-sm font-semibold text-clay">
          โหลดรายละเอียดต้นทางไม่สำเร็จ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง
        </div>
      ) : (
        <div className="space-y-3">
          {details.totals.missingCount > 0 && (
            <div role="alert" className="rounded-md border border-amber/30 bg-amber/10 px-4 py-3 text-pretty text-sm font-semibold text-amber">
              ไม่พบข้อมูลต้นทาง {details.totals.missingCount} รายการ จึงไม่รวมรายการดังกล่าวในยอดรวม
            </div>
          )}

          <div data-testid="source-details-scroll" className="overflow-x-auto rounded-lg border border-black/10">
            <table className="min-w-full whitespace-nowrap text-sm">
              <thead>
                <tr className="border-b border-black/10 bg-field/60 text-left text-xs font-bold text-ink/60">
                  <th className="px-3 py-3">ประเภท</th>
                  <th className="px-3 py-3">เลขที่บิล/ใบชั่ง</th>
                  <th className="px-3 py-3 text-right">น้ำหนักสุทธิ</th>
                  <th className="px-3 py-3 text-right">ราคาเฉลี่ย</th>
                  <th className="px-3 py-3 text-right">มูลค่ายาง</th>
                  <th className="px-3 py-3 text-right">ยอดหักเงิน (บาท)</th>
                  <th className="px-3 py-3 text-right">ยอดที่ต้องจ่ายลูกค้า</th>
                </tr>
              </thead>
              <tbody>
                {details.rows.map((row) => (
                  <tr key={`${row.sourceType}:${row.sourceId}`} data-source-id={row.sourceId} className="border-b border-black/5 last:border-b-0">
                    <td className="px-3 py-3">
                      <span className={cn(
                        "inline-flex rounded-full bg-river/10 px-2 py-0.5 text-xs font-bold text-river",
                        row.isMissing && "bg-clay/10 text-clay",
                      )}>
                        {row.sourceLabel}
                      </span>
                    </td>
                    <td className={cn("px-3 py-3 font-mono font-semibold text-ink", row.isMissing && "font-sans text-clay")}>
                      {row.sourceNumber}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{decimal(row.netWeight)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(row.averagePrice)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(row.rubberValue)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(row.deductedAmount)}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-river">{money(row.netPayableAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-black/10 bg-sand font-bold text-ink">
                  <td colSpan={2} className="px-3 py-3">รวม</td>
                  <td className="px-3 py-3 text-right tabular-nums">{decimal(details.totals.netWeight)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{money(details.totals.averagePrice)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{money(details.totals.rubberValue)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{money(details.totals.deductedAmount)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-river">{money(details.totals.netPayableAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
