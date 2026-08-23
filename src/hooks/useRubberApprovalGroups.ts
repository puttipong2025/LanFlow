import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authFetch } from "@/lib/auth-fetch";
import { clearRubberBillApprovalSettingsCache } from "@/lib/rubber-bills/approval";
import { RUBBER_BILL_APPROVAL_SETTINGS_KEY } from "@/hooks/useRubberBillApprovals";
import type { RubberApprovalGroup } from "@/types";

export const RUBBER_APPROVAL_GROUPS_KEY = "rubberApprovalGroups";

type GroupsResponse = {
  groups: RubberApprovalGroup[];
  availableLocationIds: string[];
  nonCurrentDateRequiresApproval: boolean;
};

type GroupInput = Pick<RubberApprovalGroup, "locationIds" | "editWindowMinutes" | "configuredPrice">;

export function useRubberApprovalGroups(allLocationIds: string[]) {
  const queryClient = useQueryClient();
  const groupsQuery = useQuery({
    queryKey: [RUBBER_APPROVAL_GROUPS_KEY],
    queryFn: async (): Promise<GroupsResponse> => {
      const response = await authFetch("/api/lanflow/rubber-bills/approval-groups");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.errorMessage || "โหลดกลุ่มตั้งค่าบิลยางไม่สำเร็จ");
      return data as GroupsResponse;
    },
  });

  function invalidateLocations(locationIds: string[]) {
    clearRubberBillApprovalSettingsCache(locationIds);
    void queryClient.invalidateQueries({ queryKey: [RUBBER_BILL_APPROVAL_SETTINGS_KEY] });
    void queryClient.invalidateQueries({ queryKey: [RUBBER_APPROVAL_GROUPS_KEY] });
  }

  const createGroup = useMutation({
    mutationFn: async (input: GroupInput) => {
      const response = await authFetch("/api/lanflow/rubber-bills/approval-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.errorMessage || "สร้างกลุ่มไม่สำเร็จ");
      return data as RubberApprovalGroup;
    },
    onSuccess: () => invalidateLocations(allLocationIds),
  });

  const updateGroup = useMutation({
    mutationFn: async ({ id, ...input }: GroupInput & { id: string }) => {
      const response = await authFetch(`/api/lanflow/rubber-bills/approval-groups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.errorMessage || "แก้ไขกลุ่มไม่สำเร็จ");
      return data as RubberApprovalGroup;
    },
    onSuccess: () => invalidateLocations(allLocationIds),
  });

  const deleteGroup = useMutation({
    mutationFn: async (id: string) => {
      const response = await authFetch(`/api/lanflow/rubber-bills/approval-groups/${id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.errorMessage || "ลบกลุ่มไม่สำเร็จ");
      return data as { success: true; releasedLocationIds: string[] };
    },
    onSuccess: (data) => invalidateLocations(data.releasedLocationIds),
  });

  return {
    ...groupsQuery,
    groups: groupsQuery.data?.groups ?? [],
    availableLocationIds: groupsQuery.data?.availableLocationIds ?? [],
    nonCurrentDateRequiresApproval: groupsQuery.data?.nonCurrentDateRequiresApproval ?? false,
    createGroup: createGroup.mutateAsync,
    updateGroup: updateGroup.mutateAsync,
    deleteGroup: deleteGroup.mutateAsync,
    isSaving: createGroup.isPending || updateGroup.isPending || deleteGroup.isPending,
  };
}
