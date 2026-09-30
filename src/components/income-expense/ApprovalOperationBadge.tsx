import { cn } from "@/lib/cn";

import type { QueueOperation } from "@/types";

const operationBadges = {
  create: { label: "เพิ่มใหม่", className: "bg-success/10 text-success" },
  update: { label: "แก้ไข", className: "bg-amber/15 text-amber-800" },
  delete: { label: "ลบ", className: "bg-danger/10 text-danger" },
} satisfies Record<QueueOperation, { label: string; className: string }>;

export function ApprovalOperationBadge({ operation }: { operation: QueueOperation }) {
  const badge = operationBadges[operation];
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", badge.className)}>
      {badge.label}
    </span>
  );
}
