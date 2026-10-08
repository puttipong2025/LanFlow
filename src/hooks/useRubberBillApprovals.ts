import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  clearAllRubberBillApprovalSettingsCache,
  loadRubberBillApprovalSettingsCache,
  saveRubberBillApprovalSettingsCache,
} from "@/lib/rubber-bills/approval";
import { ACTIONABLE_BADGES_QUERY_KEY } from "@/hooks/useActionableBadges";
import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";
import { authFetch } from "@/lib/auth-fetch";
import { tombstoneRubberBillReceiptSnapshotByBillId } from "@/lib/idb-queue";
import {
  removeRubberBillApprovalRequestFromPendingFeedCache,
  removeRubberBillFromOperationalFeedCacheByBillId,
} from "@/lib/rubber-bills/feed-cache";
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
    mutationFn: async ({ id }: { id: string; locationId: string; ownerUserId: string }) => {
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
    onSuccess: async (data, variables) => {
      try {
        await removeRubberBillApprovalRequestFromPendingFeedCache(
          queryClient,
          { ownerUserId: variables.ownerUserId, locationId: variables.locationId },
          variables.id,
        );
      } catch (error) {
        console.warn("Unable to remove completed Rubber Bill approval request from the local feed", error);
      }
      if (data.operation === "delete" && typeof data.billId === "string") {
        try {
          await removeRubberBillFromOperationalFeedCacheByBillId(
            queryClient,
            { ownerUserId: variables.ownerUserId, locationId: variables.locationId },
            data.billId,
          );
        } catch (error) {
          console.warn("Unable to remove approved Rubber Bill from the local feed", error);
        }
        try {
          await tombstoneRubberBillReceiptSnapshotByBillId(variables.locationId, data.billId);
        } catch (error) {
          console.warn("Unable to tombstone approved Rubber Bill receipt", error);
        }
      }
      await invalidateApprovalData();
    },
    onError: invalidateApprovalData,
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id }: { id: string; locationId: string; ownerUserId: string }) => {
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
    onSuccess: async (_data, variables) => {
      try {
        await removeRubberBillApprovalRequestFromPendingFeedCache(
          queryClient,
          { ownerUserId: variables.ownerUserId, locationId: variables.locationId },
          variables.id,
        );
      } catch (error) {
        console.warn("Unable to remove deleted Rubber Bill approval request from the local feed", error);
      }
      await invalidateApprovalQueue();
    },
    onError: invalidateApprovalQueue,
  });

  return {
    settings: settingsQuery.data ?? (cachedSettings.locationId === locationId ? cachedSettings.value : undefined),
    isLoading: settingsQuery.isLoading,
    isFetching: settingsQuery.isFetching,
    error: settingsQuery.error,
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
