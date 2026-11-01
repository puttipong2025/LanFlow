import { INCOME_HISTORY_LIMIT, type IncomeExpenseHistory } from "@/lib/income-expense/history-idb";

export function IncomeExpenseOfflineHistory({ history }: { history: IncomeExpenseHistory | null | undefined }) {
  return <p role="status" className="mb-3 rounded-md bg-field p-3 text-sm text-ink/80">
    ออฟไลน์ · {history?.updatedAt
      ? `สำเนาในเครื่อง ${history.rows.length} รายการ (สูงสุด ${INCOME_HISTORY_LIMIT} รายการล่าสุดต่อบัญชี/สาขา) · อัปเดต ${new Date(history.updatedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} · ดูย้อนหลังได้บางส่วน`
      : "ยังไม่มีสำเนารายการย้อนหลังในเครื่อง · แสดงเฉพาะงานค้าง"}
  </p>;
}
