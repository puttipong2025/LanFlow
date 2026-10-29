import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  clearAllRubberBillApprovalSettingsCache,
  loadRubberBillApprovalSettingsCache,
  isRubberBillApprovalSettings,
  saveRubberBillApprovalSettingsCache,
} from "@/lib/rubber-bills/approval";
import { ACTIONABLE_BADGES_QUERY_KEY } from "@/hooks/useActionableBadges";
import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";
import { authFetch } from "@/lib/auth-fetch";
import { acceptRubberManagerCommand, runRubberCentralQueue } from "@/lib/rubber-bills/central-sync";
import type { EffectiveRubberApprovalSettings } from "@/types";

export const RUBBER_BILL_APPROVAL_SETTINGS_KEY = "rubberBillApprovalSettings";

export function useRubberBillApprovals({
  locationId,
  ownerUserId,
}: {
  locationId: string;
  ownerUserId: string;
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
      if (!isRubberBillApprovalSettings(data, locationId)) throw new Error("กติกาบิลยางไม่ตรงตามรูปแบบหรือสาขาที่กำหนด");
      return data;
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
    mutationFn: async ({
      nonCurrentDateRequiresApproval,
      locationId: submissionLocationId,
    }: {
      nonCurrentDateRequiresApproval: boolean;
      locationId: string;
    }) => {
      const response = await authFetch(`/api/lanflow/rubber-bills/approval-settings?locationId=${encodeURIComponent(submissionLocationId)}`, {
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
      clearAllRubberBillApprovalSettingsCache();
      queryClient.setQueryData([RUBBER_BILL_APPROVAL_SETTINGS_KEY, settings.locationId], settings);
      await queryClient.invalidateQueries({ queryKey: [RUBBER_BILL_APPROVAL_SETTINGS_KEY] });
    },
  });

  const approveMutation = useMutation({
    networkMode: "always",
    mutationFn: (variables: { id: string; locationId: string; ownerUserId: string }) =>
      acceptRubberManagerCommand(variables.ownerUserId, variables.locationId, variables.id, "approve"),
    onSuccess: (_data, variables) => {
      void runRubberCentralQueue(queryClient, variables.ownerUserId);
      void invalidateApprovalQueue();
    },
    onError: invalidateApprovalData,
  });

  const deleteMutation = useMutation({
    networkMode: "always",
    mutationFn: (variables: { id: string; locationId: string; ownerUserId: string }) =>
      acceptRubberManagerCommand(variables.ownerUserId, variables.locationId, variables.id, "cancel"),
    onSuccess: (_data, variables) => {
      void runRubberCentralQueue(queryClient, variables.ownerUserId);
      void invalidateApprovalQueue();
    },
    onError: invalidateApprovalQueue,
  });

  return {
    settings: settingsQuery.data ?? (cachedSettings.locationId === locationId ? cachedSettings.value : undefined),
    isLoading: settingsQuery.isLoading,
    isFetching: settingsQuery.isFetching,
    error: settingsQuery.error,
    refreshSettings: settingsQuery.refetch,
    saveGlobalDateRule: (nonCurrentDateRequiresApproval: boolean) => saveSettingsMutation.mutateAsync({
      nonCurrentDateRequiresApproval,
      locationId,
    }),
    approveRequest: (id: string, approvalLocationId: string) => approveMutation.mutateAsync({
      id,
      locationId: approvalLocationId,
      ownerUserId,
    }),
    deleteRequest: (id: string, approvalLocationId: string) => deleteMutation.mutateAsync({
      id,
      locationId: approvalLocationId,
      ownerUserId,
    }),
  };
}
