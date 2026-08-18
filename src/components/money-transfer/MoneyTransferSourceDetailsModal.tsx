"use client";

import { useQuery } from "@tanstack/react-query";

import { ModalShell } from "@/components/shared/ModalShell";
import { getMoneyTransferReceiptSourceDetails } from "@/hooks/useMoneyTransfers";
import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";
import type { MoneyTransfer } from "@/types";

const DECIMAL = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONEY = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" });

export function MoneyTransferSourceDetailsModal({
  transfer,
  onClose,
}: {
  transfer: MoneyTransfer;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: [...moneyFlowQueryKeys.moneyTransferDetail(transfer.id), "sourceDetails"],
    queryFn: () => getMoneyTransferReceiptSourceDetails(transfer.id),
  });
  const rows = query.data ?? [];
  const total = (key: "netWeightAfterDeduction" | "rubberValue" | "deductedAmount" | "netPayableAmount") =>
    rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  const totalWeight = total("netWeightAfterDeduction");
  const totalRubberValue = total("rubberValue");
  const weightedAverage = totalWeight > 0 ? totalRubberValue / totalWeight : 0;

  return (
    <ModalShell
      title="รายละเอียดต้นทางรายการโอนเงิน"
      subtitle={`${rows.length || transfer.sourceCount || 0} รายการ · ${transfer.customerName ?? transfer.transportStaffName ?? transfer.targetLocationName ?? "ไม่ระบุปลายทาง"}`}
      size="wide"
      closeOnEscape
      onClose={onClose}
    >
      {query.isLoading ? (
        <p role="status" aria-label="กำลังโหลดรายละเอียดต้นทาง" className="rounded-md bg-field px-4 py-6 text-center text-sm text-ink/60">กำลังโหลดรายละเอียดต้นทาง...</p>
      ) : query.error ? (
        <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm font-semibold text-danger">
          {query.error instanceof Error ? query.error.message : "โหลดรายละเอียดต้นทางไม่สำเร็จ"}
        </p>
      ) : (
        <div data-testid="source-details-scroll" className="overflow-x-auto rounded-md border border-black/10">
          <table className="min-w-[900px] whitespace-nowrap text-sm">
            <thead className="bg-field text-left text-xs font-bold text-ink/60">
              <tr><th className="px-3 py-3">ประเภท</th><th className="px-3 py-3">เลขที่บิล/ใบชั่ง</th><th className="px-3 py-3 text-right">น้ำหนักสุทธิ</th>
                <th className="px-3 py-3 text-right">ราคาเฉลี่ย</th><th className="px-3 py-3 text-right">มูลค่ายาง</th>
                <th className="px-3 py-3 text-right">ยอดหักเงิน (บาท)</th><th className="px-3 py-3 text-right">ยอดที่ต้องจ่ายลูกค้า</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => <tr key={row.id} data-source-id={row.sourceId} className="border-t border-black/5">
                <td className="px-3 py-3">{row.sourceType === "rubber_bill" ? "บิลยาง" : "OCR"}</td>
                <td className="px-3 py-3 font-mono font-semibold">{row.sourceNumber ?? "—"}</td>
                <td className="px-3 py-3 text-right tabular-nums">{DECIMAL.format(row.netWeightAfterDeduction ?? 0)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{row.averagePrice == null ? "—" : MONEY.format(row.averagePrice)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{MONEY.format(row.rubberValue ?? 0)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{MONEY.format(row.deductedAmount ?? 0)}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-river">{MONEY.format(row.netPayableAmount ?? 0)}</td>
              </tr>)}
            </tbody>
            <tfoot className="border-t border-black/10 bg-sand font-bold">
              <tr><td colSpan={2} className="px-3 py-3">รวม</td>
                <td className="px-3 py-3 text-right tabular-nums">{DECIMAL.format(totalWeight)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{MONEY.format(weightedAverage)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{MONEY.format(totalRubberValue)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{MONEY.format(total("deductedAmount"))}</td>
                <td className="px-3 py-3 text-right tabular-nums text-river">{MONEY.format(total("netPayableAmount"))}</td></tr>
            </tfoot>
          </table>
        </div>
      )}
    </ModalShell>
  );
}
