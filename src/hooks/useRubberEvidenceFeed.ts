"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { mapRubberBillEvidenceState, type EvidenceReviewState } from "@/hooks/useRubberBillEvidenceReview";
import { authFetch, assertApiResponse } from "@/lib/auth-fetch";
import { mapRubberBillFeedRow } from "@/lib/rubber-bills/map-feed-row";
import type { RubberBill } from "@/types";

export const RUBBER_EVIDENCE_FEED_QUERY_KEY = "rubberEvidenceFeed";
export type RubberEvidenceView = "pending" | "history";

type EvidenceCardRow = { bill: RubberBill; review: EvidenceReviewState };
type EvidenceFeedPage = { cards: EvidenceCardRow[]; nextCursor: string | null; hasMore: boolean };

export function useRubberEvidenceFeed({
  ownerUserId,
  locationId,
  view,
  search,
  billId,
}: {
  ownerUserId: string;
  locationId: string;
  view: RubberEvidenceView;
  search: string;
  billId: string | null;
}) {
  const normalizedSearch = search.trim().toLocaleLowerCase("th-TH");
  const query = useInfiniteQuery({
    queryKey: [RUBBER_EVIDENCE_FEED_QUERY_KEY, ownerUserId, locationId, view, normalizedSearch, billId],
    initialPageParam: null as string | null,
    enabled: Boolean(ownerUserId && locationId),
    queryFn: async ({ pageParam, signal }): Promise<EvidenceFeedPage> => {
      const params = new URLSearchParams({
        locationId,
        view,
        search: normalizedSearch,
        limit: pageParam ? "50" : "75",
      });
      if (billId) params.set("billId", billId);
      if (pageParam) params.set("cursor", pageParam);
      const response = await authFetch(`/api/lanflow/evidence/feed?${params}`, { signal });
      await assertApiResponse(response);
      const payload = await response.json() as {
        rows?: Array<Record<string, unknown>>;
        nextCursor?: string | null;
        hasMore?: boolean;
      };
      const cards = (payload.rows ?? []).map((row) => ({
        bill: mapRubberBillFeedRow(row),
        review: mapRubberBillEvidenceState((row.evidence_state ?? {}) as Record<string, unknown>),
      }));
      return { cards, nextCursor: payload.nextCursor ?? null, hasMore: Boolean(payload.hasMore) };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return {
    cards: query.data?.pages.flatMap((page) => page.cards) ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    hasMore: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}
