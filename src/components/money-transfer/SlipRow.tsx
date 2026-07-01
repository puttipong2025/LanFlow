"use client";

import { Trash2 } from "lucide-react";
import type { MoneyTransferSlip } from "@/types";

export type OcrSlipResult = {
  amount: number | null;
  reference_number: string | null;
  fee: number | null;
  sender_name: string | null;
  receiver_name: string | null;
  transaction_date: string | null;
};

export function SlipRow({
  slip,
  index,
  isEdit,
  onUpdate,
  onRemove,
}: {
  slip: MoneyTransferSlip;
  index: number;
  isEdit: boolean;
  onUpdate: (id: string, field: keyof MoneyTransferSlip, value: any) => void;
  onRemove: (id: string) => void;
}) {
  const refReadOnly = isEdit || slip.referenceNumber !== null;

  return (
    <div className="rounded-lg border border-black/10 bg-field/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold text-ink/40">สลิป #{index + 1}</span>
        <button type="button" onClick={() => onRemove(slip.id)} className="text-ink/40 hover:text-clay">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink/60">จำนวนเงิน (฿)</span>
          <input
            type="number"
            value={slip.amount || ""}
            onChange={(e) => onUpdate(slip.id, "amount", e.target.value ? Number(e.target.value) : 0)}
            className="focus-ring h-9 w-full rounded-md border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink/60">หมายเลขอ้างอิง</span>
          <input
            type="text"
            value={slip.referenceNumber ?? ""}
            readOnly={refReadOnly}
            onChange={(e) => onUpdate(slip.id, "referenceNumber", e.target.value || null)}
            className={`focus-ring h-9 w-full rounded-md border border-black/10 px-3 text-sm font-mono ${refReadOnly ? "bg-field/50 cursor-not-allowed" : "bg-white"}`}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink/60">ค่าธรรมเนียม (฿)</span>
          <input
            type="number"
            value={slip.fee || ""}
            onChange={(e) => onUpdate(slip.id, "fee", e.target.value ? Number(e.target.value) : 0)}
            className="focus-ring h-9 w-full rounded-md border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink/60">ชื่อผู้โอน</span>
          <input
            type="text"
            value={slip.senderName ?? ""}
            onChange={(e) => onUpdate(slip.id, "senderName", e.target.value || null)}
            className="focus-ring h-9 w-full rounded-md border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink/60">ชื่อผู้รับ</span>
          <input
            type="text"
            value={slip.receiverName ?? ""}
            onChange={(e) => onUpdate(slip.id, "receiverName", e.target.value || null)}
            className="focus-ring h-9 w-full rounded-md border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink/60">
            วันที่ทำรายการ {!slip.transactionDate && <span className="text-clay font-normal">*จำเป็น</span>}
          </span>
          <input
            type="datetime-local"
            value={slip.transactionDate?.slice(0, 16) ?? ""}
            onChange={(e) => onUpdate(slip.id, "transactionDate", e.target.value ? new Date(e.target.value).toISOString() : null)}
            className={`focus-ring h-9 w-full rounded-md border bg-white px-3 text-sm ${
              !slip.transactionDate ? "border-clay ring-1 ring-clay/20" : "border-black/10"
            }`}
          />
        </label>
      </div>
    </div>
  );
}
