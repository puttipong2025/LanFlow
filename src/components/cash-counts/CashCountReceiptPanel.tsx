import type { CashCountReceipt } from "@/types/cash-counts";
import { CashCountDetails } from "./CashCountDetails";

export function CashCountReceiptPanel({ receipt, locationId, locationName, online, onBack }: {
  receipt: CashCountReceipt; locationId: string; locationName: string; online: boolean; onBack: () => void;
}) {
  return <div className="mt-5 space-y-4 rounded-lg border border-leaf/20 bg-mint/45 p-4">
    <h3 className="text-balance font-bold">ส่งผลตรวจนับสำเร็จ</h3>
    <p className="text-pretty text-sm">{receipt.reportNo} · {receipt.countedByName}</p>
    <CashCountDetails detail={{ ...receipt, locationId, locationName,
      createdAt: receipt.submittedAt, createdByName: receipt.countedByName,
      checkedAt: null, checkedByName: null, status: "active", deletedAt: null, formulaVersion: "ledger-v2",
    }} online={online} canCheck={false} onChecked={() => undefined} />
    <button type="button" onClick={onBack} className="focus-ring min-h-11 rounded-md bg-leaf px-4 text-sm font-semibold text-white">กลับหน้าเริ่มนับ</button>
  </div>;
}
