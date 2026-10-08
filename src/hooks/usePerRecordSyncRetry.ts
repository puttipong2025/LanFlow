import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  getPendingEvents,
  removeSyncEventIfCurrent,
  updateSyncEvent,
  updateSyncEventIfCurrent,
  type SyncEntity,
} from "@/lib/idb-queue";

import { authFetch } from "@/lib/auth-fetch";
import { invalidateMoneyFlowLocation } from "@/lib/money-flow/invalidation";
import { removeConfirmedRubberBillLocally } from "@/lib/rubber-bills/feed-cache";
import { isRetryableSyncResponse } from "@/lib/sync-response";
function endpointFor(entity: SyncEntity) {
  return entity === "income_expense" ? "/api/lanflow/income-expense" : "/api/lanflow/rubber-bills";
}

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
        const response = await authFetch(endpointFor(entity), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(submission),
        });
        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          if (entity === "rubber_bills" && event.operation === "delete" && data.status === "synced") {
            await removeConfirmedRubberBillLocally(
              queryClient,
              { ownerUserId: submissionOwnerUserId, locationId: submissionLocationId },
              event.id,
              event.queueId,
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
          return;
        }

        if (entity === "income_expense" && !isRetryableSyncResponse(response.status)) {
          event.serverSubmissionAttempted = false;
        }
        event.status = data.status === "conflict" ? "conflict" : "failed";
        event.errorMessage = data.errorMessage || data.error || "ซิงก์รายการไม่สำเร็จ";
        await updateSyncEventIfCurrent(event);
        throw new Error(event.errorMessage);
      } finally {
        await invalidateMoneyFlowLocation(queryClient, {
          ownerUserId: submissionOwnerUserId,
          locationId: submissionLocationId,
        });
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
