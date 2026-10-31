import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authFetch } from "@/lib/auth-fetch";
import { getConnectivitySnapshot } from "@/lib/connectivity";
import { isJsonObject } from "@/lib/validation/primitives";
import {
  isRubberApprovalGroupsResult,
  isRubberApprovalGroupMutationResult,
  isRubberApprovalGroupDeleteResult,
  isRubberMaxPriceAllowanceSaveResult,
  isRubberPriceAllowanceAutoResetSaveResult,
  isRubberPriceAllowanceAutoResetLockSaveResult,
} from "@/lib/rubber-bills/approval-group-contract";
import {
  clearAllRubberBillApprovalSettingsCache,
  clearRubberBillApprovalSettingsCache,
} from "@/lib/rubber-bills/approval";
import { RUBBER_BILL_APPROVAL_SETTINGS_KEY } from "@/hooks/useRubberBillApprovals";
import type {
  RubberApprovalGroup,
  RubberCentralPriceSetting,
  RubberMaxPriceAllowanceConflict,
  RubberMaxPriceAllowanceSetting,
  RubberUngroupedDefaults,
} from "@/types";

const RUBBER_APPROVAL_GROUPS_KEY = "rubberApprovalGroups";

type GroupsResponse = {
  groups: RubberApprovalGroup[];
  availableLocationIds: string[];
  centralPrice: RubberCentralPriceSetting;
  ungroupedDefaults: RubberUngroupedDefaults;
  maxPriceAllowance: RubberMaxPriceAllowanceSetting;
  canEditMaxPriceAllowance: boolean;
  priceAllowanceAutoResetEnabled: boolean;
  canEditPriceAllowanceAutoReset: boolean;
};

export class RubberMaxPriceAllowanceError extends Error {
  constructor(
    message: string,
    public readonly conflicts: RubberMaxPriceAllowanceConflict[],
  ) {
    super(message);
    this.name = "RubberMaxPriceAllowanceError";
  }
}

type GroupInput = Pick<RubberApprovalGroup, "locationIds" | "editWindowMinutes" | "priceAllowance">;

const INVALID_RESPONSE = "ระบบไม่ตอบกลับข้อมูลการตั้งค่าตามรูปแบบที่กำหนด";

function responseMessage(data: unknown, fallback: string) {
  return isJsonObject(data) && typeof data.errorMessage === "string" && data.errorMessage
    ? data.errorMessage : fallback;
}

async function readResponse(response: Response, fallback: string) {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseMessage(data, fallback));
  if (!isJsonObject(data)) throw new Error(INVALID_RESPONSE);
  return data;
}

function isClientGroupsResponse(
  data: unknown,
  expected?: Parameters<typeof isRubberApprovalGroupsResult>[1],
): data is GroupsResponse {
  if (!isJsonObject(data)) return false;
  const { canEditMaxPriceAllowance, canEditPriceAllowanceAutoReset, ...settings } = data;
  return typeof canEditMaxPriceAllowance === "boolean"
    && typeof canEditPriceAllowanceAutoReset === "boolean"
    && isRubberApprovalGroupsResult(settings, expected);
}

async function mutationFetch(url: string, init: RequestInit) {
  if (!getConnectivitySnapshot()) throw new Error("การตั้งค่าบิลยางใช้ได้เมื่อออนไลน์เท่านั้น");
  return authFetch(url, init);
}

export type RubberPriceAllowanceAutoResetLockInput = {
  locked: boolean;
  expectedLocked: boolean;
} & (
  | { scope: "group"; groupId: string }
  | { scope: "ungrouped" }
);

export function useRubberApprovalGroups() {
  const queryClient = useQueryClient();
  const groupsQuery = useQuery({
    queryKey: [RUBBER_APPROVAL_GROUPS_KEY],
    queryFn: async (): Promise<GroupsResponse> => {
      const response = await authFetch("/api/lanflow/rubber-bills/approval-groups");
      const data = await readResponse(response, "โหลดกลุ่มตั้งค่าบิลยางไม่สำเร็จ");
      if (!isClientGroupsResponse(data)) throw new Error(INVALID_RESPONSE);
      return data;
    },
    refetchInterval: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });

  function invalidatePolicyQueries() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: [RUBBER_BILL_APPROVAL_SETTINGS_KEY] }),
      queryClient.invalidateQueries({ queryKey: [RUBBER_APPROVAL_GROUPS_KEY] }),
    ]);
  }

  function invalidateLocations(locationIds: string[]) {
    clearRubberBillApprovalSettingsCache(locationIds);
    return invalidatePolicyQueries();
  }

  function invalidateAllLocations() {
    clearAllRubberBillApprovalSettingsCache();
    return invalidatePolicyQueries();
  }

  const createGroup = useMutation({
    networkMode: "always",
    mutationFn: async (input: GroupInput) => {
      const response = await mutationFetch("/api/lanflow/rubber-bills/approval-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await readResponse(response, "สร้างกลุ่มไม่สำเร็จ");
      if (!isRubberApprovalGroupMutationResult(data, input)) throw new Error(INVALID_RESPONSE);
      return data as { group: RubberApprovalGroup; affectedLocationIds: string[] };
    },
    onSuccess: (data) => invalidateLocations(data.affectedLocationIds),
  });

  const updateGroup = useMutation({
    networkMode: "always",
    mutationFn: async ({ id, revisionNo, sourceGroupRevisions, ...input }: GroupInput & {
      id: string;
      revisionNo: number;
      sourceGroupRevisions: Record<string, number>;
    }) => {
      const response = await mutationFetch(`/api/lanflow/rubber-bills/approval-groups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, revisionNo, sourceGroupRevisions }),
      });
      const data = await readResponse(response, "แก้ไขกลุ่มไม่สำเร็จ");
      if (!isRubberApprovalGroupMutationResult(data, { ...input, groupId: id, revisionNo })) throw new Error(INVALID_RESPONSE);
      return data as { group: RubberApprovalGroup; affectedLocationIds: string[] };
    },
    onSuccess: (data) => invalidateLocations(data.affectedLocationIds),
  });

  const deleteGroup = useMutation({
    networkMode: "always",
    mutationFn: async ({ id, revisionNo }: Pick<RubberApprovalGroup, "id" | "revisionNo" | "locationIds">) => {
      const response = await mutationFetch(`/api/lanflow/rubber-bills/approval-groups/${id}?revision=${revisionNo}`, { method: "DELETE" });
      const data = await readResponse(response, "ลบกลุ่มไม่สำเร็จ");
      if (!isRubberApprovalGroupDeleteResult(data)) throw new Error(INVALID_RESPONSE);
      return data as { success: true; releasedLocationIds: string[] };
    },
    onSuccess: (_data, group) => invalidateLocations(group.locationIds),
  });

  async function saveGlobalSettings(path: "central" | "ungrouped", body:
    { centralPrice: number; expectedRevision: number }
    | { editWindowMinutes: number; priceAllowance: number; expectedRevision: number }) {
    const response = await mutationFetch(`/api/lanflow/rubber-bills/approval-settings/${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await readResponse(response, "บันทึกการตั้งค่าไม่สำเร็จ");
    const expected = "centralPrice" in body
      ? { centralPrice: { value: body.centralPrice, revision: body.expectedRevision } }
      : { ungroupedDefaults: { editWindowMinutes: body.editWindowMinutes, priceAllowance: body.priceAllowance, revision: body.expectedRevision } };
    if (!isClientGroupsResponse(data, expected)) throw new Error(INVALID_RESPONSE);
    return data;
  }

  const saveCentralPrice = useMutation({
    networkMode: "always",
    mutationFn: (input: { centralPrice: number; expectedRevision: number }) => saveGlobalSettings("central", input),
    onSuccess: async (data) => {
      queryClient.setQueryData([RUBBER_APPROVAL_GROUPS_KEY], data);
      await invalidateAllLocations();
    },
  });
  const saveUngroupedDefaults = useMutation({
    networkMode: "always",
    mutationFn: (input: { editWindowMinutes: number; priceAllowance: number; expectedRevision: number }) => saveGlobalSettings("ungrouped", input),
    onSuccess: async (data) => {
      queryClient.setQueryData([RUBBER_APPROVAL_GROUPS_KEY], data);
      await invalidateAllLocations();
    },
  });
  const saveMaxPriceAllowance = useMutation({
    networkMode: "always",
    mutationFn: async (input: { maxPriceAllowance: number; expectedMaxPriceAllowance: number }) => {
      const response = await mutationFetch("/api/lanflow/rubber-bills/approval-settings/max-price-allowance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new RubberMaxPriceAllowanceError(
          responseMessage(data, "บันทึกราคายางที่กำหนดสูงสุดไม่สำเร็จ"),
          isRubberMaxPriceAllowanceSaveResult(data, input.maxPriceAllowance, input.expectedMaxPriceAllowance)
            && data.status === "conflict" ? data.conflicts as RubberMaxPriceAllowanceConflict[] : [],
        );
      }
      if (!isRubberMaxPriceAllowanceSaveResult(data, input.maxPriceAllowance, input.expectedMaxPriceAllowance)
          || data.status === "conflict") throw new Error(INVALID_RESPONSE);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [RUBBER_APPROVAL_GROUPS_KEY] }),
  });
  const savePriceAllowanceAutoReset = useMutation({
    networkMode: "always",
    mutationFn: async (input: { enabled: boolean; expectedEnabled: boolean }) => {
      const response = await mutationFetch(
        "/api/lanflow/rubber-bills/approval-settings/price-allowance-auto-reset",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const data = await readResponse(response, "บันทึกการรีเซ็ตราคายางอัตโนมัติไม่สำเร็จ");
      if (!isRubberPriceAllowanceAutoResetSaveResult(data, input.enabled, input.expectedEnabled)) throw new Error(INVALID_RESPONSE);
      return data as { status: "saved" | "unchanged"; enabled: boolean };
    },
    onSuccess: async (data) => {
      queryClient.setQueryData<GroupsResponse>(
        [RUBBER_APPROVAL_GROUPS_KEY],
        (current) => current
          ? { ...current, priceAllowanceAutoResetEnabled: data.enabled }
          : current,
      );
      await queryClient.invalidateQueries({ queryKey: [RUBBER_APPROVAL_GROUPS_KEY] });
    },
  });
  const savePriceAllowanceAutoResetLock = useMutation({
    networkMode: "always",
    mutationFn: async (input: RubberPriceAllowanceAutoResetLockInput) => {
      const response = await mutationFetch(
        "/api/lanflow/rubber-bills/approval-settings/price-allowance-auto-reset-lock",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const data = await readResponse(response, "บันทึกล็อกรีเซ็ตราคายางไม่สำเร็จ");
      if (!isRubberPriceAllowanceAutoResetLockSaveResult(data, { ...input, previousLocked: input.expectedLocked })) throw new Error(INVALID_RESPONSE);
      return data as {
        status: "saved" | "unchanged";
        scope: "group" | "ungrouped";
        groupId?: string;
        locked: boolean;
      };
    },
    onSuccess: async (data) => {
      queryClient.setQueryData<GroupsResponse>(
        [RUBBER_APPROVAL_GROUPS_KEY],
        (current) => {
          if (!current) return current;
          if (data.scope === "ungrouped") {
            return {
              ...current,
              ungroupedDefaults: {
                ...current.ungroupedDefaults,
                priceAllowanceAutoResetLocked: data.locked,
              },
            };
          }
          return {
            ...current,
            groups: current.groups.map((group) => group.id === data.groupId
              ? { ...group, priceAllowanceAutoResetLocked: data.locked }
              : group),
          };
        },
      );
      await queryClient.invalidateQueries({ queryKey: [RUBBER_APPROVAL_GROUPS_KEY] });
    },
  });

  return {
    ...groupsQuery,
    groups: groupsQuery.data?.groups ?? [],
    availableLocationIds: groupsQuery.data?.availableLocationIds ?? [],
    centralPrice: groupsQuery.data?.centralPrice,
    ungroupedDefaults: groupsQuery.data?.ungroupedDefaults,
    maxPriceAllowance: groupsQuery.data?.maxPriceAllowance,
    canEditMaxPriceAllowance: groupsQuery.data?.canEditMaxPriceAllowance ?? false,
    priceAllowanceAutoResetEnabled: groupsQuery.data?.priceAllowanceAutoResetEnabled ?? false,
    canEditPriceAllowanceAutoReset: groupsQuery.data?.canEditPriceAllowanceAutoReset ?? false,
    createGroup: createGroup.mutateAsync,
    updateGroup: updateGroup.mutateAsync,
    deleteGroup: deleteGroup.mutateAsync,
    saveCentralPrice: saveCentralPrice.mutateAsync,
    saveUngroupedDefaults: saveUngroupedDefaults.mutateAsync,
    saveMaxPriceAllowance: saveMaxPriceAllowance.mutateAsync,
    savePriceAllowanceAutoReset: savePriceAllowanceAutoReset.mutateAsync,
    savePriceAllowanceAutoResetLock: savePriceAllowanceAutoResetLock.mutateAsync,
    isSaving: createGroup.isPending || updateGroup.isPending || deleteGroup.isPending
      || saveCentralPrice.isPending || saveUngroupedDefaults.isPending || saveMaxPriceAllowance.isPending
      || savePriceAllowanceAutoReset.isPending || savePriceAllowanceAutoResetLock.isPending,
  };
}
