import { authFetch } from "@/lib/auth-fetch";
import type { SyncEvent } from "@/lib/idb-queue";
import { createScopedSingleFlight } from "@/lib/scoped-single-flight";
import { isConfirmedRubberSyncResult } from "@/lib/rubber-bills/sync-result";

const sendOnce = createScopedSingleFlight();

export async function sendRubberBillCommand(event: SyncEvent, submission: Record<string, unknown>) {
  const key = JSON.stringify([event.ownerUserId, event.locationId, event.id, event.queueId, event.payload]);
  const response = await sendOnce(key, () => authFetch("/api/lanflow/rubber-bills", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submission),
  }));
  if (event.payload.contractVersion === 2 && response.ok) {
    const result = await response.clone().json().catch(() => null);
    if (!isConfirmedRubberSyncResult(result, event)) {
      return Response.json({ status: "failed", errorMessage: "กำลังรอยืนยันผลคำสั่งจากเซิร์ฟเวอร์" }, { status: 503 });
    }
  }
  return response.clone();
}
