import { type InfiniteData, type QueryClient } from "@tanstack/react-query";

import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";
import {
  removeSyncEvent,
  tombstoneRubberBillReceiptSnapshotsByClientTempId,
} from "@/lib/idb-queue";
import type { RubberBill } from "@/types";

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
