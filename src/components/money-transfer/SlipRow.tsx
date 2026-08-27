"use client";

import { Trash2 } from "lucide-react";
import type { MoneyTransferSlip } from "@/types";
import { InlineNumber } from "@/components/shared/InlineNumber";
import { bangkokDateTimeLocalValue, bangkokWallClockToUtcIso } from "@/lib/bangkok-date";
import { slipFieldInputId, type SlipField } from "./slip-validation";

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
  errors = {},
  onUpdate,
  onRemove,
}: {
  slip: MoneyTransferSlip;
  index: number;
  errors?: Partial<Record<SlipField, string>>;
  onUpdate: (id: string, field: keyof MoneyTransferSlip, value: any) => void;
  onRemove: (id: string) => void;
}) {
  const isOcr = slip.inputMethod === "ocr"
    || (slip.inputMethod === null && slip.referenceNumber !== null);

  return (
    <div className="rounded-lg border border-black/10 bg-field/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold text-ink/40">สลิป #{index + 1}</span>
        <button type="button" onClick={() => onRemove(slip.id)} className="inline-flex h-10 items-center gap-1 rounded-md bg-danger px-2 text-xs font-semibold text-white hover:bg-danger/90">
          <Trash2 size={14} />
          ลบ
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink/60">จำนวนเงิน (฿)</span>
          <InlineNumber
            inputId={slipFieldInputId(slip.id, "amount")}
            ariaLabel={`จำนวนเงินสลิป ${index + 1}`}
            value={slip.amount}
            onChange={(value) => onUpdate(slip.id, "amount", value)}
            invalid={Boolean(errors.amount)}
          />
        </label>
        {isOcr ? (
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink/60">หมายเลขอ้างอิง OCR</span>
            <input
              id={slipFieldInputId(slip.id, "referenceNumber")}
              type="text"
              value={slip.referenceNumber ?? ""}
              readOnly
              aria-invalid={Boolean(errors.referenceNumber) || undefined}
              className={`focus-ring h-10 w-full cursor-not-allowed rounded-md border bg-field/50 px-3 text-sm font-mono ${errors.referenceNumber ? "border-clay ring-1 ring-clay/20" : "border-black/10"}`}
            />
          </label>
        ) : (
          <div className="rounded-md bg-field/40 px-3 py-2 text-xs text-ink/55">
            เพิ่มเอง · ไม่ใช้เลขอ้างอิง
          </div>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink/60">ค่าธรรมเนียม (฿)</span>
          <InlineNumber
            inputId={slipFieldInputId(slip.id, "fee")}
            ariaLabel={`ค่าธรรมเนียมสลิป ${index + 1}`}
            value={slip.fee}
            onChange={(value) => onUpdate(slip.id, "fee", value)}
            invalid={Boolean(errors.fee)}
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
            id={slipFieldInputId(slip.id, "transactionDate")}
            type="datetime-local"
            aria-invalid={Boolean(errors.transactionDate) || undefined}
            value={slip.transactionDate ? bangkokDateTimeLocalValue(slip.transactionDate) : ""}
            onChange={(e) => onUpdate(slip.id, "transactionDate", e.target.value ? bangkokWallClockToUtcIso(e.target.value) : null)}
            className={`focus-ring h-9 w-full rounded-md border bg-white px-3 text-sm ${
              !slip.transactionDate || errors.transactionDate ? "border-clay ring-1 ring-clay/20" : "border-black/10"
            }`}
          />
        </label>
      </div>
    </div>
  );
}
