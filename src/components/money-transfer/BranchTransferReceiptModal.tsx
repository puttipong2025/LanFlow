"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { ModalShell } from "@/components/shared/ModalShell";
import { formatBangkokDateTime } from "@/lib/bangkok-date";
import { formatCurrency } from "@/lib/format";
import type { MoneyTransfer } from "@/types";

export function BranchTransferReceiptModal({
  transfer,
  online,
  onReceive,
  onClose,
}: {
  transfer: MoneyTransfer;
  online: boolean;
  onReceive: (revisionNo: number) => Promise<unknown>;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const pending = transfer.branchReceiptStatus === "pending_receipt";

  const confirm = async () => {
    if (!online || !pending || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onReceive(transfer.revisionNo ?? 0);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ยืนยันรับเงินไม่สำเร็จ");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={pending ? "ตรวจสอบและยืนยันรับเงิน" : "รายละเอียดการรับเงิน"}
      subtitle="โอนเข้าบัญชีสาขา"
      size="normal"
      nativeModal
      closeOnEscape
      closeDisabled={saving}
      onClose={onClose}
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="rounded-lg border border-clay/25 bg-clay/10 px-3 py-2 text-sm font-semibold text-clay">
            {error}
          </p>
        )}

        <section className="rounded-xl border border-black/[0.08] bg-field/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-ink/50">สาขาผู้รับ</p>
              <p className="font-bold text-ink">{transfer.targetLocationName ?? "ไม่ระบุสาขา"}</p>
            </div>
            <span className={pending
              ? "rounded-full bg-amber/20 px-3 py-1 text-xs font-bold text-amber"
              : "rounded-full bg-leaf/10 px-3 py-1 text-xs font-bold text-leaf"}
            >
              {pending ? "รอยืนยันรับ" : "ยืนยันรับแล้ว"}
            </span>
          </div>
          <p className="mt-4 text-3xl font-bold tabular-nums text-river">
            {formatCurrency(transfer.netAmountToPay)}
          </p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink/50">ผู้สร้างรายการ</dt>
              <dd className="font-semibold text-ink">{transfer.createdByName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">วันที่สร้าง</dt>
              <dd className="font-semibold text-ink">{transfer.createdAt ? formatBangkokDateTime(transfer.createdAt) : "—"}</dd>
            </div>
            {!pending && (
              <>
                <div>
                  <dt className="text-ink/50">ผู้ยืนยันรับ</dt>
                  <dd className="font-semibold text-ink">{transfer.branchReceivedByName ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink/50">เวลายืนยัน</dt>
                  <dd className="font-semibold text-ink">{transfer.branchReceivedAt ? formatBangkokDateTime(transfer.branchReceivedAt) : "—"}</dd>
                </div>
              </>
            )}
          </dl>
        </section>

        <section aria-labelledby="branch-transfer-slip-heading" className="space-y-2">
          <h3 id="branch-transfer-slip-heading" className="font-bold text-ink">
            หลักฐานการโอน ({transfer.slips?.length ?? 0})
          </h3>
          {(transfer.slips ?? []).map((slip, index) => (
            <div key={slip.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-black/[0.08] bg-white p-3">
              <div>
                <p className="font-semibold text-ink">สลิป {index + 1}</p>
                <p className="text-xs text-ink/55">
                  {slip.transactionDate ? formatBangkokDateTime(slip.transactionDate) : "ไม่ระบุเวลา"}
                </p>
              </div>
              <p className="font-bold tabular-nums text-river">{formatCurrency(slip.amount)}</p>
            </div>
          ))}
        </section>

        {pending && (
          <p className="rounded-lg border border-amber/25 bg-amber/10 px-3 py-2 text-sm text-ink/70">
            โปรดเปิดตรวจรายละเอียดและสลิปให้ครบก่อนยืนยัน รายการนี้ไม่มีขั้นตอนกรอกยอดรับหรือปฏิเสธ
          </p>
        )}

        <footer className="flex flex-col-reverse gap-2 border-t border-black/[0.07] pt-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="focus-ring rounded-lg bg-actionSecondary px-4 py-2.5 font-semibold text-white disabled:opacity-45"
          >
            ปิด
          </button>
          {pending && (
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={saving || !online}
              title={online ? "ยืนยันว่ารับเงินรายการนี้แล้ว" : "ยืนยันรับเงินได้เมื่อออนไลน์"}
              className="focus-ring inline-flex items-center justify-center gap-2 rounded-lg bg-commit px-5 py-2.5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
              {saving ? "กำลังยืนยัน..." : "ยืนยันรับเงิน"}
            </button>
          )}
        </footer>
      </div>
    </ModalShell>
  );
}
