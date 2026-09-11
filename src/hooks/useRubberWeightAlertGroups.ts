import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

export function useRubberWeightAlertGroups() {
  const queryClient = useQueryClient();
  const groupsQuery = useQuery({
    queryKey: [RUBBER_WEIGHT_ALERT_GROUPS_KEY],
    queryFn: async (): Promise<GroupsResponse> => {
      const response = await authFetch("/api/lanflow/rubber-weight-alert/groups", { cache: "no-store" });
      const data = await readJson(response);
      if (!response.ok) throw new Error(String(data.errorMessage || "โหลดกลุ่มแจ้งเตือนน้ำหนักไม่สำเร็จ"));
      return data as GroupsResponse;
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [RUBBER_WEIGHT_ALERT_GROUPS_KEY] });
  const createGroup = useMutation({
    mutationFn: async (input: GroupInput) => {
      const response = await authFetch("/api/lanflow/rubber-weight-alert/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(String(data.errorMessage || "สร้างกลุ่มไม่สำเร็จ"));
      return data as RubberWeightAlertGroup;
    },
    onSuccess: invalidate,
  });
  const updateGroup = useMutation({
    mutationFn: async ({ id, ...input }: GroupInput & { id: string }) => {
      const response = await authFetch(`/api/lanflow/rubber-weight-alert/groups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(String(data.errorMessage || "แก้ไขกลุ่มไม่สำเร็จ"));
      return data as RubberWeightAlertGroup;
    },
    onSuccess: invalidate,
  });
  const deleteGroup = useMutation({
    mutationFn: async (id: string) => {
      const response = await authFetch(`/api/lanflow/rubber-weight-alert/groups/${id}`, { method: "DELETE" });
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
