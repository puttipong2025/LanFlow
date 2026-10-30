import { type InfiniteData, type QueryClient } from "@tanstack/react-query";

import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";
import {
  getPendingEvents,
  removeSyncEvent,
  tombstoneRubberBillReceiptSnapshotsByClientTempId,
} from "@/lib/idb-queue";
import type { RubberBill } from "@/types";
import type { SyncEvent } from "@/lib/idb-queue";
import { mergeRubberBillLocalEvents } from "./local-feed";
import { isSameSyncCommand } from "@/lib/sync-event-comparison";

export async function publishRubberBillLocalQueue(
  queryClient: QueryClient,
  scope: { ownerUserId: string; locationId: string },
  clientTempId: string,
  committedLocalEvent?: SyncEvent,
) {
  const key = ["rubberBillLocalState", scope.ownerUserId, scope.locationId];
  const beforeRead = queryClient.getQueryData<{ events: SyncEvent[] }>(key);
  try {
    const events = await getPendingEvents({ entity: "rubber_bills", ...scope });
    queryClient.setQueryData(key, { events });
  } catch {
    // A failed presentation read cannot undo a commit or newer queue progress.
    queryClient.setQueryData<{ events: SyncEvent[] }>(key, previous => {
      const cached = previous?.events ?? [];
      const currentTarget = cached.find(event => event.id === clientTempId);
      const beforeTarget = beforeRead?.events.find(event => event.id === clientTempId);
      if (previous && currentTarget !== beforeTarget) return previous;
      const retained = committedLocalEvent && (currentTarget && isSameSyncCommand(currentTarget, committedLocalEvent)
        ? currentTarget : committedLocalEvent);
      return { events: [...cached.filter(event => event.id !== clientTempId), ...(retained ? [retained] : [])] };
    });
    console.warn("Unable to reread Rubber queue after commit; retaining committed local state");
  }
}

export async function preserveRubberApprovalInCache(queryClient: QueryClient, event: SyncEvent, requestId: string) {
  const queryKey = [...moneyFlowQueryKeys.rubberBillOperationalFeedRoot(), event.ownerUserId, event.locationId];
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueriesData<InfiniteData<RubberBillOperationalFeedPage>>({ queryKey }, cached => cached ? {
    ...cached, pages: cached.pages.map(page => ({ ...page, bills: page.bills.map(bill => {
      if (bill.clientTempId !== event.id
        || (event.operation === "create" && Boolean(bill.serverBillNo))
        || (event.operation !== "create" && bill.revisionNo !== event.payload.expectedRevisionNo)
        || (bill.approvalPending && bill.approvalRequestId && bill.approvalRequestId !== requestId)) return bill;
      const [merged] = mergeRubberBillLocalEvents([bill], [event], event.ownerUserId);
      return { ...merged, syncStatus: "synced" as const, serverSubmissionAttempted: false,
        approvalPending: true, approvalOperation: event.operation, approvalRequestId: requestId };
    }) })),
  } : cached);
}

type RubberBillEvidenceState = { billId: string };

type RubberBillOperationalFeedPage = {
  bills: RubberBill[];
  evidenceStates: RubberBillEvidenceState[];
  nextCursor: string | null;
  hasMore: boolean;
};

async function removeMatchingRubberBillFromOperationalFeedCache(
  queryClient: QueryClient,
  scope: { ownerUserId: string; locationId: string },
  matches: (bill: RubberBill) => boolean,
  queryKeySuffix: readonly unknown[] = [],
) {
  const queryKey = [
    ...moneyFlowQueryKeys.rubberBillOperationalFeedRoot(),
    scope.ownerUserId,
    scope.locationId,
    ...queryKeySuffix,
  ];
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueriesData<InfiniteData<RubberBillOperationalFeedPage>>(
    { queryKey },
    (cached) => {
      if (!cached) return cached;
      return {
        ...cached,
        pages: cached.pages.map((page) => {
          const removedBillIds = new Set(
            page.bills
              .filter(matches)
              .map((bill) => bill.id),
          );
          return {
            ...page,
            bills: page.bills.filter((bill) => !matches(bill)),
            evidenceStates: page.evidenceStates.filter((state) => !removedBillIds.has(state.billId)),
          };
        }),
      };
    },
  );
}

export function removeRubberBillFromOperationalFeedCache(
  queryClient: QueryClient,
  scope: { ownerUserId: string; locationId: string },
  clientTempId: string,
) {
  return removeMatchingRubberBillFromOperationalFeedCache(
    queryClient,
    scope,
    (bill) => bill.clientTempId === clientTempId,
  );
}

export function removeRubberBillFromOperationalFeedCacheByBillId(
  queryClient: QueryClient,
  scope: { ownerUserId: string; locationId: string },
  billId: string,
) {
  return removeMatchingRubberBillFromOperationalFeedCache(
    queryClient,
    scope,
    (bill) => bill.id === billId,
  );
}

export function removeRubberBillApprovalRequestFromPendingFeedCache(
  queryClient: QueryClient,
  scope: { ownerUserId: string; locationId: string },
  requestId: string,
) {
  return removeMatchingRubberBillFromOperationalFeedCache(
    queryClient,
    scope,
    (bill) => bill.approvalRequestId === requestId,
    ["pending_approval"],
  );
}

export async function removeConfirmedRubberBillLocally(
  queryClient: QueryClient,
  scope: { ownerUserId: string; locationId: string },
  clientTempId: string,
  queueId?: number,
) {
  try {
    await removeRubberBillFromOperationalFeedCache(queryClient, scope, clientTempId);
  } catch (error) {
    console.warn("Unable to remove confirmed Rubber Bill from the local feed", error);
  }
  try {
    await tombstoneRubberBillReceiptSnapshotsByClientTempId(scope.locationId, clientTempId);
  } catch (error) {
    console.warn("Unable to remove deleted Rubber Bill receipt snapshot", error);
  }
  if (queueId !== undefined) {
    try {
      await removeSyncEvent(queueId);
    } catch (error) {
      console.warn("Unable to remove confirmed Rubber Bill queue event", error);
    }
  }
}
