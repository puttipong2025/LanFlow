import { authFetch } from "@/lib/auth-fetch";
import type { SyncEvent } from "@/lib/idb-queue";
import { createScopedSingleFlight } from "@/lib/scoped-single-flight";
import { isConfirmedRubberSyncResult } from "@/lib/rubber-bills/sync-result";

const sendOnce = createScopedSingleFlight();

export async function sendRubberBillCommand(event: SyncEvent, submission: Record<string, unknown>) {
  const key = JSON.stringify([event.ownerUserId, event.locationId, event.id, event.queueId, event.payload]);
  const response = await sendOnce(key, async () => {
    const deleted = await probeDeletedRubberCommand(event);
    if (deleted) return deleted;
    const submitted = await authFetch("/api/lanflow/rubber-bills", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submission),
    });
    if (event.payload.background && event.operation !== "create" && submitted.ok) {
      const result = await submitted.clone().json().catch(() => null);
      if (isConfirmedRubberSyncResult(result, event)) return Response.json({ ...result, silent: true });
    }
    return submitted;
  });
  if (event.payload.contractVersion === 2 && response.ok) {
    const result = await response.clone().json().catch(() => null);
    if (!isConfirmedRubberSyncResult(result, event)) {
      return Response.json({ status: "failed", errorMessage: "กำลังรอยืนยันผลคำสั่งจากเซิร์ฟเวอร์" }, { status: 503 });
    }
  }
  return response.clone();
}

export async function probeDeletedRubberCommand(event: SyncEvent): Promise<Response | null> {
  if (event.payload.background && event.operation !== "create" && event.serverId
      && event.payload.clientTempId === event.id && event.payload.locationId === event.locationId
      && event.payload.operation === event.operation) {
    try {
      const params = new URLSearchParams({ locationId: event.locationId, clientTempId: event.id });
      const probe = await authFetch(`/api/lanflow/rubber-bills/command-context?${params}`);
      const context = probe.ok ? await probe.json() : null;
      if (context?.recordStatus === "deleted" && context.serverId === event.serverId) {
        return Response.json({ status: "discarded", commandId: event.payload.commandId, operation: event.operation,
          clientTempId: event.id, errorCode: "BILL_ALREADY_DELETED", silent: true });
      }
    } catch { /* No deletion proof: replay the immutable command normally. */ }
  }
  return null;
}
