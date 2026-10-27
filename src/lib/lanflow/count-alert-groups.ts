import type { ThresholdCandidate } from "./branch-threshold-alert";
import type { CashCountLockState } from "../cash-count-lock";

export function countAlertGroups(candidates: ThresholdCandidate[], locks: CashCountLockState[], now: number) {
  const rows = new Map<string, { candidate?: ThresholdCandidate; lock?: CashCountLockState }>();
  for (const candidate of candidates.filter((c) => c.kind === "count")) rows.set(candidate.locationId, { candidate });
  for (const lock of locks.filter((s) => s.enabled && (s.locked || (s.unlockedUntil && Date.parse(s.unlockedUntil) > now)))) {
    // The independent reads can straddle a membership move. Never combine groups.
    const candidate = rows.get(lock.locationId)?.candidate;
    if (candidate && candidate.groupId !== lock.groupId) continue;
    rows.set(lock.locationId, { ...rows.get(lock.locationId), lock });
  }
  const groups = new Map<string, { id: string; order: number; threshold?: number; discrepancyThreshold?: number | null; rows: Array<{ locationId: string; name: string; candidate?: ThresholdCandidate; lock?: CashCountLockState }> }>();
  for (const [locationId, row] of rows) {
    const id = row.candidate?.groupId ?? row.lock!.groupId;
    const group = groups.get(id) ?? { id, order: 0, rows: [] };
    if (row.candidate) {
      group.order = row.candidate.groupOrder; group.threshold = row.candidate.threshold;
      group.discrepancyThreshold = row.candidate.discrepancyThreshold;
    }
    group.rows.push({ locationId, name: row.candidate?.locationName ?? row.lock!.locationName, ...row });
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
