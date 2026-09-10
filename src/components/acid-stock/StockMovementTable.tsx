import { Lock, Package, Trash2 } from "lucide-react";
import type { AcidStockMovement } from "@/types";
import { formatCurrency } from "@/lib/format";
import { TablePagination } from "@/components/shared/TablePagination";

function quantityTone(quantity: number) {
  if (quantity > 0) return "text-leaf";
  if (quantity < 0) return "text-clay";
  return "text-ink";
}

function sourceName(sourceType: AcidStockMovement["sourceType"]) {
  if (sourceType === "income_sale") return "บิลขาย";
  if (sourceType === "rubber_bill_acid" || sourceType === "rubber_bill_stock_deduction") return "บิลยาง";
  return "รายการสต็อก";
}

export function StockMovementTable({
  rows,
  loading,
  online,
  page,
  pageSize,
  hasMore,
  isLoadingMore,
  onPageChange,
  onDelete,
}: {
  rows: AcidStockMovement[];
  loading: boolean;
  online: boolean;
  page: number;
  pageSize: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  onPageChange: (page: number) => void;
  onDelete: (movement: AcidStockMovement) => void;
}) {
  const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1220px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-ink/60">
              <th className="bg-white py-2 pr-3 lg:sticky lg:left-0 lg:z-20">จัดการ</th>
              <th className="py-2">วันที่</th>
              <th>เลขบิล</th>
              <th>สินค้า</th>
              <th>ประเภท</th>
              <th className="text-right">จำนวน</th>
              <th className="text-right">ยอดเงิน</th>
              <th>ผู้บันทึก</th>
              <th>แหล่งที่มา/การล็อก</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="py-8 text-center text-ink/50">กำลังโหลด...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="py-8 text-center text-ink/50">ไม่พบรายการสต็อกที่ตรงกับตัวกรอง</td></tr>
            ) : visibleRows.map((movement) => (
              <tr key={movement.movementId} className="border-b border-black/5 hover:bg-field/50">
                <td className="bg-white py-3 pr-3 lg:sticky lg:left-0 lg:z-10">
                  {movement.sourceType !== "stock_entry" || movement.txType === "transfer_in" ? (
                    <span className="text-xs font-semibold text-ink/40">—</span>
                  ) : (
                    <button type="button" onClick={() => onDelete(movement)}
                      disabled={!online || Boolean(movement.reportLockNo)}
                      title={movement.reportLockNo ? `ล็อกโดยรายงาน ${movement.reportLockNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน` : online ? "ส่งคำขอลบรายการสต็อก" : "ลบรายการสต็อกได้เมื่อออนไลน์เท่านั้น"}
                      aria-label={movement.reportLockNo ? `ล็อกโดยรายงาน ${movement.reportLockNo}` : "ลบรายการสต็อก"}
                      className="focus-ring inline-flex h-10 items-center gap-1 rounded-md bg-clay px-3 text-xs font-bold text-white hover:bg-clay/90 disabled:cursor-not-allowed disabled:bg-slate-300">
                      <Trash2 size={16} /> ลบ
                    </button>
                  )}
                </td>
                <td className="py-3 tabular-nums">{movement.txDate}</td>
                <td className="font-semibold tabular-nums">{movement.displayBillNo}</td>
                <td>{movement.productName}</td>
                <td>{movement.sourceLabel}</td>
                <td className={`text-right font-bold tabular-nums ${quantityTone(movement.quantityDelta)}`}>
                  {movement.quantityDelta > 0 ? "+" : ""}{movement.quantityDelta.toLocaleString("th-TH")}
                </td>
                <td className="text-right tabular-nums">{formatCurrency(movement.amount)}</td>
                <td>{movement.createdByName || "ระบบ"} {movement.createdByPhone ? `· ${movement.createdByPhone}` : ""}</td>
                <td>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-leaf/10 px-2 py-1 text-xs font-bold text-leaf">
                      <Package size={12} /> {sourceName(movement.sourceType)}
                    </span>
                    {movement.reportLockNo && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-ink/10 px-2 py-1 text-xs font-bold text-ink/70">
                        <Lock size={12} /> {movement.reportLockNo}
                      </span>
                    )}
                    {movement.relationLockReason && (
                      <span title={movement.relationLockReason} className="inline-flex items-center gap-1 rounded-full bg-ink/10 px-2 py-1 text-xs font-bold text-ink/70">
                        <Lock size={12} /> ต้นทาง
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePagination
        totalItems={rows.length}
        page={page}
        pageSize={pageSize}
        onPageChange={onPageChange}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
      />
    </section>
  );
}
