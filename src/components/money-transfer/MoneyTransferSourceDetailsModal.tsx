"use client";

import { useQuery } from "@tanstack/react-query";

import { ModalShell } from "@/components/shared/ModalShell";
import { getMoneyTransferReceiptSourceDetails } from "@/hooks/useMoneyTransfers";
import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";
import { authFetch } from "@/lib/auth-fetch";
import type { MoneyTransfer } from "@/types";
import type { RubberExportDetails } from "@/types/rubber-exports";

const DECIMAL = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONEY = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" });

export function MoneyTransferSourceDetailsModal({
  transfer,
  onClose,
  nativeModal = false,
}: {
  transfer: MoneyTransfer;
  onClose: () => void;
  nativeModal?: boolean;
}) {
  const isWork = transfer.transferType === "rubber_export_work";
  const query = useQuery({
    queryKey: [...moneyFlowQueryKeys.moneyTransferDetail(transfer.id), "sourceDetails"],
    queryFn: () => getMoneyTransferReceiptSourceDetails(transfer.id),
    enabled: !isWork,
  });
  const workQuery = useQuery({
    queryKey: ["rubberExportDetail", transfer.rubberExportId],
    enabled: isWork && Boolean(transfer.rubberExportId),
    queryFn: async ({ signal }) => {
      const response = await authFetch(`/api/lanflow/rubber-exports/${transfer.rubberExportId}`, { cache: "no-store", signal });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "โหลดบิลค่าทำงานไม่สำเร็จ");
      }
      return response.json() as Promise<RubberExportDetails>;
    },
  });
  const rows = query.data ?? [];
  const total = (key: "netWeightAfterDeduction" | "rubberValue" | "deductedAmount" | "netPayableAmount") =>
    rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  const totalWeight = total("netWeightAfterDeduction");
  const totalRubberValue = total("rubberValue");
  const weightedAverage = totalWeight > 0 ? totalRubberValue / totalWeight : 0;

  return (
    <ModalShell
      title={isWork ? "รายละเอียดบิลค่าทำงาน" : "รายละเอียดต้นทางรายการโอนเงิน"}
      subtitle={isWork ? transfer.rubberExportNo ?? "รายการส่งออกยาง" : `${rows.length || transfer.sourceCount || 0} รายการ · ${transfer.customerName ?? transfer.transportStaffName ?? transfer.targetLocationName ?? "ไม่ระบุปลายทาง"}`}
      size="wide"
      closeOnEscape
      nativeModal={nativeModal}
      renderInPortal={nativeModal}
      onClose={onClose}
    >
      {isWork ? (
        !transfer.rubberExportId ? <p role="alert" className="text-sm text-danger">ไม่พบรายการส่งออกต้นทางของค่าทำงานนี้</p>
        : workQuery.isLoading ? <p role="status" className="text-sm text-ink/60">กำลังโหลดบิลค่าทำงาน…</p>
        : workQuery.error ? <p role="alert" className="text-sm text-danger">{workQuery.error instanceof Error ? workQuery.error.message : "โหลดบิลค่าทำงานไม่สำเร็จ"}</p>
        : workQuery.data && <WorkSourceDetails details={workQuery.data} />
      ) : query.isLoading ? (
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
                <td className="px-3 py-3">บิลยาง</td>
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

function WorkSourceDetails({ details }: { details: RubberExportDetails }) {
  return <div className="space-y-4">
    <div className="grid gap-3 rounded-md bg-field p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div><span className="text-ink/60">เลขที่ส่งออก / สาขา</span><strong className="block">{details.exportNo} · {details.locationName}</strong></div>
      <div><span className="text-ink/60">ค่าทำงานต่อกิโลกรัม</span><strong className="block tabular-nums">{MONEY.format(details.workRate ?? 0)}</strong></div>
      <div><span className="text-ink/60">ค่าใช้จ่ายอื่น</span><strong className="block tabular-nums">{MONEY.format(details.otherOperatingCost)}</strong></div>
      <div><span className="text-ink/60">รวมค่าทำงาน</span><strong className="block tabular-nums text-river">{MONEY.format(details.workTotal ?? 0)}</strong></div>
    </div>
    <div className="overflow-x-auto rounded-md border border-black/10">
      <table className="w-full whitespace-nowrap text-sm">
        <thead className="bg-field text-left text-xs font-bold text-ink/60"><tr>
          <th scope="col" className="px-3 py-3">เลขที่บิล</th><th scope="col" className="px-3 py-3">ลูกค้า</th>
          <th scope="col" className="px-3 py-3 text-right">น้ำหนักสุทธิ</th><th scope="col" className="px-3 py-3 text-right">มูลค่ายาง</th>
        </tr></thead>
        <tbody>{details.items.map((item) => <tr key={item.id} className="border-t border-black/5">
          <td className="px-3 py-3 font-mono">{item.billNo}</td><td className="px-3 py-3">{item.customerName}</td>
          <td className="px-3 py-3 text-right tabular-nums">{DECIMAL.format(item.netWeight)}</td>
          <td className="px-3 py-3 text-right tabular-nums">{MONEY.format(item.rubberValueAmount)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
