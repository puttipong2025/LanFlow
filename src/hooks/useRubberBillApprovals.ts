import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  loadRubberBillApprovalSettingsCache,
  saveRubberBillApprovalSettingsCache,
} from "@/lib/rubber-bills/approval";
import { ACTIONABLE_BADGES_QUERY_KEY } from "@/hooks/useActionableBadges";
import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";
import { authFetch } from "@/lib/auth-fetch";
import { INCOME_EXPENSE_FEED_QUERY_KEY } from "@/lib/income-expense/query-keys";
import type { RubberBillApprovalSettings } from "@/types";

export const RUBBER_BILL_APPROVAL_SETTINGS_KEY = "rubberBillApprovalSettings";
export const RUBBER_BILL_APPROVAL_REQUESTS_KEY = "rubberBillApprovalRequests";

export function useRubberBillApprovals({
  locationId,
}: {
  locationId: string;
}) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();
  const [cachedSettings, setCachedSettings] = useState(loadRubberBillApprovalSettingsCache);

  const settingsQuery = useQuery({
    queryKey: [RUBBER_BILL_APPROVAL_SETTINGS_KEY],
    queryFn: async (): Promise<RubberBillApprovalSettings> => {
      const { data, error } = await supabase
        .from("rubber_bill_approval_settings")
        .select("*")
        .eq("id", true)
        .maybeSingle();

      if (error) throw new Error(error.message || JSON.stringify(error));
      return {
        editWindowMinutes: data?.edit_window_minutes ?? 30,
        configuredPrice: data?.configured_price == null ? null : Number(data.configured_price),
        nonCurrentDateRequiresApproval: data?.non_current_date_requires_approval ?? false,
        updatedByName: data?.updated_by_name,
        updatedByPhone: data?.updated_by_phone,
        updatedAt: data?.updated_at,
      };
    },
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    saveRubberBillApprovalSettingsCache(settingsQuery.data);
    setCachedSettings({
      editWindowMinutes: settingsQuery.data.editWindowMinutes,
      configuredPrice: settingsQuery.data.configuredPrice,
      nonCurrentDateRequiresApproval: settingsQuery.data.nonCurrentDateRequiresApproval,
      cachedAt: new Date().toISOString(),
    });
  }, [settingsQuery.data]);

  function invalidateApprovalData() {
    void queryClient.invalidateQueries({ queryKey: [RUBBER_BILL_APPROVAL_REQUESTS_KEY] });
    void queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.rubberBillsRoot() });
    void queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.rubberBillOperationalFeedRoot() });
    void queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.rubberBillWorkCountsRoot() });
    void queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.moneyTransfersRoot() });
    void queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.moneyTransferListRoot() });
    void queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.moneyTransferSourcesRoot() });
    void queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.incomeExpenseFeedRoot() });
    void queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.stockRoot() });
    void queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] });
  }

  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: Pick<RubberBillApprovalSettings, "editWindowMinutes" | "configuredPrice" | "nonCurrentDateRequiresApproval">) => {
      const response = await authFetch("/api/lanflow/rubber-bills/approval-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.errorMessage || "บันทึกการตั้งค่าไม่สำเร็จ");
      }
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [RUBBER_BILL_APPROVAL_SETTINGS_KEY] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await authFetch(
        `/api/lanflow/rubber-bills/approval-requests/${id}/approve`,
        { method: "POST" }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.errorMessage || "อนุมัติคำขอไม่สำเร็จ");
      }
      return data;
    },
    onSuccess: invalidateApprovalData,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await authFetch(
        `/api/lanflow/rubber-bills/approval-requests/${id}`,
        { method: "DELETE" }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.errorMessage || "ลบคำขอไม่สำเร็จ");
      }
      return data;
    },
    onSuccess: invalidateApprovalData,
  });

  return {
    settings: settingsQuery.data ?? cachedSettings ?? undefined,
    hasCachedSettings: cachedSettings !== null,
    isLoading: settingsQuery.isLoading,
    error: settingsQuery.error,
    saveSettings: saveSettingsMutation.mutateAsync,
    approveRequest: approveMutation.mutateAsync,
    deleteRequest: deleteMutation.mutateAsync,
  };
}
