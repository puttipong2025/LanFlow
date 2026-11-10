import type { ModuleBadgeCounts } from "@/lib/actionable-badge-counts";
import { branchBadgeStatusEntries } from "@/lib/branch-badge-status";

export function BranchBadgeSummary({ counts, browserCount, fallbackTotal, active, unavailable }: {
  counts?: ModuleBadgeCounts;
  browserCount: number;
  fallbackTotal: number;
  active: boolean;
  unavailable: boolean;
}) {
  const entries = unavailable || counts === undefined ? null : branchBadgeStatusEntries(counts, browserCount);
  const invalid = counts !== undefined && entries === null;
  const safeFallback = Number.isSafeInteger(fallbackTotal) && fallbackTotal > 0 ? fallbackTotal : 0;
  const total = entries === null ? safeFallback : entries.reduce((sum, entry) => sum + entry.count, 0);
  return <>
    {total > 0 && <>
      <span className="sr-only">มีงาน {total} รายการ</span>
      {entries === null && <span aria-hidden="true" data-branch-badge
        className={`min-w-6 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[11px] font-extrabold leading-none tabular-nums ${active ? "bg-white text-leaf" : "bg-amber text-white"}`}>
        {total > 99 ? "99+" : total}
      </span>}
    </>}
    {entries?.map(({ status, label, count }) => <span key={status} data-branch-status-group={status} className="shrink-0 text-xs font-semibold text-ink/70 tabular-nums">
      <span aria-hidden="true">· </span>{label} {count}
    </span>)}
    {(unavailable || invalid) && <span className="shrink-0 text-xs text-ink/55">· โหลดรายละเอียดสถานะไม่ได้</span>}
  </>;
}
