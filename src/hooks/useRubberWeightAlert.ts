"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiResponseError, assertApiResponse, authFetch } from "@/lib/auth-fetch";
import { isNetworkCancellation } from "@/lib/network-abort";
import { parseBranchThresholdCheck, type BranchThresholdCheck } from "@/lib/lanflow/branch-threshold-alert";
import { readRubberWeightAlertLastCheckedAt, rubberWeightAlertDelayMs, writeRubberWeightAlertLastCheckedAt, type RubberWeightAlertConfig } from "@/lib/lanflow/rubber-weight-alert";

export function useRubberWeightAlert({ userId, enabled, config, onConfigChange, scopeKey }: {
  userId: string; enabled: boolean; scopeKey: string; config: RubberWeightAlertConfig;
  onConfigChange: (config: RubberWeightAlertConfig) => void;
}) {
  const [alert, setAlert] = useState<BranchThresholdCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<(() => Promise<void>) | null>(null);
  const callbackRef = useRef(onConfigChange);
  callbackRef.current = onConfigChange;
  const configRef = useRef(config);
  configRef.current = config;
  const lastRef = useRef<{ userId: string; at: number } | null>(null);
  const opened = useRef(false);
  const dismiss = useRef<(() => void) | null>(null);

  useEffect(() => { opened.current = false; setAlert(null); setError(null); }, [enabled, userId, scopeKey]);

  useEffect(() => {
    setChecking(false);
    if (!enabled || !userId) { requestRef.current = null; return; }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let pending: Promise<void> | null = null;
    let showEmpty = false;
    let notify = false;
    let dirty = false;
    const read = (manual: boolean, silent = false, invalidate = false): Promise<void> => {
      showEmpty ||= manual;
      notify ||= !silent;
      if (pending) { dirty ||= invalidate; return pending; }
      setChecking(true); setError(null);
      controller = new AbortController();
      const signal = controller.signal;
      pending = (async () => {
        try {
          let result: BranchThresholdCheck | null = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const response = await authFetch("/api/lanflow/threshold-alert", { cache: "no-store", signal });
              await assertApiResponse(response);
              result = parseBranchThresholdCheck(await response.json());
              if (!result) throw new Error("ข้อมูลการแจ้งเตือนไม่ถูกต้อง");
              break;
            } catch (cause) {
              if (isNetworkCancellation(cause) || signal.aborted || attempt === 1
                || (cause instanceof ApiResponseError && [401, 403].includes(cause.status))) throw cause;
            }
          }
          if (!active || !result || dirty) return;
          configRef.current = result.config; callbackRef.current(result.config);
          if (notify || opened.current) {
            const next = result.candidates.length > 0 || showEmpty ? result : null;
            opened.current = next !== null; setAlert(next);
          }
        } catch (cause) {
          if (!active || signal.aborted || isNetworkCancellation(cause)) return;
          const message = cause instanceof ApiResponseError && cause.status === 403
            ? "ไม่มีสิทธิ์ตรวจการแจ้งเตือน" : "ตรวจการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่";
          setError(message);
          if (!showEmpty && !silent) toast.error(message);
        } finally {
          pending = null; controller = null;
          if (active && dirty) { dirty = false; void read(false, true); }
          else { showEmpty = false; notify = false; if (active) setChecking(false); }
        }
      })();
      return pending;
    };
    const schedule = () => {
      const stored = readRubberWeightAlertLastCheckedAt(userId);
      const memory = lastRef.current?.userId === userId ? lastRef.current.at : null;
      timer = setTimeout(() => {
        const at = Date.now(); lastRef.current = { userId, at };
        writeRubberWeightAlertLastCheckedAt(userId, at);
        void read(false).finally(() => { if (active) schedule(); });
      }, rubberWeightAlertDelayMs(stored === null ? memory : Math.max(stored, memory ?? 0), configRef.current.intervalMinutes));
    };
    requestRef.current = () => read(true);
    const changed = () => { void read(false, true, true); };
    const storage = (event: StorageEvent) => { if (event.key === "lanflow:cash-count-lock-changed") changed(); };
    dismiss.current = () => { notify = false; showEmpty = false; };
    window.addEventListener("lanflow:cash-count-lock-changed", changed);
    window.addEventListener("storage", storage);
    schedule();
    return () => {
      active = false; requestRef.current = null;
      dismiss.current = null;
      window.removeEventListener("lanflow:cash-count-lock-changed", changed);
      window.removeEventListener("storage", storage);
      if (timer !== null) clearTimeout(timer);
      controller?.abort();
    };
  }, [enabled, userId, scopeKey, config.intervalMinutes]);
  const checkNow = useCallback(() => requestRef.current?.(), []);
  return { alert: enabled ? alert : null, checking, error, checkNow, acknowledge: () => { opened.current = false; dismiss.current?.(); setAlert(null); } };
}
