import { formatCurrency, formatNumber } from "@/lib/format";
import type { IncomeExpense, Location, RubberBill } from "@/types";
import { Metric } from "./Metric";
import { getDisplayBillNo } from "@/components/rubber-bills/bill-display";

export function Dashboard({
  selectedLocation,
  summary,
  bills,
  transactions,
  supabaseReady
}: {
  selectedLocation: Location;
  summary: {
    billCount: number;
    rubberWeight: number;
    rubberPay: number;
    income: number;
    expense: number;
    balance: number;
    cashPaid: number;
    transferPaid: number;
  };
  bills: RubberBill[];
  transactions: IncomeExpense[];
  supabaseReady: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="บิลวันนี้" value={`${summary.billCount}`} detail={`${formatNumber(summary.rubberWeight)} กก.`} />
        <Metric label="จ่ายค่ายาง" value={formatCurrency(summary.rubberPay)} detail={`สด ${formatCurrency(summary.cashPaid)}`} />
        <Metric label="รายรับ" value={formatCurrency(summary.income)} detail={`รายจ่าย ${formatCurrency(summary.expense)}`} />
        <Metric label="คงเหลือ" value={formatCurrency(summary.balance)} detail={`โอน ${formatCurrency(summary.transferPaid)}`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-ink">บิลยาง · {selectedLocation.name}</h2>
            <span className="rounded bg-field px-2 py-1 text-xs font-semibold text-ink/70">
              {supabaseReady ? "Supabase" : "Demo local"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-ink/60">
                  <th className="py-2">เลขบิล</th>
                  <th>ลูกค้า</th>
                  <th>น้ำหนัก</th>
                  <th>ราคา</th>
                  <th>สุทธิ</th>
                  <th>ผู้บันทึก</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => (
                  <tr key={bill.id} className="border-b border-black/5">
                    <td className="py-3 font-semibold">{getDisplayBillNo(bill)}</td>
                    <td>{bill.customerName}</td>
                    <td>{formatNumber(bill.weight)} กก.</td>
                    <td>{formatCurrency(bill.price)}</td>
                    <td className="font-semibold">{formatCurrency(bill.netTotal)}</td>
                    <td>{bill.createdByName} · {bill.createdByPhone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
          <h2 className="mb-3 text-lg font-bold text-ink">รายการเงินล่าสุด</h2>
          <div className="space-y-3">
            {transactions.map((tx) => (
              <div key={tx.id} className="rounded-md border border-black/10 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{tx.title}</span>
                  <span className={tx.type === "income" ? "text-leaf" : "text-clay"}>
                    {tx.type === "income" ? "+" : "-"}{formatCurrency(tx.cost)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink/60">{tx.billOption} · {tx.createdByName}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
