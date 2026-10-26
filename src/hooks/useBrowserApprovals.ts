"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthContext } from "@/components/AuthProvider";
import { canManageSystemFeatures } from "@/lib/permissions";
import { authFetch } from "@/lib/auth-fetch";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export type BrowserApprovalUser = {
  userId: string; required: boolean; primaryLocationId: string | null;
  pending: { id: string; label: string; requestedAt: string }[];
  lastApprovedBy: string | null; lastApprovedAt: string | null;
};
export const BROWSER_APPROVAL_QUERY_KEY = "browserApprovals";
export function useBrowserApprovals(poll = true) {
  const { profile } = useAuthContext();
  const online = useOnlineStatus();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: [BROWSER_APPROVAL_QUERY_KEY, profile?.id],
    enabled: online && canManageSystemFeatures(profile),
    queryFn: async () => {
      const response = await authFetch("/api/lanflow/admin/browser-approvals", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "โหลดคำขอไม่สำเร็จ");
      return data.users as BrowserApprovalUser[];
    },
    staleTime: 10_000, refetchInterval: poll ? 30_000 : false, refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always", refetchOnReconnect: "always",
  });
  const users = online && canManageSystemFeatures(profile) && !query.isError ? query.data ?? [] : [];
  return {
    users, error: query.error, refresh: () => client.invalidateQueries({ queryKey: [BROWSER_APPROVAL_QUERY_KEY] }),
    total: users.reduce((sum, user) => sum + user.pending.length, 0),
    byLocation: users.reduce<Record<string, number>>((counts, user) => {
      if (user.primaryLocationId) counts[user.primaryLocationId] = (counts[user.primaryLocationId] ?? 0) + user.pending.length;
      return counts;
    }, {}),
  };
}
