import { notifyRubberBackgroundFailure } from "@/lib/rubber-bills/background-notifications";
import { sendRubberBillCommand, isConfirmedRubberSyncResult, recordRubberSyncFailure, acknowledgeRubberCommand } from "@/lib/rubber-bills/command";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  getPendingEvents,
  removeSyncEventIfCurrent,
  reconcileSyncEventsIfCurrent,
  updateSyncEvent,
  updateSyncEventIfCurrent,
  type SyncEntity,
} from "@/lib/idb-queue";

import { authFetch } from "@/lib/auth-fetch";
import { invalidateMoneyFlowLocation } from "@/lib/money-flow/invalidation";
import { removeConfirmedRubberBillLocally } from "@/lib/rubber-bills/feed-cache";
import { isCashCountLockSyncResponse, isRetryableSyncResponse } from "@/lib/sync-response";

export function usePerRecordSyncRetry(locationId: string, ownerUserId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({
      entity,
      id,
      locationId: submissionLocationId,
      ownerUserId: submissionOwnerUserId,
    }: {
      entity: SyncEntity;
      id: string;
      locationId: string;
      ownerUserId: string;
    }) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error("ซิงก์รายการได้เมื่อออนไลน์เท่านั้น");
      }

      const event = (await getPendingEvents({
        entity,
        ownerUserId: submissionOwnerUserId,
        locationId: submissionLocationId,
      }))
        .find((candidate) => candidate.id === id && (
          candidate.status === "failed" || candidate.status === "conflict"
        ));
      if (!event) throw new Error("ไม่พบรายการที่ซิงก์ไม่สำเร็จ");

      try {
        if (entity === "rubber_bills") {
          const marked = { ...event, serverSubmissionAttempted: true };
          if (!await reconcileSyncEventsIfCurrent([event], marked)) throw new Error("คิวเปลี่ยนจากอีกหน้าต่าง กรุณาลองใหม่");
          Object.assign(event, marked);
        }
        if (entity === "income_expense") {
          event.serverSubmissionAttempted = true;
          await updateSyncEvent(event);
        }
        const submission = entity === "rubber_bills"
          ? {
            ...event.payload,
            ...(event.operation !== "create" && event.serverId
              ? { expectedServerId: event.serverId }
              : {}),
            submissionMode: "replay",
          }
          : event.payload;
        const response = await (entity === "rubber_bills" ? sendRubberBillCommand(event, submission) : authFetch("/api/lanflow/income-expense", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(submission),
        })).catch(async (error) => {
          if (entity === "rubber_bills") await recordRubberSyncFailure(event, 0, {});
          throw error;
        });
        const data = await response.json().catch(() => ({}));

        if (entity === "rubber_bills" && (isRetryableSyncResponse(response.status, data)
            || (response.ok && !isConfirmedRubberSyncResult(data, event)))) {
          await recordRubberSyncFailure(event, response.status, data);
          throw new Error(event.errorMessage);
        }

        if (response.ok) {
          if (entity === "rubber_bills" && event.payload.background) {
            if (!await acknowledgeRubberCommand(event, data)) throw new Error("คิวเปลี่ยนระหว่างยืนยันผล");
          } else if (entity === "rubber_bills" && event.operation === "delete" && data.status === "synced") {
            if (!await removeSyncEventIfCurrent(event)) throw new Error("ข้อมูลคิวเปลี่ยนระหว่างยืนยันผล กรุณารอซิงก์อีกครั้ง");
            await removeConfirmedRubberBillLocally(
              queryClient,
              { ownerUserId: submissionOwnerUserId, locationId: submissionLocationId },
              event.id,
            );
          } else if (entity === "rubber_bills") {
            try {
              await removeSyncEventIfCurrent(event);
            } catch (error) {
              console.warn("Unable to remove confirmed Rubber Bill retry queue event", error);
            }
          } else {
            await removeSyncEventIfCurrent(event);
          }
          return data.silent ? "silent" : data.status;
        }

        if (entity === "rubber_bills") {
          const outcome = await recordRubberSyncFailure(event, response.status, data);
          if (event.payload.background) { await notifyRubberBackgroundFailure(event); return "silent"; }
          throw new Error(outcome === "discarded"
            ? "ทิ้งรายการค้างที่ข้อมูลชนกันแล้ว บิลบนเซิร์ฟเวอร์ยังคงเดิม"
            : event.errorMessage);
        }

        if (isCashCountLockSyncResponse(data) && response.status === 409) {
          event.status = "pending";
          event.errorMessage = data.errorMessage;
          await updateSyncEventIfCurrent(event);
          throw new Error(data.errorMessage);
        }
        if (!isRetryableSyncResponse(response.status, data)) {
          event.serverSubmissionAttempted = false;
        }
        event.status = data.status === "conflict" ? "conflict" : "failed";
        event.errorMessage = data.errorMessage || data.error || "ซิงก์รายการไม่สำเร็จ";
        await updateSyncEventIfCurrent(event);
        throw new Error(event.errorMessage);
      } finally {
        const refresh = invalidateMoneyFlowLocation(queryClient, {
          ownerUserId: submissionOwnerUserId,
          locationId: submissionLocationId,
        });
        if (entity === "rubber_bills" && event.payload.background) await refresh.catch(() => {});
        else await refresh;
      }
    },
  });

  return {
    retrySyncEvent: ({ entity, id }: { entity: SyncEntity; id: string }) => mutation.mutateAsync({
      entity,
      id,
      locationId,
      ownerUserId,
    }),
    isRetrying: mutation.isPending,
  };
}
