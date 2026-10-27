import { getPendingEvents, reconcileSyncEventsIfCurrent } from "@/lib/idb-queue";

export async function normalizeRubberBillQueueBeforeSync(ownerUserId: string, locationId: string) {
  const { coalesceQueueGroup } = await import("@/lib/coalesceQueueGroup");
  const events = await getPendingEvents({ entity: "rubber_bills", ownerUserId, locationId });
  const grouped = new Map<string, typeof events>();
  for (const e of events) {
    if (!grouped.has(e.id)) grouped.set(e.id, []);
    grouped.get(e.id)!.push(e);
  }

  for (const group of grouped.values()) {
    if (group.length === 1) {
      const event = group[0];
      if (event.status !== "pending" && (event.failureHttpStatus === undefined || event.status === "conflict")) {
        const refreshed = { ...event, status: "pending" as const, errorMessage: undefined };
        if (!await reconcileSyncEventsIfCurrent([event], refreshed, true)) return false;
      }
      continue;
    }
    // Don't coalesce if any event is locked (failed/conflict) — user must resolve first
    if (group.some(e => e.status === "conflict" || e.status === "failed")) continue;

    const result = coalesceQueueGroup(group);

    if (!await reconcileSyncEventsIfCurrent(
      group,
      result.action === "keep" ? result.keeper : undefined,
      true,
    )) return false;
  }
  return true;
}
