import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  clearRubberBillApprovalSettingsCache,
  loadRubberBillApprovalSettingsCache,
  saveRubberBillApprovalSettingsCache,
} from "@/lib/rubber-bills/approval";
import { ACTIONABLE_BADGES_QUERY_KEY } from "@/hooks/useActionableBadges";
import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";
import { authFetch } from "@/lib/auth-fetch";
import type { EffectiveRubberApprovalSettings } from "@/types";

export const RUBBER_BILL_APPROVAL_SETTINGS_KEY = "rubberBillApprovalSettings";

export function useRubberBillApprovals({
  locationId,
  cachedLocationIds = [locationId],
}: {
  locationId: string;
  cachedLocationIds?: string[];
}) {
  const queryClient = useQueryClient();
  const [cachedSettings, setCachedSettings] = useState(() => ({
    locationId,
    value: loadRubberBillApprovalSettingsCache(locationId),
  }));

  useEffect(() => {
    setCachedSettings({ locationId, value: loadRubberBillApprovalSettingsCache(locationId) });
  }, [locationId]);

  const settingsQuery = useQuery({
    queryKey: [RUBBER_BILL_APPROVAL_SETTINGS_KEY, locationId],
    enabled: Boolean(locationId),
    queryFn: async (): Promise<EffectiveRubberApprovalSettings> => {
      const response = await authFetch(`/api/lanflow/rubber-bills/approval-settings?locationId=${encodeURIComponent(locationId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.errorMessage || "โหลดกติกาอนุมัติไม่สำเร็จ");
      return data as EffectiveRubberApprovalSettings;
    },
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    saveRubberBillApprovalSettingsCache(settingsQuery.data);
    setCachedSettings({
      locationId: settingsQuery.data.locationId,
      value: { ...settingsQuery.data, cachedAt: new Date().toISOString() },
    });
  }, [settingsQuery.data]);

  function invalidateApprovalQueue() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.rubberBillOperationalFeedRoot() }),
      queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.rubberBillWorkCountsRoot() }),
      queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] }),
    ]);
  }

  function invalidateApprovalData() {
    return Promise.all([
      invalidateApprovalQueue(),
      queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.moneyTransferListRoot() }),
      queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.moneyTransferSourcesRoot() }),
      queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.incomeExpenseFeedRoot() }),
      queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.stockRoot() }),
    ]);
  }

  const saveSettingsMutation = useMutation({
    mutationFn: async (nonCurrentDateRequiresApproval: boolean) => {
      const response = await authFetch(`/api/lanflow/rubber-bills/approval-settings?locationId=${encodeURIComponent(locationId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nonCurrentDateRequiresApproval }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.errorMessage || "บันทึกการตั้งค่าไม่สำเร็จ");
      }
      return data;
    },
    onSuccess: async (settings: EffectiveRubberApprovalSettings) => {
      clearRubberBillApprovalSettingsCache(cachedLocationIds);
      queryClient.setQueryData([RUBBER_BILL_APPROVAL_SETTINGS_KEY, locationId], settings);
      await queryClient.invalidateQueries({ queryKey: [RUBBER_BILL_APPROVAL_SETTINGS_KEY] });
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
    onSuccess: invalidateApprovalQueue,
  });

  return {
    settings: settingsQuery.data ?? (cachedSettings.locationId === locationId ? cachedSettings.value : undefined),
    hasCachedSettings: cachedSettings.locationId === locationId && cachedSettings.value !== null,
    isLoading: settingsQuery.isLoading,
    error: settingsQuery.error,
    saveGlobalDateRule: saveSettingsMutation.mutateAsync,
    approveRequest: approveMutation.mutateAsync,
    deleteRequest: deleteMutation.mutateAsync,
  };
}
