import { useMutation, useQueryClient } from "@tanstack/react-query";

import { getPendingEvents, removeSyncEvent, updateSyncEvent, type SyncEntity } from "@/lib/idb-queue";

function endpointFor(entity: SyncEntity) {
  return entity === "income_expense" ? "/api/lanflow/income-expense" : "/api/lanflow/rubber-bills";
}

export function usePerRecordSyncRetry(locationId: string, ownerUserId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ entity, id }: { entity: SyncEntity; id: string }) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error("ซิงก์รายการได้เมื่อออนไลน์เท่านั้น");
      }

      const event = (await getPendingEvents({ entity, ownerUserId, locationId }))
        .find((candidate) => candidate.id === id && candidate.status === "failed");
      if (!event) throw new Error("ไม่พบรายการที่ซิงก์ไม่สำเร็จ");

      try {
        const response = await fetch(endpointFor(entity), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event.payload),
        });
        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          await removeSyncEvent(event.queueId!);
          return;
        }

        event.status = data.status === "conflict" ? "conflict" : "failed";
        event.errorMessage = data.errorMessage || data.error || "ซิงก์รายการไม่สำเร็จ";
        await updateSyncEvent(event);
        throw new Error(event.errorMessage);
      } finally {
        queryClient.invalidateQueries({ queryKey: ["incomeExpenseFeed", ownerUserId, locationId] });
        queryClient.invalidateQueries({ queryKey: ["incomeExpensePending", ownerUserId, locationId] });
        queryClient.invalidateQueries({ queryKey: ["rubberBills", ownerUserId, locationId] });
      }
    },
  });

  return { retrySyncEvent: mutation.mutateAsync, isRetrying: mutation.isPending };
}
