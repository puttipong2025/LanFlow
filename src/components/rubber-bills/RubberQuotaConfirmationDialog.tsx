import { AlertDialog } from "@/components/shared/AlertDialog";
import { formatNumber } from "@/lib/format";
import type { RubberSubmissionDecision } from "@/types";

export function RubberQuotaConfirmationDialog({
  decision,
  busy,
  onCancel,
  onConfirm,
}: {
  decision: RubberSubmissionDecision | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={decision !== null}
      title="ยืนยันใช้โควต้าราคา"
      description="ราคาบิลสูงกว่าราคากลางแต่ยังไม่เกินเพดานที่กำหนด ตรวจสอบราคาและจำนวนสิทธิ์ก่อนยืนยัน"
      confirmLabel="ยืนยันใช้โควต้า"
      cancelLabel="ยกเลิก"
      busy={busy}
      confirmClassName="bg-commit"
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      {decision && (
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 rounded-md bg-field p-3 text-sm">
          <dt className="text-ink/65">ราคาสูงสุดในบิล</dt>
          <dd className="text-right font-semibold tabular-nums">{formatNumber(decision.maxPrice ?? 0)} บาท/กก.</dd>
          <dt className="text-ink/65">ราคากลาง</dt>
          <dd className="text-right font-semibold tabular-nums">{formatNumber(decision.centralPrice)} บาท/กก.</dd>
          <dt className="text-ink/65">ซื้อเกินได้</dt>
          <dd className="text-right font-semibold tabular-nums">{formatNumber(decision.priceAllowance)} บาท/กก.</dd>
          <dt className="text-ink/65">ราคาสูงสุดที่ใช้สิทธิ์ได้</dt>
          <dd className="text-right font-semibold tabular-nums">{formatNumber(decision.effectivePriceCap)} บาท/กก.</dd>
          <dt className="font-semibold text-ink">โควต้าคงเหลือหลังยืนยัน</dt>
          <dd className="text-right font-bold text-commit tabular-nums">{decision.remainingAfterConfirm ?? 0} ครั้ง</dd>
        </dl>
      )}
    </AlertDialog>
  );
}
