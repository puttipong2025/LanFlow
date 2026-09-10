"use client";

import { AlertDialog } from "@/components/shared/AlertDialog";
import { formatNumber } from "@/lib/format";
import type { RubberWeightAlertCheck } from "@/lib/lanflow/rubber-weight-alert";

export function RubberWeightAlertDialog({
  alert,
  onAcknowledge,
}: {
  alert: RubberWeightAlertCheck | null;
  onAcknowledge: () => void;
}) {
  return (
    <AlertDialog
      open={alert !== null}
      title="น้ำหนักยางสุทธิสะสมเกินเกณฑ์"
      description={alert
        ? `เกณฑ์กลาง ${formatNumber(alert.config.thresholdKg)} กก. พบ ${alert.candidates.length} สาขาที่ต้องตรวจสอบ`
        : "พบสาขาที่มีน้ำหนักยางสุทธิสะสมเกินเกณฑ์"}
      confirmLabel="รับทราบ"
      cancelLabel={null}
      onCancel={onAcknowledge}
      onConfirm={onAcknowledge}
    >
      {alert && (
        <ul className="mt-4 max-h-[min(50dvh,24rem)] space-y-2 overflow-y-auto pr-1">
          {alert.candidates.map((candidate) => (
            <li
              key={candidate.locationId}
              className="flex items-start justify-between gap-4 rounded-md border border-black/10 bg-field px-3 py-2.5"
            >
              <span className="min-w-0 break-words text-pretty text-sm font-semibold text-ink">
                {candidate.locationName}
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-clay">
                {formatNumber(candidate.netWeight)} กก.
              </span>
            </li>
          ))}
        </ul>
      )}
    </AlertDialog>
  );
}
