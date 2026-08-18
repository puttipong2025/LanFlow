"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { buildRubberBillReceiptModel } from "@/components/rubber-bills/bill-display";
import { mapRubberBillEvidenceState, type EvidenceReviewState } from "@/hooks/useRubberBillEvidenceReview";
import { authFetch, assertApiResponse } from "@/lib/auth-fetch";
import {
  getPendingEvents,
  getRubberBillReceiptSnapshots,
  pruneRubberBillReceiptSnapshots,
  putRubberBillReceiptSnapshots,
} from "@/lib/idb-queue";
import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";
import { mergeRubberBillLocalEvents, rubberBillFromSyncEvent } from "@/lib/rubber-bills/local-feed";
import { mapRubberBillFeedRow } from "@/lib/rubber-bills/map-feed-row";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { RubberBill } from "@/types";

export type RubberBillListMode = "latest" | "unpriced" | "pending_approval" | "sync_problem";
export type RubberBillDocumentStatus = "any" | "editable" | "report_locked" | "in_transfer";

type FeedPage = {
  bills: RubberBill[];
  evidenceStates: EvidenceReviewState[];
  nextCursor: string | null;
  hasMore: boolean;
};

async function localState(ownerUserId: string, locationId: string) {
  const [events, snapshots] = await Promise.all([
    getPendingEvents({ entity: "rubber_bills", ownerUserId, locationId }),
    getRubberBillReceiptSnapshots(locationId).catch(() => []),
  ]);
  return { events, snapshots };
}

function matchesSearch(bill: RubberBill, search: string) {
  if (!search) return true;
  return [bill.billNo, bill.localBillNo, bill.serverBillNo, bill.billDate, bill.customerName,
    bill.billType, bill.createdByName, bill.createdByPhone].join(" ").toLocaleLowerCase("th-TH").includes(search);
}

function matchesMode(bill: RubberBill, mode: RubberBillListMode) {
  if (mode === "unpriced") return (bill.weighItems ?? []).some((item) => item.price <= 0);
  if (mode === "pending_approval") return bill.approvalPending === true;
  if (mode === "sync_problem") return bill.syncStatus === "failed" || bill.syncStatus === "conflict";
  return true;
}

function matchesDocumentStatus(bill: RubberBill, status: RubberBillDocumentStatus) {
  if (status === "editable") return !bill.reportLockNo && !bill.transferLockId && !bill.approvalPending;
  if (status === "report_locked") return Boolean(bill.reportLockNo);
  if (status === "in_transfer") return Boolean(bill.transferLockId);
  return true;
}

function sortBills(bills: RubberBill[], mode: RubberBillListMode) {
  const direction = mode === "latest" ? -1 : 1;
  return [...bills].sort((a, b) => {
    const aSort = a.operationalSortAt ?? a.serverCreatedAt ?? a.clientCreatedAt;
    const bSort = b.operationalSortAt ?? b.serverCreatedAt ?? b.clientCreatedAt;
    return direction * (aSort.localeCompare(bSort) || a.id.localeCompare(b.id));
  });
}

function persistReceiptSnapshots(bills: RubberBill[]) {
  const snapshots = bills.filter((bill) => bill.serverBillNo).map((bill) => ({
    billId: bill.id,
    locationId: bill.locationId,
    serverBillNo: bill.serverBillNo!,
    serverReceivedAt: bill.serverReceivedAt ?? bill.serverCreatedAt ?? bill.clientRecordedAt,
    revisionNo: bill.revisionNo,
    bill,
    receipt: buildRubberBillReceiptModel(bill),
  }));
  if (snapshots.length === 0) return;
  void putRubberBillReceiptSnapshots(snapshots)
    .then(() => pruneRubberBillReceiptSnapshots(snapshots[0].locationId, 100))
    .catch((error) => console.warn("Unable to cache paged rubber bill receipts", error));
}

export function useRubberBillList({
  ownerUserId,
  locationId,
  mode,
  documentStatus,
  search,
}: {
  ownerUserId: string;
  locationId: string;
  mode: RubberBillListMode;
  documentStatus: RubberBillDocumentStatus;
  search: string;
}) {
  const normalizedSearch = search.trim().toLocaleLowerCase("th-TH");
  const queryMode = mode === "sync_problem" ? "latest" : mode;
  const query = useInfiniteQuery({
    queryKey: moneyFlowQueryKeys.rubberBillOperationalFeed(
      ownerUserId, locationId, mode, documentStatus, normalizedSearch,
    ),
    initialPageParam: null as string | null,
    enabled: Boolean(ownerUserId && locationId),
    // This query owns both the server feed and the IndexedDB fallback. TanStack's
    // default "online" mode would pause an invalidated query while offline and
    // hide a draft that was just added to the local queue.
    networkMode: "always",
    queryFn: async ({ pageParam, signal }): Promise<FeedPage> => {
      if (mode === "sync_problem") {
        const events = await getPendingEvents({ entity: "rubber_bills", ownerUserId, locationId });
        const bills = events
          .filter((event) => event.status === "failed" || event.status === "conflict")
          .sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id))
          .map((event) => rubberBillFromSyncEvent(event, ownerUserId))
          .filter((bill): bill is RubberBill => bill !== null)
          .filter((bill) => matchesSearch(bill, normalizedSearch));
        return { bills, evidenceStates: [], nextCursor: null, hasMore: false };
      }
      const { events, snapshots } = await localState(ownerUserId, locationId);
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const cached = snapshots.map((snapshot) => snapshot.bill);
        const merged = mergeRubberBillLocalEvents(cached, events, ownerUserId)
          .filter((bill) => matchesMode(bill, mode))
          .filter((bill) => matchesDocumentStatus(bill, documentStatus))
          .filter((bill) => matchesSearch(bill, normalizedSearch));
        return {
          bills: sortBills(merged, mode),
          evidenceStates: [], nextCursor: null, hasMore: false,
        };
      }

      const params = new URLSearchParams({
        locationId,
        mode: queryMode,
        documentStatus,
        search: normalizedSearch,
        limit: pageParam ? "100" : "150",
      });
      if (pageParam) params.set("cursor", pageParam);
      const response = await authFetch(`/api/lanflow/rubber-bills/feed?${params}`, { signal });
      await assertApiResponse(response);
      const payload = await response.json() as {
        rows?: Record<string, unknown>[];
        evidenceStates?: Record<string, unknown>[];
        nextCursor?: string | null;
        hasMore?: boolean;
      };
      const serverBills = (payload.rows ?? []).map(mapRubberBillFeedRow);
      // A page is sufficient for additive caching, but never authoritative for
      // deleting receipts that may live outside the loaded cursor window.
      persistReceiptSnapshots(serverBills);
      const merged = (pageParam ? serverBills : mergeRubberBillLocalEvents(serverBills, events, ownerUserId))
        .filter((bill) => matchesMode(bill, mode))
        .filter((bill) => matchesDocumentStatus(bill, documentStatus));
      return {
        bills: sortBills(merged, mode),
        evidenceStates: (payload.evidenceStates ?? []).map(mapRubberBillEvidenceState),
        nextCursor: payload.nextCursor ?? null,
        hasMore: Boolean(payload.hasMore),
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const bills = query.data?.pages.flatMap((page) => page.bills) ?? [];
  const evidenceStates = query.data?.pages.flatMap((page) => page.evidenceStates) ?? [];
  return {
    bills,
    evidenceStatesByBillId: new Map(evidenceStates.map((state) => [state.billId, state])),
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasMore: Boolean(query.hasNextPage),
    fetchNextPage: query.fetchNextPage,
    error: query.error,
  };
}

export function useRubberBillWorkCounts(ownerUserId: string, locationId: string) {
  const supabase = createSupabaseBrowserClient();
  return useQuery({
    queryKey: moneyFlowQueryKeys.rubberBillWorkCounts(ownerUserId, locationId),
    enabled: Boolean(ownerUserId && locationId),
    networkMode: "always",
    queryFn: async () => {
      const events = await getPendingEvents({ entity: "rubber_bills", ownerUserId, locationId }).catch(() => []);
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        return {
          unpriced: 0,
          pendingApproval: 0,
          syncProblem: new Set(events.filter((event) => event.status === "failed" || event.status === "conflict").map((event) => event.id)).size,
        };
      }
      const { data, error } = await supabase.rpc("get_rubber_bill_work_counts", { p_location_id: locationId });
      if (error) throw new Error(error.message);
      const value = (data ?? {}) as Record<string, unknown>;
      return {
        unpriced: Number(value.unpriced ?? 0),
        pendingApproval: Number(value.pendingApproval ?? 0),
        syncProblem: new Set(events.filter((event) => event.status === "failed" || event.status === "conflict").map((event) => event.id)).size,
      };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}
