"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Search } from "lucide-react";

import { useMoneyTransferSources } from "@/hooks/useMoneyTransferSources";
import { cn } from "@/lib/cn";
import { formatCurrency } from "@/lib/format";
import type { MoneyTransferItem } from "@/types";

const BLOCK_LABELS: Record<string, string> = {
  SOURCE_ALREADY_USED: "อยู่ในรายการโอนแล้ว",
  REPORT_LOCKED: "ล็อกโดยรายงาน",
  PENDING_APPROVAL: "รออนุมัติ",
  NOT_SYNCED: "ยังไม่ซิงก์",
  UNPRICED: "ยังไม่กำหนดราคา",
  NOT_PAYABLE: "ยอดสุทธิไม่พร้อมจ่าย",
  MISSING_CUSTOMER: "ไม่มีชื่อลูกค้า",
};

export function ItemPicker({
  locationId,
  selectedItems,
  onSelect,
  onDeselect,
}: {
  locationId: string;
  selectedItems: MoneyTransferItem[];
  onSelect: (item: MoneyTransferItem) => void;
  onDeselect: (sourceId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [hideReportLocked, setHideReportLocked] = useState(false);
  const selectedIds = selectedItems.map((item) => item.sourceId);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 400);
    return () => window.clearTimeout(timer);
  }, [search]);
  const sources = useMoneyTransferSources({
    locationId,
    sourceType: "rubber_bill",
    search: debouncedSearch,
    selectedIds,
  });
  const selectedSourceIds = new Set(selectedIds);
  const visibleRows = sources.rows.filter((row) => !hideReportLocked || !row.reportLockNo || selectedSourceIds.has(row.sourceId));

  return (
    <div className="rounded-lg border border-leaf/20 bg-leaf/5 p-3">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-ink">เลือกบิลยาง</p>
        <label className="relative block">
          <span className="sr-only">ค้นหาแหล่งจ่าย</span>
          <Search aria-hidden="true" size={16} className="absolute left-3 top-3 text-ink/40" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาเลขที่ ลูกค้า หรือทะเบียน"
            className="focus-ring h-10 w-full rounded-md border border-black/20 bg-white pl-9 pr-3 text-sm sm:w-72" />
        </label>
        <button type="button" aria-pressed={hideReportLocked} onClick={() => setHideReportLocked((value) => !value)}
          className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-leaf px-3 text-sm font-semibold text-white">
          {hideReportLocked ? <Eye size={16} /> : <EyeOff size={16} />}
          {hideReportLocked ? "แสดงรายการที่ล็อกแล้ว" : "ซ่อนรายการที่ล็อกแล้ว"}
        </button>
      </div>

      {sources.error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-danger">
          {sources.error instanceof Error ? sources.error.message : "โหลดแหล่งจ่ายไม่สำเร็จ"}
        </p>
      ) : (
        <div className="max-h-72 overflow-auto rounded-md border border-black/10 bg-white">
          <table className="w-full min-w-[660px] text-sm">
            <thead className="sticky top-0 z-10 bg-field">
              <tr className="border-b border-black/10 text-left text-xs font-bold text-ink/60">
                <th className="px-3 py-2">เลือก</th><th className="px-3 py-2">เลขที่</th>
                <th className="px-3 py-2">ลูกค้า</th><th className="px-3 py-2">วันที่/ทะเบียน</th>
                <th className="px-3 py-2 text-right">ยอดสุทธิ</th><th className="px-3 py-2">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const selected = selectedSourceIds.has(row.sourceId);
                const disabled = !row.available && !selected;
                const label = row.blockReason ? BLOCK_LABELS[row.blockReason] ?? row.blockReason : "พร้อมเลือก";
                return (
                  <tr key={row.sourceId} className="border-b border-black/5 last:border-0">
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected} disabled={disabled} aria-label={`${selected ? "ยกเลิก" : "เลือก"} ${row.sourceNumber}`}
                        title={label} onChange={() => selected ? onDeselect(row.sourceId) : onSelect({
                          id: crypto.randomUUID(), sourceType: row.sourceType, sourceId: row.sourceId,
                          customerName: row.customerName, amount: row.amount, sourceNumber: row.sourceNumber,
                          sourceDate: row.sourceDate, netWeightAfterDeduction: row.netWeight,
                          averagePrice: row.averagePrice, rubberValue: row.rubberValue,
                          deductedAmount: row.deductedAmount, netPayableAmount: row.amount,
                        })} className="size-5 accent-leaf" />
                    </td>
                    <td className="px-3 py-2 font-mono font-semibold">{row.sourceNumber}</td>
                    <td className="px-3 py-2">{row.customerName ?? "—"}</td>
                    <td className="px-3 py-2 text-ink/60">{row.sourceDate ?? row.licensePlate ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-river">{formatCurrency(row.amount)}</td>
                    <td className="px-3 py-2"><span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", disabled ? "bg-amber/15 text-amber" : "bg-leaf/10 text-leaf")}>{label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!sources.isLoading && visibleRows.length === 0 && <p className="py-6 text-center text-sm text-ink/50">ไม่พบแหล่งจ่าย</p>}
        </div>
      )}
      <div className="mt-3 flex justify-center">
        {sources.isLoading ? <span className="inline-flex items-center gap-2 text-sm text-ink/60"><Loader2 size={16} className="animate-spin" /> กำลังโหลด...</span>
          : sources.hasMore && <button type="button" disabled={sources.isLoadingMore} onClick={() => void sources.loadMore()}
            className="focus-ring h-10 rounded-md bg-actionSecondary px-4 text-sm font-semibold text-white disabled:opacity-50">
            {sources.isLoadingMore ? "กำลังโหลด..." : "โหลดเพิ่ม"}
          </button>}
      </div>
    </div>
  );
}
