import type { ModuleBadgeCounts } from "@/lib/actionable-badge-counts";

// Use the same snapshot as the branch total and navigation badges.
// Invalid totals fall back to the existing aggregate without throwing in render.
export function branchBadgeStatusEntries(counts: ModuleBadgeCounts = {}, browserCount = 0) {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)
    || !Number.isSafeInteger(browserCount) || browserCount < 0) return null;
  let total = browserCount;
  for (const count of Object.values(counts)) {
    if (count === undefined) continue;
    if (!Number.isSafeInteger(count) || count < 0) return null;
    total += count;
    if (!Number.isSafeInteger(total)) return null;
  }
  const transfer = counts["money-transfer"] ?? 0;
  return [
    { status: "transfer", label: "รอโอน", count: transfer },
    { status: "other", label: "รอจัดการ", count: total - transfer },
  ].filter(group => group.count > 0);
}
