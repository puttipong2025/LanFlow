import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authFetch } from "@/lib/auth-fetch";
import { clearRubberBillApprovalSettingsCache } from "@/lib/rubber-bills/approval";
import { RUBBER_BILL_APPROVAL_SETTINGS_KEY } from "@/hooks/useRubberBillApprovals";
import type {
  RubberApprovalGroup,
  RubberCentralPriceSetting,
  RubberMaxPriceAllowanceConflict,
  RubberMaxPriceAllowanceSetting,
  RubberUngroupedDefaults,
} from "@/types";

export const RUBBER_APPROVAL_GROUPS_KEY = "rubberApprovalGroups";

type GroupsResponse = {
  groups: RubberApprovalGroup[];
  availableLocationIds: string[];
  centralPrice: RubberCentralPriceSetting;
  ungroupedDefaults: RubberUngroupedDefaults;
  maxPriceAllowance: RubberMaxPriceAllowanceSetting;
  canEditMaxPriceAllowance: boolean;
};

export class RubberMaxPriceAllowanceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly conflicts: RubberMaxPriceAllowanceConflict[],
  ) {
    super(message);
    this.name = "RubberMaxPriceAllowanceError";
  }
}

type GroupInput = Pick<RubberApprovalGroup, "locationIds" | "editWindowMinutes" | "priceAllowance">;

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
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: [RUBBER_BILL_APPROVAL_SETTINGS_KEY] }),
      queryClient.invalidateQueries({ queryKey: [RUBBER_APPROVAL_GROUPS_KEY] }),
    ]);
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
      return data as { group: RubberApprovalGroup; affectedLocationIds: string[] };
    },
    onSuccess: () => invalidateLocations(allLocationIds),
  });

  const updateGroup = useMutation({
    mutationFn: async ({ id, revisionNo, sourceGroupRevisions, ...input }: GroupInput & {
      id: string;
      revisionNo: number;
      sourceGroupRevisions: Record<string, number>;
    }) => {
      const response = await authFetch(`/api/lanflow/rubber-bills/approval-groups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, revisionNo, sourceGroupRevisions }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.errorMessage || "แก้ไขกลุ่มไม่สำเร็จ");
      return data as { group: RubberApprovalGroup; affectedLocationIds: string[] };
    },
    onSuccess: () => invalidateLocations(allLocationIds),
  });

  const deleteGroup = useMutation({
    mutationFn: async ({ id, revisionNo }: Pick<RubberApprovalGroup, "id" | "revisionNo">) => {
      const response = await authFetch(`/api/lanflow/rubber-bills/approval-groups/${id}?revision=${revisionNo}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.errorMessage || "ลบกลุ่มไม่สำเร็จ");
      return data as { success: true; releasedLocationIds: string[] };
    },
    onSuccess: (data) => invalidateLocations(data.releasedLocationIds),
  });

  function saveGlobalSettings(path: "central" | "ungrouped", body: Record<string, unknown>) {
    return authFetch(`/api/lanflow/rubber-bills/approval-settings/${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.errorMessage || "บันทึกการตั้งค่าไม่สำเร็จ");
      return data as GroupsResponse;
    });
  }

  const saveCentralPrice = useMutation({
    mutationFn: (input: { centralPrice: number; expectedRevision: number }) => saveGlobalSettings("central", input),
    onSuccess: async (data) => {
      queryClient.setQueryData([RUBBER_APPROVAL_GROUPS_KEY], data);
      await invalidateLocations(allLocationIds);
    },
  });
  const saveUngroupedDefaults = useMutation({
    mutationFn: (input: { editWindowMinutes: number; priceAllowance: number; expectedRevision: number }) => saveGlobalSettings("ungrouped", input),
    onSuccess: async (data) => {
      queryClient.setQueryData([RUBBER_APPROVAL_GROUPS_KEY], data);
      await invalidateLocations(data.ungroupedDefaults.locationIds);
    },
  });
  const saveMaxPriceAllowance = useMutation({
    mutationFn: async (input: { maxPriceAllowance: number; expectedMaxPriceAllowance: number }) => {
      const response = await authFetch("/api/lanflow/rubber-bills/approval-settings/max-price-allowance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        throw new RubberMaxPriceAllowanceError(
          typeof data.errorMessage === "string" ? data.errorMessage : "บันทึกราคายางที่กำหนดสูงสุดไม่สำเร็จ",
          typeof data.code === "string" ? data.code : "UNKNOWN",
          Array.isArray(data.conflicts) ? data.conflicts as RubberMaxPriceAllowanceConflict[] : [],
        );
      }
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [RUBBER_APPROVAL_GROUPS_KEY] }),
  });

  return {
    ...groupsQuery,
    groups: groupsQuery.data?.groups ?? [],
    availableLocationIds: groupsQuery.data?.availableLocationIds ?? [],
    centralPrice: groupsQuery.data?.centralPrice,
    ungroupedDefaults: groupsQuery.data?.ungroupedDefaults,
    maxPriceAllowance: groupsQuery.data?.maxPriceAllowance,
    canEditMaxPriceAllowance: groupsQuery.data?.canEditMaxPriceAllowance ?? false,
    createGroup: createGroup.mutateAsync,
    updateGroup: updateGroup.mutateAsync,
    deleteGroup: deleteGroup.mutateAsync,
    saveCentralPrice: saveCentralPrice.mutateAsync,
    saveUngroupedDefaults: saveUngroupedDefaults.mutateAsync,
    saveMaxPriceAllowance: saveMaxPriceAllowance.mutateAsync,
    isSaving: createGroup.isPending || updateGroup.isPending || deleteGroup.isPending
      || saveCentralPrice.isPending || saveUngroupedDefaults.isPending || saveMaxPriceAllowance.isPending,
  };
}
