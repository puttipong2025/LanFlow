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
      <span className={`rounded px-2 py-1 text-xs font-semibold ${tone}`} title={errorMessage}>{label}</span>
      {errorMessage && (status === "failed" || status === "conflict") && (
        <span className="text-[10px] leading-tight text-rose-600 max-w-[140px] truncate" title={errorMessage}>{errorMessage}</span>
      )}
    </div>
  );
}
