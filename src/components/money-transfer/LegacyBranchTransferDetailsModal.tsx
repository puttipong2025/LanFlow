"use client";

import { ModalShell } from "@/components/shared/ModalShell";
import { formatBangkokDateTime } from "@/lib/bangkok-date";
import type { Location, MoneyTransfer } from "@/types";

const MONEY = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function LegacyBranchTransferDetailsModal({
  transfer,
  locations,
  onClose,
}: {
  transfer: MoneyTransfer;
  locations: Location[];
  onClose: () => void;
}) {
  const locationName = (id?: string | null) => (
    locations.find((location) => location.id === id)?.name ?? "ไม่ระบุสาขา"
  );

  return (
    <ModalShell
      title="รายละเอียดรายการโอนระหว่างสาขารุ่นเดิม"
      subtitle="ข้อมูลอ่านอย่างเดียว"
      size="wide"
      closeOnEscape
      onClose={onClose}
    >
      <div className="space-y-4">
        <p role="note" className="rounded-md border border-amber/25 bg-amber/10 px-4 py-3 text-sm font-semibold text-ink/75">
          รายการนี้ใช้โครงสร้างสาขาต้นทางและปลายทางแบบเดิม จึงเปิดดูได้แต่แก้ไขหรือลบไม่ได้
        </p>

        <dl className="grid gap-3 rounded-md border border-black/10 bg-field/30 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs font-semibold text-ink/55">สาขาต้นทาง</dt><dd className="mt-1 font-semibold">{locationName(transfer.locationId)}</dd></div>
          <div><dt className="text-xs font-semibold text-ink/55">สาขาปลายทาง</dt><dd className="mt-1 font-semibold">{transfer.targetLocationName ?? locationName(transfer.targetLocationId)}</dd></div>
          <div><dt className="text-xs font-semibold text-ink/55">ยอดโอน</dt><dd className="mt-1 font-semibold tabular-nums text-river">{MONEY.format(transfer.netAmountToPay)}</dd></div>
          <div><dt className="text-xs font-semibold text-ink/55">วันที่สร้าง</dt><dd className="mt-1 font-semibold">{transfer.createdAt ? formatBangkokDateTime(transfer.createdAt) : "—"}</dd></div>
        </dl>

        <div className="overflow-x-auto rounded-md border border-black/10">
          <table className="min-w-[680px] w-full text-sm">
            <thead className="bg-field text-left text-xs font-bold text-ink/60">
              <tr><th className="px-3 py-3">สลิป</th><th className="px-3 py-3 text-right">ยอดเงิน</th><th className="px-3 py-3 text-right">ค่าธรรมเนียม</th><th className="px-3 py-3">เลขอ้างอิง</th><th className="px-3 py-3">วันที่ทำรายการ</th></tr>
            </thead>
            <tbody>
              {(transfer.slips ?? []).map((slip, index) => (
                <tr key={slip.id} className="border-t border-black/5">
                  <td className="px-3 py-3 font-semibold">{index + 1}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{MONEY.format(slip.amount)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{MONEY.format(slip.fee)}</td>
                  <td className="px-3 py-3 font-mono">{slip.referenceNumber ?? "—"}</td>
                  <td className="px-3 py-3">{slip.transactionDate ? formatBangkokDateTime(slip.transactionDate) : "—"}</td>
                </tr>
              ))}
              {(transfer.slips?.length ?? 0) === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink/50">ไม่มีข้อมูลสลิป</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </ModalShell>
  );
}
