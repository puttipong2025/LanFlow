import { RefreshCw } from "lucide-react";

import type { RubberEvidenceView } from "@/hooks/useRubberEvidenceFeed";
import { cn } from "@/lib/cn";

export function RubberEvidenceFilters({ view, search, online, busy, error, onViewChange, onSearchChange, onRefresh }: {
  view: RubberEvidenceView;
  search: string;
  online: boolean;
  busy: boolean;
  error: boolean;
  onViewChange: (view: RubberEvidenceView) => void;
  onSearchChange: (search: string) => void;
  onRefresh: () => void;
}) {
  const options: Array<[RubberEvidenceView, string]> = [["pending", "รอตรวจ"], ["history", "ประวัติการตรวจ"]];
  return <div className="rounded-xl border border-black/10 bg-white p-3 shadow-panel sm:p-4">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap gap-1 rounded-lg bg-field p-1" aria-label="กรองสถานะหลักฐาน">
        {options.map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => onViewChange(value)} className={cn("focus-ring min-h-9 rounded-md px-3 text-sm font-semibold", view === value ? "bg-river text-white shadow-sm" : "text-ink hover:bg-white")}>{label}</button>)}
      </div>
      <button type="button" aria-label="รีเฟรชหลักฐาน" aria-busy={busy} disabled={!online || busy} onClick={onRefresh} className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md border border-black/15 bg-white px-3 text-sm font-semibold text-ink disabled:opacity-50">
        <RefreshCw size={16} aria-hidden="true" /> {busy ? "กำลังโหลด..." : "รีเฟรช"}
      </button>
      <label className="text-sm font-semibold text-ink">
        <span className="sr-only">ค้นหาบิลหลักฐาน</span>
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="ค้นหาเลขบิลหรือลูกค้า" className="focus-ring h-10 w-full rounded-md border border-black/20 bg-white px-3 sm:w-72" />
      </label>
    </div>
    {error && <p role="alert" className="mt-2 text-pretty text-sm text-danger">รีเฟรชหลักฐานไม่สำเร็จ กรุณาลองใหม่</p>}
  </div>;
}
