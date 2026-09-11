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
  const alertGroups = alert ? alert.candidates.reduce<Array<{
    id: string;
    order: number;
    thresholdKg: number;
    candidates: typeof alert.candidates;
  }>>((result, candidate) => {
    const id = candidate.groupId ?? "legacy";
    const current = result.find((group) => group.id === id);
    if (current) current.candidates.push(candidate);
    else result.push({
      id,
      order: candidate.groupOrder ?? 1,
      thresholdKg: candidate.thresholdKg ?? alert.config.thresholdKg,
      candidates: [candidate],
    });
    return result;
  }, []) : [];

  return (
    <AlertDialog
      open={alert !== null}
      title="น้ำหนักยางสุทธิสะสมเกินเกณฑ์"
      description={alert
        ? `พบ ${alert.candidates.length} สาขา จาก ${alertGroups.length} กลุ่มที่ต้องตรวจสอบ`
        : "พบสาขาที่มีน้ำหนักยางสุทธิสะสมเกินเกณฑ์"}
      confirmLabel="รับทราบ"
      cancelLabel={null}
      onCancel={onAcknowledge}
      onConfirm={onAcknowledge}
    >
      {alert && (
        <div className="mt-4 max-h-[min(50dvh,24rem)] space-y-3 overflow-y-auto pr-1">
          {alertGroups.map((group) => (
            <section key={group.id} className="rounded-md border border-black/10 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-balance text-sm font-bold text-ink">กลุ่ม {group.order}</h4>
                <p className="text-sm text-ink/65">เกณฑ์ <span className="font-semibold tabular-nums">{formatNumber(group.thresholdKg)} กก.</span></p>
              </div>
              <ul className="mt-2 space-y-2">
                {group.candidates.map((candidate) => (
                  <li key={candidate.locationId} className="flex items-start justify-between gap-4 rounded-md bg-field px-3 py-2.5">
                    <span className="min-w-0 break-words text-pretty text-sm font-semibold text-ink">{candidate.locationName}</span>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-clay">{formatNumber(candidate.netWeight)} กก.</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </AlertDialog>
  );
}
