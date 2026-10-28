import { cn } from "@/lib/cn";
import type { SyncStatus } from "@/types";

export function SyncStatusBadge({ status, errorMessage }: { status: SyncStatus; errorMessage?: string }) {
  const tone = {
    pending: "bg-amber/25 text-ink",
    syncing: "bg-blue-100 text-blue-800",
    synced: "bg-leaf/15 text-leaf",
    failed: "bg-rose-100 text-rose-700",
    conflict: "bg-clay/15 text-clay"
  }[status];
  const label = {
    pending: "รอซิงก์",
    syncing: "กำลังซิงก์",
    synced: "ซิงก์แล้ว",
    failed: "ซิงก์ไม่สำเร็จ",
    conflict: "ข้อมูลชนกัน"
  }[status];

  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className={cn("rounded px-2 py-1 text-xs font-semibold", tone)} title={errorMessage}>{status === "pending" && errorMessage?.startsWith("กำลังส่ง") ? errorMessage : label}</span>
      {errorMessage && (status === "failed" || status === "conflict") && (
        <span className="max-w-xs whitespace-normal break-words text-pretty text-xs leading-tight text-rose-600">{errorMessage}</span>
      )}
    </div>
  );
}
