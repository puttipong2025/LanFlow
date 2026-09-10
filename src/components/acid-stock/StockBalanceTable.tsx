import type { AcidStockBalance } from "@/types";
import { TablePagination } from "@/components/shared/TablePagination";

function quantityTone(quantity: number) {
  if (quantity > 0) return "text-leaf";
  if (quantity < 0) return "text-clay";
  return "text-ink";
}

export function StockBalanceTable({
  rows,
  loading,
  page,
  pageSize,
  onPageChange,
}: {
  rows: AcidStockBalance[];
  loading: boolean;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-ink/60">
              <th className="py-2">สินค้า</th>
              <th className="text-right">ยอดคงเหลือ</th>
              <th>หน่วย</th>
              <th className="text-right">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="py-8 text-center text-ink/50">กำลังโหลด...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} className="py-8 text-center text-ink/50">ไม่พบสินค้าที่ตรงกับตัวกรอง</td></tr>
            ) : visibleRows.map((row) => (
              <tr key={row.productId} className="border-b border-black/5">
                <td className="py-3 font-semibold text-ink">{row.name}</td>
                <td className={`text-right font-bold tabular-nums ${quantityTone(row.balance)}`}>
                  {row.balance.toLocaleString("th-TH", { maximumFractionDigits: 2 })}
                </td>
                <td>{row.unit}</td>
                <td className="text-right">
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${row.balance > 0 ? "bg-leaf/10 text-leaf" : "bg-clay/10 text-clay"}`}>
                    {row.balance > 0 ? "มีสินค้า" : "หมดสต็อก"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePagination totalItems={rows.length} page={page} pageSize={pageSize} onPageChange={onPageChange} />
    </section>
  );
}
