import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";
import { authFetch } from "@/lib/auth-fetch";
import type { RubberWeightAlertGroup } from "@/types";

const RUBBER_WEIGHT_ALERT_GROUPS_KEY = "rubberWeightAlertGroups";

type GroupsResponse = {
  groups: RubberWeightAlertGroup[];
  availableLocationIds: string[];
};

type GroupInput = Pick<RubberWeightAlertGroup, "locationIds" | "thresholdKg">;

async function readJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

export function useRubberWeightAlertGroups(kind: "cash" | "weight" = "weight") {
  const endpoint = kind === "cash" ? "/api/lanflow/cash-alert/groups" : "/api/lanflow/rubber-weight-alert/groups";
  const key = [RUBBER_WEIGHT_ALERT_GROUPS_KEY, kind];
  const inputBody = (input: GroupInput) => kind === "cash"
    ? { locationIds: input.locationIds, thresholdAmount: input.thresholdKg } : input;
  const queryClient = useQueryClient();
  const groupsQuery = useQuery({
    queryKey: key,
    queryFn: async (): Promise<GroupsResponse> => {
      const response = await authFetch(endpoint, { cache: "no-store" });
      const data = await readJson(response);
      if (!response.ok) throw new Error(String(data.errorMessage || "โหลดกลุ่มแจ้งเตือนไม่สำเร็จ"));
      if (kind === "cash") {
        const cash = data as unknown as { groups: Array<RubberWeightAlertGroup & { thresholdAmount: number }>; availableLocationIds: string[] };
        return { ...cash, groups: cash.groups.map((group) => ({ ...group, thresholdKg: group.thresholdAmount })) };
      }
      return data as GroupsResponse;
    },
  });

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: key }),
    ...(kind === "cash" ? [queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.dashboardBranchSummaries() })] : []),
  ]);
  const createGroup = useMutation({
    mutationFn: async (input: GroupInput) => {
      const response = await authFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputBody(input)),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(String(data.errorMessage || "สร้างกลุ่มไม่สำเร็จ"));
      return data as RubberWeightAlertGroup;
    },
    onSuccess: invalidate,
  });
  const updateGroup = useMutation({
    mutationFn: async ({ id, ...input }: GroupInput & { id: string }) => {
      const response = await authFetch(`${endpoint}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputBody(input)),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(String(data.errorMessage || "แก้ไขกลุ่มไม่สำเร็จ"));
      return data as RubberWeightAlertGroup;
    },
    onSuccess: invalidate,
  });
  const deleteGroup = useMutation({
    mutationFn: async (id: string) => {
      const response = await authFetch(`${endpoint}/${id}`, { method: "DELETE" });
      const data = await readJson(response);
      if (!response.ok) throw new Error(String(data.errorMessage || "ลบกลุ่มไม่สำเร็จ"));
      return data;
    },
    onSuccess: invalidate,
  });

  return {
    ...groupsQuery,
    groups: groupsQuery.data?.groups ?? [],
    availableLocationIds: groupsQuery.data?.availableLocationIds ?? [],
    createGroup: createGroup.mutateAsync,
    updateGroup: updateGroup.mutateAsync,
    deleteGroup: deleteGroup.mutateAsync,
    isSaving: createGroup.isPending || updateGroup.isPending || deleteGroup.isPending,
  };
}
