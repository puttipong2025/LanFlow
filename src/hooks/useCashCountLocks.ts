"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch, assertApiResponse } from "@/lib/auth-fetch";
import { parseCashCountLocks, type CashCountLockState } from "@/lib/cash-count-lock";
import { loadCashLockSnapshot, saveCashLockSnapshot } from "@/lib/cash-counts/lock-cache";

export function useCashCountLocks(enabled: boolean, scope: string, online = true, locationId?: string, offlineRubber = false) {
  const [data, setData] = useState<{ scope: string; states: CashCountLockState[]; offset: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const read = useRef<(() => Promise<void>) | null>(null);
  const unlocking = useRef(false);
  const lastAttempt = useRef(0);
  const context = useRef(scope);
  context.current = scope;
  const [clock, setClock] = useState(Date.now());
  const [checkedAt, setCheckedAt] = useState(0);
  const current = data?.scope === scope ? data : !online ? loadCashLockSnapshot(scope) : null;
  const selected = current?.states.find((state) => state.locationId === locationId);
  const transition = selected?.enabled ? Math.max(Date.parse(selected.lockAt ?? ""), Date.parse(selected.unlockedUntil ?? "") || 0) : NaN;
  const needsCheck = !!selected?.enabled && !selected.locked && Number.isFinite(transition) && clock + current!.offset >= transition && checkedAt < transition;
  const blocked = enabled && (!!selected?.locked || needsCheck || (!current && (online || !offlineRubber)));
  useEffect(() => {
    if (!enabled || !blocked) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled, blocked]);
  useEffect(() => {
    if (!enabled || !Number.isFinite(transition) || checkedAt >= transition) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.min(2_147_000_000, Math.max(0, transition - Date.now() - (current?.offset ?? 0) + 50)));
    return () => clearTimeout(timer);
  }, [enabled, transition, checkedAt, current?.offset]);
  useEffect(() => {
    if (!enabled || !online) { read.current = null; return; }
    let active = true;
    let pending: Promise<void> | null = null;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dirty = false;
    const refresh = (invalidate = false) => {
      if (pending) { dirty ||= invalidate; return pending; }
      lastAttempt.current = Date.now();
      controller = new AbortController();
      pending = (async () => {
        try {
          const response = await authFetch("/api/lanflow/cash-counts/lock", { cache: "no-store", signal: AbortSignal.any([controller!.signal, AbortSignal.timeout(10_000)]) });
          await assertApiResponse(response);
          const next = parseCashCountLocks(await response.json());
          if (!next) throw new Error("ข้อมูลสถานะล็อกไม่ถูกต้อง");
          if (!active || dirty) return;
          const now = Date.parse(next.serverNow);
          const snapshot = { scope, states: next.states, offset: now - Date.now() };
          saveCashLockSnapshot(snapshot); setData(snapshot); setCheckedAt(now); setError(null);
          if (timer) clearTimeout(timer);
          const transitions = next.states.filter((s) => s.enabled).flatMap((s) => [s.lockAt, s.unlockedUntil])
            .filter((v): v is string => !!v).map(Date.parse).filter((v) => v > now);
          if (transitions.length) timer = setTimeout(() => void refresh(), Math.min(2_147_000_000, Math.min(...transitions) - now + 250));
        } catch (cause) {
          if (active && !controller?.signal.aborted) setError(cause instanceof Error ? cause.message : "โหลดสถานะล็อกไม่สำเร็จ");
        } finally { pending = null; if (active && dirty) { dirty = false; void refresh(); } }
      })();
      return pending;
    };
    const changed = () => { void refresh(true); };
    const visible = () => { if (document.visibilityState === "visible") changed(); };
    const storage = (event: StorageEvent) => { if (event.key === "lanflow:cash-count-lock-changed") { changed(); window.dispatchEvent(new Event("lanflow:cash-count-unlocked")); } };
    read.current = () => refresh(true); void refresh();
    window.addEventListener("focus", changed); window.addEventListener("online", changed);
    window.addEventListener("lanflow:cash-count-lock-changed", changed); window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false; controller?.abort(); if (timer) clearTimeout(timer); read.current = null;
      window.removeEventListener("focus", changed); window.removeEventListener("online", changed);
      window.removeEventListener("lanflow:cash-count-lock-changed", changed); window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled, scope, online]);
  useEffect(() => {
    if (!blocked || !online) return;
    const timer = setInterval(() => { if (!document.hidden && navigator.onLine && Date.now() - lastAttempt.current >= 10_000) void read.current?.(); }, 1000);
    return () => clearInterval(timer);
  }, [blocked, online, scope]);
  const unlock = useCallback(async (locationId: string) => {
    if (unlocking.current || !online) return;
    unlocking.current = true;
    const startedScope = scope;
    setWorking(locationId); setError(null);
    try {
      const response = await authFetch("/api/lanflow/cash-counts/lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId }), signal: AbortSignal.timeout(15_000) });
      await assertApiResponse(response);
      if (context.current !== startedScope) return;
      await read.current?.(); window.dispatchEvent(new Event("lanflow:cash-count-unlocked"));
    } catch (cause) { if (context.current === startedScope) setError(cause instanceof Error ? cause.message : "ปลดล็อกไม่สำเร็จ"); }
    finally { unlocking.current = false; setWorking(null); }
  }, [online, scope]);
  const refresh = useCallback(() => read.current?.(), []);
  return { states: enabled ? current?.states ?? [] : [], blocked, remaining: Math.max(0, Math.min(10, 10 - Math.floor((clock - lastAttempt.current) / 1000))), offset: current?.offset ?? 0, error: enabled ? error : null, working, unlock, refresh };
}
