"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ApiResponseError, assertApiResponse, authFetch } from "@/lib/auth-fetch";
import { isNetworkCancellation } from "@/lib/network-abort";
import {
  parseRubberWeightAlertCheck,
  readRubberWeightAlertLastCheckedAt,
  rubberWeightAlertDelayMs,
  writeRubberWeightAlertLastCheckedAt,
  type RubberWeightAlertCheck,
  type RubberWeightAlertConfig,
} from "@/lib/lanflow/rubber-weight-alert";

async function fetchAlertCheck(signal: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await authFetch("/api/lanflow/rubber-weight-alert", {
        cache: "no-store",
        signal,
      });
      await assertApiResponse(response);
      const payload = parseRubberWeightAlertCheck(await response.json());
      if (!payload) throw new Error("ข้อมูลการแจ้งเตือนน้ำหนักไม่ถูกต้อง");
      return payload;
    } catch (error) {
      if (isNetworkCancellation(error)) throw error;
      if (error instanceof ApiResponseError && (error.status === 401 || error.status === 403)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
}

export function useRubberWeightAlert({
  userId,
  enabled,
  config,
  onConfigChange,
}: {
  userId: string;
  enabled: boolean;
  config: RubberWeightAlertConfig;
  onConfigChange: (config: RubberWeightAlertConfig) => void;
}) {
  const [alert, setAlert] = useState<RubberWeightAlertCheck | null>(null);
  const configRef = useRef(config);
  const onConfigChangeRef = useRef(onConfigChange);
  const lastCheckedAtRef = useRef<{ userId: string; value: number } | null>(null);
  configRef.current = config;
  onConfigChangeRef.current = onConfigChange;

  useEffect(() => {
    setAlert(null);
  }, [enabled, userId]);

  useEffect(() => {
    if (!enabled || !userId) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const schedule = () => {
      const storedLastCheckedAt = readRubberWeightAlertLastCheckedAt(userId);
      const memoryLastCheckedAt = lastCheckedAtRef.current?.userId === userId
        ? lastCheckedAtRef.current.value
        : null;
      const delay = rubberWeightAlertDelayMs(
        storedLastCheckedAt === null
          ? memoryLastCheckedAt
          : Math.max(storedLastCheckedAt, memoryLastCheckedAt ?? 0),
        configRef.current.intervalMinutes,
      );
      timer = setTimeout(() => void check(), delay);
    };

    const check = async () => {
      const checkedAt = Date.now();
      lastCheckedAtRef.current = { userId, value: checkedAt };
      writeRubberWeightAlertLastCheckedAt(userId, checkedAt);
      setAlert(null);
      controller = new AbortController();
      try {
        const result = await fetchAlertCheck(controller.signal);
        if (!active) return;
        configRef.current = result.config;
        onConfigChangeRef.current(result.config);
        setAlert(result.candidates.length > 0 ? result : null);
      } catch (error) {
        if (!active || isNetworkCancellation(error)) return;
        toast.error(error instanceof ApiResponseError && error.status === 403
          ? "ไม่มีสิทธิ์ตรวจการแจ้งเตือนน้ำหนัก"
          : "ตรวจการแจ้งเตือนน้ำหนักไม่สำเร็จ ระบบจะลองใหม่ในรอบถัดไป");
      } finally {
        controller = null;
        if (active) schedule();
      }
    };

    schedule();
    return () => {
      active = false;
      if (timer !== null) clearTimeout(timer);
      controller?.abort();
    };
  }, [config.intervalMinutes, enabled, userId]);

  return {
    alert,
    acknowledge: () => setAlert(null),
  };
}
