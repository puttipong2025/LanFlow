"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ACTIONABLE_BADGES_QUERY_KEY } from "@/hooks/useActionableBadges";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type EvidenceReviewStatus = "outside" | "normal" | "pending" | "pass" | "improve";

export type EvidenceReviewState = {
  locationId: string;
  billId: string;
  revisionNo: number;
  clientCreatedAt: string | null;
  reviewPeriodId: string | null;
  reviewStatus: EvidenceReviewStatus;
  missingRubber: boolean;
  missingDisplayIn: boolean;
  hasManualCorrection: boolean;
  isUnpriced: boolean;
  hasAnyEvidence: boolean;
  requiredRoleCount: number;
  presentRequiredRoleCount: number;
  decision: "pass" | "improve" | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
};

type EvidenceReviewOverview = {
  isOpen: boolean;
  periodId: string | null;
  openedAt: string | null;
  openedByName: string | null;
  pendingCount: number;
  pendingFingerprint: string;
};

type RpcResult = { state?: string; pendingCount?: number; currentStatus?: string };

export function mapRubberBillEvidenceState(row: Record<string, unknown>): EvidenceReviewState {
  return {
    locationId: String(row.location_id),
    billId: String(row.bill_id),
    revisionNo: Number(row.revision_no),
    clientCreatedAt: row.client_created_at == null ? null : String(row.client_created_at),
    reviewPeriodId: row.review_period_id == null ? null : String(row.review_period_id),
    reviewStatus: String(row.review_status) as EvidenceReviewStatus,
    missingRubber: row.missing_rubber === true,
    missingDisplayIn: row.missing_display_in === true,
    hasManualCorrection: row.has_manual_correction === true,
    isUnpriced: row.is_unpriced === true,
    hasAnyEvidence: row.has_any_evidence === true,
    requiredRoleCount: Number(row.required_role_count ?? 0),
    presentRequiredRoleCount: Number(row.present_required_role_count ?? 0),
    decision: row.decision == null ? null : String(row.decision) as "pass" | "improve",
    reviewedByName: row.reviewed_by_name == null ? null : String(row.reviewed_by_name),
    reviewedAt: row.reviewed_at == null ? null : String(row.reviewed_at),
  };
}

function mapOverview(data: unknown): EvidenceReviewOverview {
  const value = (data ?? {}) as Record<string, unknown>;
  return {
    isOpen: value.isOpen === true,
    periodId: value.periodId == null ? null : String(value.periodId),
    openedAt: value.openedAt == null ? null : String(value.openedAt),
    openedByName: value.openedByName == null ? null : String(value.openedByName),
    pendingCount: Number(value.pendingCount ?? 0),
    pendingFingerprint: String(value.pendingFingerprint ?? ""),
  };
}

const RUBBER_BILL_EVIDENCE_REVIEW_QUERY_KEY = "rubberBillEvidenceReview";

export function useRubberBillEvidenceReview(locationId: string) {
  const queryClient = useQueryClient();
  const supabase = createSupabaseBrowserClient();
  const queryKey = [RUBBER_BILL_EVIDENCE_REVIEW_QUERY_KEY, locationId];

  const query = useQuery({
    queryKey,
    enabled: Boolean(locationId),
    queryFn: async () => {
      const [statesResult, overviewResult] = await Promise.all([
        supabase.rpc("get_rubber_bill_evidence_review_states", { p_location_id: locationId }),
        supabase.rpc("get_rubber_bill_evidence_review_overview", { p_location_id: locationId }),
      ]);
      if (statesResult.error) throw new Error(statesResult.error.message);
      if (overviewResult.error) throw new Error(overviewResult.error.message);
      return {
        states: ((statesResult.data ?? []) as Record<string, unknown>[]).map(mapRubberBillEvidenceState),
        overview: mapOverview(overviewResult.data),
      };
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] }),
    ]);
  }

  function useRpcMutation<TVariables>(
    run: (variables: TVariables) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  ) {
    return useMutation({
      mutationFn: async (variables: TVariables) => {
        const { data, error } = await run(variables);
        if (error) throw new Error(error.message);
        return (data ?? {}) as RpcResult;
      },
      onSuccess: refresh,
    });
  }

  const openMutation = useRpcMutation<void>(() =>
    supabase.rpc("open_rubber_bill_evidence_review_period", { p_location_id: locationId }));
  const closeMutation = useRpcMutation<void>(() =>
    supabase.rpc("close_rubber_bill_evidence_review_period", { p_location_id: locationId }));
  const decideMutation = useRpcMutation<{
    billId: string;
    revisionNo: number;
    expectedStatus: "pending" | "pass" | "improve";
    decision: "pass" | "improve";
  }>((variables) => supabase.rpc("decide_rubber_bill_evidence_review", {
    p_location_id: locationId,
    p_bill_id: variables.billId,
    p_revision_no: variables.revisionNo,
    p_expected_status: variables.expectedStatus,
    p_decision: variables.decision,
  }));
  const passAllMutation = useRpcMutation<{ pendingCount: number; fingerprint: string }>((variables) =>
    supabase.rpc("pass_all_pending_rubber_bill_evidence_reviews", {
      p_location_id: locationId,
      p_expected_pending_count: variables.pendingCount,
      p_expected_pending_fingerprint: variables.fingerprint,
    }));

  const states = query.data?.states ?? [];
  return {
    states,
    statesByBillId: new Map(states.map((state) => [state.billId, state])),
    overview: query.data?.overview ?? {
      isOpen: false,
      periodId: null,
      openedAt: null,
      openedByName: null,
      pendingCount: 0,
      pendingFingerprint: "",
    },
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    openReview: openMutation.mutateAsync,
    closeReview: closeMutation.mutateAsync,
    decide: decideMutation.mutateAsync,
    passAll: passAllMutation.mutateAsync,
    isMutating: openMutation.isPending || closeMutation.isPending || decideMutation.isPending || passAllMutation.isPending,
  };
}
