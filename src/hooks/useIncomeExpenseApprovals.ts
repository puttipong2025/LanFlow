import { useEffect } from "react";
import { incomeApprovalBillNumber } from "@/lib/income-expense/numbering-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { buildIncomeExpensePayload } from "@/lib/income-expense/build-income-expense-payload";
import {
  INCOME_EXPENSE_APPROVAL_REQUESTS_QUERY_KEY as REQUESTS_KEY,
  INCOME_EXPENSE_FEED_QUERY_KEY,
} from "@/lib/income-expense/query-keys";
import { ACTIONABLE_BADGES_QUERY_KEY } from "@/hooks/useActionableBadges";
import { authFetch } from "@/lib/auth-fetch";
import { bangkokDateString } from "@/lib/bangkok-date";
import { readAllSupabaseRows } from "@/lib/supabase-pages";
import { getConnectivitySnapshot } from "@/lib/connectivity";
import { readApprovalDecisionResponse } from "@/lib/income-expense/approval-decision-response";
import { isApprovalRequestResult } from "@/lib/income-expense/contracts";
import { addApprovalKeyword, disableApprovalKeyword, saveApprovalSettings, readApprovalSettings, readApprovalKeyword, assertApprovalSettingsOnline, APPROVAL_SETTINGS_COLUMNS, APPROVAL_KEYWORD_COLUMNS, type ApprovalSettingsInput, type ApprovalKeywordInput } from "@/lib/income-expense/approval-settings-mutations";
import { invalidateBranchTransferDeletionViews } from "@/lib/money-flow/invalidation";
import {
  decideBranchTransferDeleteRequest,
  loadBranchTransferDeleteRequests,
  loadPendingApprovalCount,
} from "@/lib/income-expense/branch-transfer-delete-approvals";
import {
  assertOfflineIncomeExpenseDateAllowed,
  loadIncomeExpenseApprovalSettingsCache,
  saveIncomeExpenseApprovalSettingsCache,
} from "@/lib/income-expense/approval-cache";
import type {
  CashTransferDeleteRequest,
  IncomeExpense,
  IncomeExpenseApprovalAppliesTo,
  IncomeExpenseApprovalKeyword,
  IncomeExpenseApprovalRequest,
  IncomeExpenseApprovalSettings,
  QueueOperation,
} from "@/types";

const KEYWORDS_KEY = "incomeExpenseApprovalKeywords";
const SETTINGS_KEY = "incomeExpenseApprovalSettings";
const APPROVAL_HISTORY_LIMIT = 80;

type ApprovalSubmitResult = {
  requiresApproval: boolean;
};

function appliesToType(appliesTo: IncomeExpenseApprovalAppliesTo, type: "income" | "expense") {
  return appliesTo === "both" || appliesTo === type;
}

function keywordMatches(keyword: IncomeExpenseApprovalKeyword, tx: IncomeExpense) {
  if (!keyword.isActive || !appliesToType(keyword.appliesTo, tx.type)) return false;
  if (keyword.approvalMinAmount != null && tx.cost < keyword.approvalMinAmount) return false;

  const haystack = tx.title.trim().toLowerCase();
  const needle = keyword.keyword.trim().toLowerCase();
  if (!needle) return false;

  return keyword.matchMode === "exact" ? haystack === needle : haystack.includes(needle);
}

function settingsMatch(settings: IncomeExpenseApprovalSettings | undefined, tx: IncomeExpense) {
  if (settings?.approvalMinAmount == null) return false;
  return appliesToType(settings.appliesTo, tx.type) && tx.cost >= settings.approvalMinAmount;
}

export function getIncomeExpenseApprovalReasons(
  keywords: IncomeExpenseApprovalKeyword[],
  settings: IncomeExpenseApprovalSettings | undefined,
  tx: IncomeExpense,
) {
  const reasons: Array<"keyword" | "amount_threshold" | "non_current_date"> = [];
  if (keywords.some((keyword) => keywordMatches(keyword, tx))) reasons.push("keyword");
  if (settingsMatch(settings, tx)) reasons.push("amount_threshold");
  if (settings?.nonCurrentDateRequiresApproval && tx.txDate !== bangkokDateString()) {
    reasons.push("non_current_date");
  }
  return reasons;
}

export function useIncomeExpenseApprovals(options: {
  includeRequests?: boolean;
  includePendingCount?: boolean;
  requestsLocationId?: string;
  pendingLocationId?: string;
} = {}) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();
  const includeRequests = options.includeRequests ?? false;
  const includePendingCount = options.includePendingCount ?? includeRequests;
  const requestsLocationId = options.requestsLocationId;
  const pendingLocationId = options.pendingLocationId;

  const keywordsQuery = useQuery({
    networkMode: "always",
    retry: false,
    queryKey: [KEYWORDS_KEY],
    queryFn: async () => {
      assertApprovalSettingsOnline();
      const { data, error } = await supabase
        .from("income_expense_approval_keywords")
        .select(APPROVAL_KEYWORD_COLUMNS)
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message || JSON.stringify(error));

      return (data || []).map(readApprovalKeyword);
    },
  });

  const settingsQuery = useQuery({
    networkMode: "always",
    retry: false,
    queryKey: [SETTINGS_KEY],
    queryFn: async () => {
      assertApprovalSettingsOnline();
      const { data, error } = await supabase
        .from("income_expense_approval_settings")
        .select(APPROVAL_SETTINGS_COLUMNS)
        .eq("id", true)
        .maybeSingle();

      if (error) throw new Error(error.message || JSON.stringify(error));

      return readApprovalSettings(data);
    },
  });

  const requestsQuery = useQuery({
    queryKey: [REQUESTS_KEY, "requests", requestsLocationId ?? "all"],
    enabled: includeRequests,
    queryFn: async () => {
      const pendingRows = await readAllSupabaseRows((from, to) => {
        let query = supabase
          .from("income_expense_approval_requests")
          .select("id, request_status, requested_operation, matched_keyword, matched_reasons, location_id, tx_type, title, cost, requested_payload, requested_by_name, requested_by_phone, decided_by_name, decided_by_phone, created_at, approvedBill:income_expense!approved_income_expense_id(server_bill_no)")
          .eq("request_status", "pending");
        if (requestsLocationId) query = query.eq("location_id", requestsLocationId);
        return query
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to);
      });
      let historyQuery = supabase
        .from("income_expense_approval_requests")
        .select("id, request_status, requested_operation, matched_keyword, matched_reasons, location_id, tx_type, title, cost, requested_payload, requested_by_name, requested_by_phone, decided_by_name, decided_by_phone, created_at, approvedBill:income_expense!approved_income_expense_id(server_bill_no)")
        .neq("request_status", "pending");
      if (requestsLocationId) historyQuery = historyQuery.eq("location_id", requestsLocationId);
      const historyResult = await historyQuery
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(APPROVAL_HISTORY_LIMIT);
      if (historyResult.error) {
        throw new Error(historyResult.error.message || JSON.stringify(historyResult.error));
      }

      const rowsById = new Map(
        [...pendingRows, ...(historyResult.data || [])].map((row) => [row.id, row]),
      );
      return [...rowsById.values()].map((row: any): IncomeExpenseApprovalRequest => ({
        id: row.id, billNumber: incomeApprovalBillNumber(row.requested_payload, row.approvedBill?.server_bill_no),
        requestStatus: row.request_status,
        requestedOperation: row.requested_operation,
        matchedKeyword: row.matched_keyword,
        matchedReasons: row.matched_reasons,
        locationId: row.location_id,
        txType: row.tx_type,
        title: row.title,
        cost: Number(row.cost),
        saleLines: Array.isArray(row.requested_payload?.saleLines)
          ? row.requested_payload.saleLines
          : undefined,
        requestedByName: row.requested_by_name,
        requestedByPhone: row.requested_by_phone,
        decidedByName: row.decided_by_name,
        decidedByPhone: row.decided_by_phone,
        createdAt: row.created_at,
      }));
    },
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    saveIncomeExpenseApprovalSettingsCache(settingsQuery.data.nonCurrentDateRequiresApproval);
  }, [settingsQuery.data]);

  const cashDeleteRequestsQuery = useQuery({
    queryKey: [
      REQUESTS_KEY,
      "cashTransferDeletes",
      requestsLocationId ?? "all",
    ],
    enabled: includeRequests,
    queryFn: async () => {
      const pendingRows = await readAllSupabaseRows((from, to) => {
        let query = supabase
          .from("cash_transfer_delete_requests")
          .select("id, source_location_id, source_location_name, target_location_name, transfer_display_no, sent_total, received_total, difference_total, request_status, requested_by_name, requested_by_phone, decided_by_name, decided_by_phone, created_at")
          .eq("request_status", "pending");
        if (requestsLocationId) query = query.eq("source_location_id", requestsLocationId);
        return query
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to);
      });
      let historyQuery = supabase
        .from("cash_transfer_delete_requests")
        .select("id, source_location_id, source_location_name, target_location_name, transfer_display_no, sent_total, received_total, difference_total, request_status, requested_by_name, requested_by_phone, decided_by_name, decided_by_phone, created_at")
        .neq("request_status", "pending");
      if (requestsLocationId) historyQuery = historyQuery.eq("source_location_id", requestsLocationId);
      const historyResult = await historyQuery
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(APPROVAL_HISTORY_LIMIT);
      if (historyResult.error) {
        throw new Error(historyResult.error.message || JSON.stringify(historyResult.error));
      }

      const rowsById = new Map(
        [...pendingRows, ...(historyResult.data || [])].map((row) => [row.id, row]),
      );
      return [...rowsById.values()].map((row: any): CashTransferDeleteRequest => ({
        id: row.id,
        sourceLocationId: row.source_location_id,
        sourceLocationName: row.source_location_name,
        targetLocationName: row.target_location_name,
        transferDisplayNo: row.transfer_display_no,
        sentTotal: Number(row.sent_total),
        receivedTotal: Number(row.received_total),
        differenceTotal: Number(row.difference_total),
        requestStatus: row.request_status,
        requestedByName: row.requested_by_name,
        requestedByPhone: row.requested_by_phone,
        decidedByName: row.decided_by_name,
        decidedByPhone: row.decided_by_phone,
        createdAt: row.created_at,
      }));
    },
  });

  const branchDeleteRequestsQuery = useQuery({
    queryKey: [REQUESTS_KEY, "branchTransferDeletes", requestsLocationId ?? "all"],
    enabled: includeRequests,
    queryFn: () => loadBranchTransferDeleteRequests(supabase, requestsLocationId),
  });

  const pendingCountQuery = useQuery({
    queryKey: [REQUESTS_KEY, "pendingCount", pendingLocationId ?? "all"],
    enabled: includePendingCount,
    queryFn: () => loadPendingApprovalCount(supabase, pendingLocationId),
  });

  // Refetch while online; invalidate without a paused read after an offline write failure.
  async function refreshConfiguration(key: string) {
    if (!getConnectivitySnapshot()) {
      await queryClient.invalidateQueries({ queryKey: [key], refetchType: "none" });
      return false;
    }
    try {
      await queryClient.refetchQueries({ queryKey: [key], type: "active" }, { throwOnError: true });
      return true;
    } catch { return false; }
  }

  const addKeywordMutation = useMutation({
    networkMode: "always",
    mutationFn: (input: ApprovalKeywordInput) => addApprovalKeyword(supabase, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEYWORDS_KEY], refetchType: getConnectivitySnapshot() ? "active" : "none" }),
  });
  const disableKeywordMutation = useMutation({
    networkMode: "always",
    mutationFn: (id: string) => disableApprovalKeyword(supabase, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEYWORDS_KEY], refetchType: getConnectivitySnapshot() ? "active" : "none" }),
  });
  const saveSettingsMutation = useMutation({
    networkMode: "always",
    mutationFn: (input: ApprovalSettingsInput) => saveApprovalSettings(supabase, input),
    onSuccess: async (patch) => {
      // Stop an older read before applying this section's authoritative acknowledgement.
      await queryClient.cancelQueries({ queryKey: [SETTINGS_KEY] });
      queryClient.setQueryData<IncomeExpenseApprovalSettings>([SETTINGS_KEY], (current) => current ? { ...current, ...patch } : current);
      if (patch.nonCurrentDateRequiresApproval !== undefined) saveIncomeExpenseApprovalSettingsCache(patch.nonCurrentDateRequiresApproval);
      await queryClient.invalidateQueries({ queryKey: [SETTINGS_KEY], refetchType: getConnectivitySnapshot() ? "active" : "none" });
    },
  });

  const decideRequestMutation = useMutation({
    mutationFn: async ({ id, decision, comment }: { id: string; decision: "approved" | "rejected"; comment?: string }) => {
      const response = await authFetch(`/api/lanflow/income-expense/approval-requests/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment }),
      });

      return readApprovalDecisionResponse(response, id, decision, true);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [REQUESTS_KEY] }),
        queryClient.invalidateQueries({ queryKey: [INCOME_EXPENSE_FEED_QUERY_KEY] }),
        queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] }),
        queryClient.invalidateQueries({ queryKey: ["stock"] }),
      ]);
    },
  });

  const decideCashDeleteRequestMutation = useMutation({
    mutationFn: async ({ id, decision, comment }: { id: string; decision: "approved" | "rejected"; comment?: string }) => {
      const response = await authFetch(`/api/lanflow/cash-branch-transfers/delete-requests/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment }),
      });

      return readApprovalDecisionResponse(response, id, decision);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [REQUESTS_KEY] }),
        queryClient.invalidateQueries({ queryKey: [INCOME_EXPENSE_FEED_QUERY_KEY] }),
        queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] }),
        queryClient.invalidateQueries({ queryKey: ["cashBranchTransfers"] }),
      ]);
    },
  });

  const decideBranchDeleteRequestMutation = useMutation({
    mutationFn: decideBranchTransferDeleteRequest,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [REQUESTS_KEY] }),
        invalidateBranchTransferDeletionViews(queryClient),
      ]);
    },
  });

  function validateLocalCreate(transaction: IncomeExpense) {
    if (typeof navigator === "undefined" || navigator.onLine) return;
    assertOfflineIncomeExpenseDateAllowed(transaction.txDate, loadIncomeExpenseApprovalSettingsCache(), false);
    if (getIncomeExpenseApprovalReasons(keywordsQuery.data ?? [], settingsQuery.data, transaction).length) {
      throw new Error("รายการนี้ต้องรออนุมัติ ต้องออนไลน์ก่อนบันทึก");
    }
  }

  async function submitForApprovalIfNeeded(
    transaction: IncomeExpense,
    operation: QueueOperation
  ): Promise<ApprovalSubmitResult> {
    if (transaction.billOption === "บิลขาย" && operation === "create") {
      return { requiresApproval: false };
    }

    const localReasons = getIncomeExpenseApprovalReasons(
      keywordsQuery.data ?? [],
      settingsQuery.data,
      transaction,
    );
    const localRequiresApproval = localReasons.length > 0;

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      assertOfflineIncomeExpenseDateAllowed(
        transaction.txDate,
        loadIncomeExpenseApprovalSettingsCache(),
        false,
      );
      if (localRequiresApproval) {
        throw new Error("รายการนี้ต้องรออนุมัติ ต้องออนไลน์ก่อนบันทึก");
      }
      return { requiresApproval: false };
    }

    const payload = buildIncomeExpensePayload(transaction, operation);

    const response = await authFetch("/api/lanflow/income-expense/approval-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.errorMessage || data.error || "ตรวจสอบคำขออนุมัติไม่สำเร็จ");
    }
    if (!isApprovalRequestResult(data) || data.status === "failed") {
      throw new Error("ยังยืนยันผลคำขออนุมัติไม่ได้ กรุณาโหลดรายการล่าสุดก่อนบันทึกอีกครั้ง");
    }

    if (data.status === "pending") {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [REQUESTS_KEY] }),
        queryClient.invalidateQueries({ queryKey: [INCOME_EXPENSE_FEED_QUERY_KEY] }),
        queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] }),
      ]);
      return { requiresApproval: true };
    }

    return { requiresApproval: false };
  }

  async function retryRequestLoads() {
    const retries: Promise<unknown>[] = [];
    if (includeRequests) {
      retries.push(requestsQuery.refetch(), cashDeleteRequestsQuery.refetch(), branchDeleteRequestsQuery.refetch());
    }
    if (includePendingCount) retries.push(pendingCountQuery.refetch());
    await Promise.all(retries);
  }

  const hasRequestLoadError =
    (includeRequests && (requestsQuery.isError || cashDeleteRequestsQuery.isError || branchDeleteRequestsQuery.isError))
    || (includePendingCount && pendingCountQuery.isError);

  return {
    keywords: keywordsQuery.data || [],
    settings: settingsQuery.data,
    requests: requestsQuery.data || [],
    cashDeleteRequests: cashDeleteRequestsQuery.data || [],
    branchDeleteRequests: branchDeleteRequestsQuery.data || [],
    pendingCount: pendingCountQuery.data ?? 0,
    hasRequestLoadError,
    isRefetchingRequests:
      (includeRequests && (requestsQuery.isFetching || cashDeleteRequestsQuery.isFetching || branchDeleteRequestsQuery.isFetching))
      || (includePendingCount && pendingCountQuery.isFetching),
    settingsLoading: settingsQuery.isLoading,
    keywordsLoading: keywordsQuery.isLoading,
    settingsError: settingsQuery.isError,
    keywordsError: keywordsQuery.isError,
    retrySettings: async () => await refreshConfiguration(SETTINGS_KEY) ? queryClient.getQueryData<IncomeExpenseApprovalSettings>([SETTINGS_KEY]) : undefined,
    retryKeywords: async () => await refreshConfiguration(KEYWORDS_KEY) ? queryClient.getQueryData<IncomeExpenseApprovalKeyword[]>([KEYWORDS_KEY]) : undefined,
    requestsLoading: Boolean((includeRequests && (requestsQuery.isLoading || cashDeleteRequestsQuery.isLoading || branchDeleteRequestsQuery.isLoading)) || (includePendingCount && pendingCountQuery.isLoading)),
    isLoading:
      keywordsQuery.isLoading ||
      settingsQuery.isLoading ||
      (includeRequests && requestsQuery.isLoading) ||
      (includeRequests && cashDeleteRequestsQuery.isLoading) ||
      (includeRequests && branchDeleteRequestsQuery.isLoading) ||
      (includePendingCount && pendingCountQuery.isLoading),
    addKeyword: addKeywordMutation.mutateAsync,
    disableKeyword: disableKeywordMutation.mutateAsync,
    saveSettings: saveSettingsMutation.mutateAsync,
    decideRequest: decideRequestMutation.mutateAsync,
    decideCashDeleteRequest: decideCashDeleteRequestMutation.mutateAsync,
    decideBranchDeleteRequest: decideBranchDeleteRequestMutation.mutateAsync,
    retryRequestLoads,
    submitForApprovalIfNeeded,
    validateLocalCreate,
  };
}
