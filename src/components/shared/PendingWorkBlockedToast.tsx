import { toast } from "sonner";
import type { PendingWorkBlocker } from "@/lib/pending-work-blockers";

export function showPendingWorkBlockedToast(
  title: string,
  blockers: PendingWorkBlocker[],
) {
  toast.error(title, {
    description: (
      <div>
        <p className="text-pretty">กรุณาจัดการงานค้างต่อไปนี้ก่อน</p>
        <ul className="mt-2 space-y-1" aria-label="งานค้างที่ต้องจัดการ">
          {blockers.map((blocker) => (
            <li key={blocker.key} className="flex items-baseline justify-between gap-4">
              <span className="text-pretty">{blocker.label}</span>
              <span className="shrink-0 tabular-nums">{blocker.count} รายการ</span>
            </li>
          ))}
        </ul>
      </div>
    ),
  });
}
