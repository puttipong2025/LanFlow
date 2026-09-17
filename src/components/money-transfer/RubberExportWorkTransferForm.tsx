"use client";

import { useRef, useState } from "react";
import { Loader2, Plus, Upload } from "lucide-react";
import type { MoneyTransfer, MoneyTransferSlip } from "@/types";
import { authFetch } from "@/lib/auth-fetch";
import { normalizeBangkokDateTime } from "@/lib/bangkok-date";
import { formatCurrency } from "@/lib/format";
import { deriveMoneyTransferStatus, sumMoneyTransferSlips } from "@/lib/money-transfers/state";
import { SlipRow, type OcrSlipResult } from "./SlipRow";
import { SlipValidationSummary } from "./SlipValidationSummary";
import { focusFirstSlipIssue, validateMoneyTransferSlips, type SlipValidationIssue } from "./slip-validation";

type Props = {
  transfer: MoneyTransfer;
  sourceLocationName: string;
  online: boolean;
  submitting: boolean;
  onSave: (transfer: MoneyTransfer) => void;
  onCancel: () => void;
  onOpenSource?: () => void;
};

export function RubberExportWorkTransferForm({
  transfer, sourceLocationName, online, submitting, onSave, onCancel, onOpenSource,
}: Props) {
  const [slips, setSlips] = useState<MoneyTransferSlip[]>(transfer.slips ?? []);
  const [issues, setIssues] = useState<SlipValidationIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const paid = sumMoneyTransferSlips(slips);
  const status = deriveMoneyTransferStatus({ amountDue: transfer.netAmountToPay, amountPaid: paid });
  const statusLabel = status === "pending" ? "รอโอน"
    : status === "partial" ? "ค้างจ่าย"
    : status === "paid" ? "จ่ายครบ"
    : "ชำระเกิน";

  function addSlip() {
    setSlips((current) => [...current, {
      id: crypto.randomUUID(), inputMethod: "manual", amount: 0, referenceNumber: null,
      fee: 0, senderName: null, receiverName: null, transactionDate: null,
      slipImageUrl: null, sortOrder: current.length,
    }]);
  }

  async function readSlip(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append("image", file);
        const response = await authFetch("/api/lanflow/ocr-slip", { method: "POST", body });
        if (!response.ok) {
          const result = await response.json().catch(() => ({ error: "อ่านสลิปไม่สำเร็จ" }));
          throw new Error(result.error || "อ่านสลิปไม่สำเร็จ");
        }
        const result = await response.json() as OcrSlipResult;
        setSlips((current) => [...current, {
          id: crypto.randomUUID(), inputMethod: "ocr", amount: result.amount ?? 0,
          referenceNumber: result.reference_number, fee: result.fee ?? 0,
          senderName: null, receiverName: null,
          transactionDate: normalizeBangkokDateTime(result.transaction_date),
          slipImageUrl: null, sortOrder: current.length,
        }]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "อ่านสลิปไม่สำเร็จ");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function submit() {
    setError(null);
    const nextIssues = validateMoneyTransferSlips(slips);
    setIssues(nextIssues);
    if (nextIssues.length) {
      focusFirstSlipIssue(nextIssues);
      return;
    }
    onSave({ ...transfer, slips: slips.map((slip, index) => ({
      ...slip, senderName: null, receiverName: null, sortOrder: index,
    })) });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-river/20 bg-mint/30 p-4">
        <p className="text-pretty text-sm font-semibold text-ink">ค่าทำงานจากรายการส่งออกยาง <span className="tabular-nums">{transfer.rubberExportNo ?? "—"}</span></p>
        <p className="mt-1 text-pretty text-sm text-ink/70">สาขาต้นทาง: <strong>{sourceLocationName}</strong></p>
        {onOpenSource && (
          <button type="button" onClick={onOpenSource} className="focus-ring mt-2 text-sm font-semibold text-river underline">
            เปิดรายการส่งออกยาง
          </button>
        )}
        <div className="mt-3 flex flex-wrap items-end justify-between gap-2 border-t border-river/15 pt-3">
          <span className="text-sm text-ink/65">ยอดค่าทำงานที่ต้องจ่าย</span>
          <strong className="text-xl tabular-nums text-river">{formatCurrency(transfer.netAmountToPay)}</strong>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-pretty text-sm text-ink/70">
          ยอดสลิปรวม <strong className="tabular-nums">{formatCurrency(paid)}</strong>
          <span className="ml-2 font-semibold">{statusLabel}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => fileInput.current?.click()} disabled={!online || submitting || uploading}
            className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md bg-actionSecondary px-3 text-sm font-semibold text-white disabled:opacity-40">
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            อ่านสลิป
          </button>
          <button type="button" onClick={addSlip} disabled={!online || submitting || uploading}
            className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md bg-river px-3 text-sm font-semibold text-white disabled:opacity-40">
            <Plus size={16} /> เพิ่มสลิป
          </button>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple
            className="hidden" aria-label="เลือกรูปสลิป" onChange={(event) => void readSlip(event.target.files)} />
        </div>
      </div>

      {slips.length === 0 ? (
        <p className="rounded-lg border border-dashed border-black/10 p-5 text-pretty text-sm text-ink/60">
          ยังไม่มีสลิป กด “เพิ่มสลิป” หรือ “อ่านสลิป” เพื่อบันทึกการจ่าย
        </p>
      ) : (
        <div className="space-y-3">
          {slips.map((slip, index) => (
            <SlipRow key={slip.id} slip={slip} index={index} hidePartyFields
              errors={Object.fromEntries(issues.filter((issue) => issue.slipId === slip.id).map((issue) => [issue.field, issue.message]))}
              onUpdate={(id, field, value) => {
                setSlips((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item));
                setIssues((current) => current.filter((issue) => issue.slipId !== id || issue.field !== field));
              }}
              onRemove={(id) => {
                setSlips((current) => current.filter((item) => item.id !== id));
                setIssues((current) => current.filter((issue) => issue.slipId !== id));
              }} />
          ))}
        </div>
      )}
      <SlipValidationSummary issues={issues} />
      {error && <p role="alert" className="text-pretty text-sm font-semibold text-clay">{error}</p>}
      <div className="modal-actions flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={submitting}
          className="focus-ring h-10 rounded-md bg-field px-4 text-sm font-semibold text-ink disabled:opacity-40">
          ยกเลิก
        </button>
        <button type="button" onClick={submit} disabled={!online || submitting || uploading || Boolean(transfer.reportLockNo)}
          className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-leaf px-4 text-sm font-semibold text-white disabled:opacity-40">
          {submitting && <Loader2 size={16} className="animate-spin" />} บันทึกสลิป
        </button>
      </div>
    </div>
  );
}
