"use client";

import { useEffect, useState } from "react";
import { QueryObserver, useQueryClient } from "@tanstack/react-query";
import { getConnectivitySnapshot, subscribeConnectivity } from "@/lib/connectivity";
import { EMPTY_CACHE_STATE, refreshBusinessCaches, type CacheState } from "@/lib/business-cache/refresh";
import { readCacheMetadata } from "@/lib/business-cache/storage";
import { cacheMetadataKey, type CacheModule } from "@/lib/business-cache/protocol";
import { getPendingEvents } from "@/lib/idb-queue";
import { businessCacheSettingsKey, type BusinessCacheSettings } from "@/lib/business-cache/settings";
import { startCacheVersionTimer } from "@/lib/business-cache/timer";

export type BusinessCacheStatus = { scope: string; rubber: CacheState; income: CacheState; pending: number | null;
  work?: { pending: number; failed: number; conflict: number } };
// One initial metadata check per owner/page lifetime; branch changes aren't network triggers.
const openedOwners = new Set<string>();

export function useBusinessCacheStatus(owner: string, branch: string) {
  const client = useQueryClient();
  const scope = `${owner}:${branch}`;
  const [state, setState] = useState<BusinessCacheStatus>({ scope, rubber: EMPTY_CACHE_STATE, income: EMPTY_CACHE_STATE, pending: null });
  useEffect(() => {
    if (!owner || !branch) return;
    let disposed = false;
    let running = false;
    let requested = false;
    let controller: AbortController | undefined;
    let wasOnline = getConnectivitySnapshot();
    const publish = (module: CacheModule, value: CacheState) => {
      if (!disposed) setState(current => ({ ...(current.scope === scope ? current : { scope, rubber: EMPTY_CACHE_STATE,
        income: EMPTY_CACHE_STATE, pending: null }), [module]: { ...value,
        updatedAt: value.updatedAt ?? (current.scope === scope ? current[module].updatedAt : undefined) } }));
    };
    const check = async () => {
      if (disposed || !getConnectivitySnapshot()) return;
      if (running) { if (controller?.signal.aborted) requested = true; return; }
      running = true;
      controller = new AbortController();
      try {
        await refreshBusinessCaches(client, owner, branch, controller.signal, publish);
      } catch (error) {
        if (!disposed) for (const kind of ["rubber", "income"] as const) publish(kind,
          { state: "failed", detail: error instanceof Error ? error.message : "ตรวจแคชไม่สำเร็จ" });
      } finally {
        running = false;
        if (!disposed && !controller?.signal.aborted) openedOwners.add(owner);
        if (!disposed) setState(current => ({ ...current, rubber: current.rubber.state === "checking" || current.rubber.state === "updating"
          ? { ...current.rubber, state: "failed", detail: "ตรวจแคชไม่สำเร็จ ใช้ข้อมูลเดิม" } : current.rubber,
          income: current.income.state === "checking" || current.income.state === "updating"
            ? { ...current.income, state: "failed", detail: "ตรวจแคชไม่สำเร็จ ใช้ข้อมูลเดิม" } : current.income }));
        if (requested && !disposed && getConnectivitySnapshot()) { requested = false; void check(); }
        versionTimer.reset();
      }
    };
    // Keep the existing local queue queries observed while their module is closed.
    // Each background invalidation then refetches IndexedDB, without polling or HTTP.
    const rubberWork = new QueryObserver(client, { queryKey: ["rubberBillLocalState", owner, branch],
      queryFn: async () => ({ events: await getPendingEvents({ entity: "rubber_bills", ownerUserId: owner, locationId: branch }) }),
      networkMode: "always", staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
    const incomeWork = new QueryObserver(client, { queryKey: ["incomeExpensePending", owner, branch],
      queryFn: () => getPendingEvents({ entity: "income_expense", ownerUserId: owner, locationId: branch }),
      networkMode: "always", staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
    const readWork = () => {
      const rubber = rubberWork.getCurrentResult(), income = incomeWork.getCurrentResult();
      if (rubber.isError || income.isError || !rubber.data || !income.data) {
        if (!disposed) setState(current => ({ ...(current.scope === scope ? current : { scope, rubber: EMPTY_CACHE_STATE,
          income: EMPTY_CACHE_STATE }), pending: null, work: undefined }));
        return;
      }
      const events = [...rubber.data.events, ...income.data];
      const unique = new Map<string, "pending" | "failed" | "conflict">();
      const rank = { pending: 0, failed: 1, conflict: 2 };
      for (const event of events) {
        const key = `${event.entity}:${event.id}`, previous = unique.get(key);
        if (!previous || rank[event.status] > rank[previous]) unique.set(key, event.status);
      }
      const work = { pending: 0, failed: 0, conflict: 0 };
      for (const status of unique.values()) work[status]++;
      if (!disposed) setState(current => ({ ...(current.scope === scope ? current : { scope, rubber: EMPTY_CACHE_STATE,
        income: EMPTY_CACHE_STATE }), pending: unique.size, work }));
    };
    const readLocal = async () => {
      try {
        const [rubber, income] = await Promise.all([
          readCacheMetadata(cacheMetadataKey("rubber", owner, branch)), readCacheMetadata(cacheMetadataKey("income", owner, branch)),
        ]);
        if (!disposed && !running) setState(current => ({ scope, rubber: { state: "unchecked", updatedAt: rubber?.updatedAt },
          income: { state: "unchecked", updatedAt: income?.updatedAt }, pending: current.scope === scope ? current.pending : null,
          work: current.scope === scope ? current.work : undefined }));
      } catch { /* Unavailable storage never implies zero work or a current cache. */ }
    };
    const versionTimer = startCacheVersionTimer(() => client.getQueryData<BusinessCacheSettings>(businessCacheSettingsKey(owner))?.intervalMinutes, check);
    void readLocal().then(() => { if (!openedOwners.has(owner) && wasOnline) void check(); });
    const stopRubberWork = rubberWork.subscribe(readWork), stopIncomeWork = incomeWork.subscribe(readWork);
    readWork();
    const stopQueries = client.getQueryCache().subscribe(event => {
      if (event.type === "updated" && event.action.type === "success"
        && event.query.queryKey[0] === "businessCacheSettings" && event.query.queryKey[1] === owner) versionTimer.reset();
    });
    const unsubscribe = subscribeConnectivity(() => {
      const online = getConnectivitySnapshot();
      if (online && !wasOnline) void check();
      if (!online) controller?.abort();
      wasOnline = online;
    });
    return () => { disposed = true; controller?.abort(); unsubscribe(); stopQueries(); versionTimer.stop(); stopRubberWork(); stopIncomeWork(); };
  }, [branch, client, owner, scope]);
  return state.scope === scope ? state : { scope, rubber: EMPTY_CACHE_STATE, income: EMPTY_CACHE_STATE, pending: null };
}
