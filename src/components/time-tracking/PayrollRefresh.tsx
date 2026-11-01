"use client";

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ACTIONABLE_BADGES_QUERY_KEY } from "@/hooks/useActionableBadges";

type Refresh = () => Promise<void>;
type RefreshContext = { register: (read: Refresh) => () => void; refresh: Refresh };
const Context = createContext<RefreshContext | null>(null);

// One owner for the open payroll views. Badge polling is paused by the app while
// this module is mounted; invalidating it still refreshes all badge observers.
export function PayrollRefresh({ online, ownerUserId, children }: {
  online: boolean; ownerUserId: string; children: ReactNode;
}) {
  const client = useQueryClient();
  const readers = useRef(new Set<Refresh>());
  const register = useCallback((read: Refresh) => {
    readers.current.add(read);
    return () => { readers.current.delete(read); };
  }, []);
  const refresh = useCallback(async () => {
    if (!online) return;
    await Promise.allSettled([
      ...Array.from(readers.current, (read) => read()),
      client.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] }),
    ]);
  }, [client, online]);
  useQuery({
    queryKey: ["timePayrollRefresh", ownerUserId],
    enabled: online,
    queryFn: async () => { await refresh(); return true; },
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  return <Context.Provider value={{ register, refresh }}>{children}</Context.Provider>;
}

export function usePayrollRefresh(read: Refresh): Refresh {
  const context = useContext(Context);
  const register = context?.register;
  useEffect(() => register?.(read), [read, register]);
  return context?.refresh ?? read;
}
