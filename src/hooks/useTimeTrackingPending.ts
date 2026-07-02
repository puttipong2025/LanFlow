import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";
import type { Profile } from "@/types";

export function useTimeTrackingPending(profile?: Profile | null) {
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";

  const query = useQuery({
    queryKey: ["timeTrackingPending"],
    queryFn: async () => {
      const res = await authFetch("/api/lanflow/time-tracking/admin");
      if (!res.ok) {
        if (res.status === 403) return 0;
        throw new Error("Failed to load time tracking admin data");
      }
      const data = await res.json();
      const count = (data.pendingTransactions?.length || 0) + 
                    (data.pendingLeaves?.length || 0) + 
                    (data.pendingSlips?.length || 0);
      return count;
    },
    enabled: Boolean(profile && isAdmin),
    refetchInterval: 60000, // Refresh every minute
  });

  return {
    pendingCount: query.data || 0,
    isLoading: query.isLoading,
  };
}
