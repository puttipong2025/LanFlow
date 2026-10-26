"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch, assertApiResponse } from "@/lib/auth-fetch";
import { parseCashCountLocks, type CashCountLockState } from "@/lib/cash-count-lock";

export function useCashCountLocks(enabled: boolean, scope: string) {
  const [data, setData] = useState<{ scope: string; states: CashCountLockState[]; offset: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const read = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (!enabled) { read.current = null; return; }
    let active = true;
    let pending: Promise<void> | null = null;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dirty = false;
    const refresh = (invalidate = false) => {
      if (pending) { dirty ||= invalidate; return pending; }
      controller = new AbortController();
      pending = (async () => {
        try {
          const response = await authFetch("/api/lanflow/cash-counts/lock", { cache: "no-store", signal: controller!.signal });
          await assertApiResponse(response);
          const next = parseCashCountLocks(await response.json());
          if (!next) throw new Error("ข้อมูลสถานะล็อกไม่ถูกต้อง");
          if (!active) return;
          const now = Date.parse(next.serverNow);
          setData({ scope, states: next.states, offset: now - Date.now() }); setError(null);
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
    read.current = refresh; void refresh();
    window.addEventListener("focus", changed); window.addEventListener("online", changed);
    window.addEventListener("lanflow:cash-count-lock-changed", changed); window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false; controller?.abort(); if (timer) clearTimeout(timer); read.current = null;
      window.removeEventListener("focus", changed); window.removeEventListener("online", changed);
      window.removeEventListener("lanflow:cash-count-lock-changed", changed); window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled, scope]);
  const unlock = useCallback(async (locationId: string) => {
    if (working) return;
    setWorking(locationId); setError(null);
    try {
      const response = await authFetch("/api/lanflow/cash-counts/lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId }) });
      await assertApiResponse(response);
      await read.current?.(); window.dispatchEvent(new Event("lanflow:cash-count-unlocked"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ปลดล็อกไม่สำเร็จ"); }
    finally { setWorking(null); }
  }, [working]);
  const refresh = useCallback(() => read.current?.(), []);
  return { states: enabled && data?.scope === scope ? data.states : [], offset: data?.offset ?? 0, error: enabled ? error : null, working, unlock, refresh };
}
