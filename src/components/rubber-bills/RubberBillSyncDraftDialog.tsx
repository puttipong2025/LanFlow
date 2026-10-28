import type { RubberBill } from "@/types";
import { ModalShell } from "@/components/shared/ModalShell";
import { formatNumber } from "@/lib/format";

export function RubberBillSyncDraftDialog({ bill, onClose }: { bill: RubberBill; onClose: () => void }) {
  return <ModalShell nativeModal title="ร่างที่ยังไม่ซิงก์" subtitle={bill.serverBillNo ?? bill.localBillNo} onClose={onClose}>
    <div className="space-y-3 p-4 text-sm">
      <p className="text-pretty text-ink/70">ข้อมูลนี้เป็นร่างในเครื่อง ยังไม่ได้แทนข้อมูลบิลปัจจุบัน</p>
      <p className="font-semibold">{bill.customerName} · {bill.billDate}</p>
      {bill.syncErrorMessage && <p role="alert" className="text-pretty text-danger">{bill.syncErrorMessage}</p>}
      <ul className="space-y-2 tabular-nums">{bill.weighItems?.map((item) => <li key={item.id}>
        {item.label} · {formatNumber(item.netWeight)} × {formatNumber(item.price)}
      </li>)}</ul>
      <p className="font-semibold tabular-nums">ยอดสุทธิ {formatNumber(bill.netTotal)} บาท</p>
      <button type="button" onClick={onClose} className="focus-ring rounded-md bg-river px-4 py-2 font-semibold text-white">กลับไปตรวจรายการ</button>
    </div>
  </ModalShell>;
}
