import { authFetch } from "@/lib/auth-fetch";
import type { SyncEvent } from "@/lib/idb-queue";
import { createScopedSingleFlight } from "@/lib/scoped-single-flight";

const sendOnce = createScopedSingleFlight();

export async function sendRubberBillCommand(event: SyncEvent, submission: Record<string, unknown>) {
  const key = JSON.stringify([event.ownerUserId, event.locationId, event.id, event.queueId, event.payload]);
  const response = await sendOnce(key, () => authFetch("/api/lanflow/rubber-bills", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submission),
  }));
  return response.clone();
}
