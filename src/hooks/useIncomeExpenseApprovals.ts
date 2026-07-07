import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { buildIncomeExpensePayload } from "@/lib/income-expense/build-income-expense-payload";
import type {
  IncomeExpense,
  IncomeExpenseApprovalAppliesTo,
  IncomeExpenseApprovalKeyword,
  IncomeExpenseApprovalMatchMode,
  IncomeExpenseApprovalRequest,
  IncomeExpenseApprovalSettings,
  QueueOperation,
} from "@/types";

const KEYWORDS_KEY = "incomeExpenseApprovalKeywords";
const SETTINGS_KEY = "incomeExpenseApprovalSettings";
const REQUESTS_KEY = "incomeExpenseApprovalRequests";

type AddKeywordInput = {
  keyword: string;
  appliesTo: IncomeExpenseApprovalAppliesTo;
  matchMode: IncomeExpenseApprovalMatchMode;
  approvalMinAmount?: number | null;
};

type SettingsInput = {
  appliesTo: IncomeExpenseApprovalAppliesTo;
  approvalMinAmount?: number | null;
};

type ApprovalSubmitResult = {
  requiresApproval: boolean;
  requestId?: string;
  matchedReason?: string;
  matchedKeyword?: string | null;
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

export function useIncomeExpenseApprovals(options: { includeRequests?: boolean } = {}) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();
  const includeRequests = options.includeRequests ?? false;

  const keywordsQuery = useQuery({
    queryKey: [KEYWORDS_KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("income_expense_approval_keywords")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message || JSON.stringify(error));

      return (data || []).map((row: any): IncomeExpenseApprovalKeyword => ({
        id: row.id,
        keyword: row.keyword,
        matchMode: row.match_mode,
        appliesTo: row.applies_to,
        isActive: row.is_active,
        approvalMinAmount: row.approval_min_amount != null ? Number(row.approval_min_amount) : null,
        createdByName: row.created_by_name,
        createdByPhone: row.created_by_phone,
        createdAt: row.created_at,
      }));
    },
  });

  const settingsQuery = useQuery({
    queryKey: [SETTINGS_KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("income_expense_approval_settings")
        .select("*")
        .eq("id", true)
        .maybeSingle();

      if (error) throw new Error(error.message || JSON.stringify(error));

      return {
        appliesTo: data?.applies_to ?? "both",
        approvalMinAmount: data?.approval_min_amount != null ? Number(data.approval_min_amount) : null,
        updatedByName: data?.updated_by_name,
        updatedByPhone: data?.updated_by_phone,
      } satisfies IncomeExpenseApprovalSettings;
    },
  });

  const requestsQuery = useQuery({
    queryKey: [REQUESTS_KEY],
    enabled: includeRequests,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("income_expense_approval_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(80);

      if (error) throw new Error(error.message || JSON.stringify(error));

      return (data || []).map((row: any): IncomeExpenseApprovalRequest => ({
        id: row.id,
        requestStatus: row.request_status,
        requestedOperation: row.requested_operation,
        matchedKeyword: row.matched_keyword,
        matchedReason: row.matched_reason,
        locationId: row.location_id,
        txType: row.tx_type,
        title: row.title,
        cost: Number(row.cost),
        requestedByName: row.requested_by_name,
        requestedByPhone: row.requested_by_phone,
        decidedByName: row.decided_by_name,
        decidedByPhone: row.decided_by_phone,
        decidedAt: row.decided_at,
        decisionComment: row.decision_comment,
        createdAt: row.created_at,
      }));
    },
  });

  const addKeywordMutation = useMutation({
    mutationFn: async (input: AddKeywordInput) => {
      const { data: { session } } = await supabase.auth.getSession();
      let createdByName = "";
      let createdByPhone = "";

      if (session?.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("name, phone")
          .eq("id", session.user.id)
          .single();

        createdByName = profile?.name ?? "";
        createdByPhone = profile?.phone ?? "";
      }

      const { error } = await supabase.from("income_expense_approval_keywords").insert({
        keyword: input.keyword.trim(),
        applies_to: input.appliesTo,
        match_mode: input.matchMode,
        approval_min_amount: input.approvalMinAmount ?? null,
        created_by_user_id: session?.user?.id,
        created_by_name: createdByName,
        created_by_phone: createdByPhone,
      });

      if (error) throw new Error(error.message || JSON.stringify(error));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEYWORDS_KEY] });
    },
  });

  const disableKeywordMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const { error } = await supabase
        .from("income_expense_approval_keywords")
        .update({
          is_active: false,
          deleted_at: new Date().toISOString(),
          deleted_by_user_id: session?.user?.id,
        })
        .eq("id", id);

      if (error) throw new Error(error.message || JSON.stringify(error));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEYWORDS_KEY] });
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (input: SettingsInput) => {
      const { data: { session } } = await supabase.auth.getSession();
      let updatedByName = "";
      let updatedByPhone = "";

      if (session?.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("name, phone")
          .eq("id", session.user.id)
          .single();

        updatedByName = profile?.name ?? "";
        updatedByPhone = profile?.phone ?? "";
      }

      const { error } = await supabase.from("income_expense_approval_settings").upsert({
        id: true,
        applies_to: input.appliesTo,
        approval_min_amount: input.approvalMinAmount ?? null,
        updated_by_user_id: session?.user?.id,
        updated_by_name: updatedByName,
        updated_by_phone: updatedByPhone,
        updated_at: new Date().toISOString(),
      });

      if (error) throw new Error(error.message || JSON.stringify(error));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SETTINGS_KEY] });
    },
  });

  const decideRequestMutation = useMutation({
    mutationFn: async ({ id, decision, comment }: { id: string; decision: "approved" | "rejected"; comment?: string }) => {
      const response = await fetch(`/api/lanflow/income-expense/approval-requests/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.errorMessage || data.error || "ดำเนินการคำขอไม่สำเร็จ");
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [REQUESTS_KEY] });
      queryClient.invalidateQueries({ queryKey: ["incomeExpense"] });
    },
  });

  async function submitForApprovalIfNeeded(
    transaction: IncomeExpense,
    operation: Exclude<QueueOperation, "delete">
  ): Promise<ApprovalSubmitResult> {
    const localRequiresApproval =
      keywordsQuery.data?.some(keyword => keywordMatches(keyword, transaction)) ||
      settingsMatch(settingsQuery.data, transaction);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (localRequiresApproval) {
        throw new Error("รายการนี้ต้องรออนุมัติ ต้องออนไลน์ก่อนบันทึก");
      }
      return { requiresApproval: false };
    }

    const payload = buildIncomeExpensePayload(transaction, operation);

    const response = await fetch("/api/lanflow/income-expense/approval-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.errorMessage || data.error || "ตรวจสอบคำขออนุมัติไม่สำเร็จ");
    }

    if (data.status === "pending") {
      queryClient.invalidateQueries({ queryKey: [REQUESTS_KEY] });
      return {
        requiresApproval: true,
        requestId: data.requestId,
        matchedReason: data.matchedReason,
        matchedKeyword: data.matchedKeyword,
      };
    }

    return { requiresApproval: false };
  }

  return {
    keywords: keywordsQuery.data || [],
    settings: settingsQuery.data,
    requests: requestsQuery.data || [],
    isLoading: keywordsQuery.isLoading || settingsQuery.isLoading || (includeRequests && requestsQuery.isLoading),
    addKeyword: addKeywordMutation.mutateAsync,
    disableKeyword: disableKeywordMutation.mutateAsync,
    saveSettings: saveSettingsMutation.mutateAsync,
    decideRequest: decideRequestMutation.mutateAsync,
    submitForApprovalIfNeeded,
  };
}
