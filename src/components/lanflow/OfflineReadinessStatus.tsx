"use client";

import { useEffect, useState } from "react";
import { inspectOfflineReadiness, readOfflineManifest, type OfflineReadiness } from "@/lib/offline-readiness";
import type { BusinessCacheStatus } from "@/hooks/useBusinessCacheStatus";
import { BusinessCacheDetails, businessCacheSummary } from "./BusinessCacheDetails";
import { BusinessCacheSettings } from "./BusinessCacheSettings";

const INITIAL: OfflineReadiness = { percent: 0, ready: false, detail: "กำลังตรวจข้อมูลในเครื่อง" };

export function OfflineReadinessStatus({ userId, locationId, online, businessCacheStatus, canEditCacheSettings = false }: {
  userId: string; locationId: string; online: boolean; businessCacheStatus?: BusinessCacheStatus; canEditCacheSettings?: boolean;
}) {
  const [state, setState] = useState(INITIAL);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let manifest: Awaited<ReturnType<typeof readOfflineManifest>> | undefined;
    let controller: AbortController | undefined;
    setState(INITIAL);
    async function check() {
      if (running || cancelled) return;
      running = true;
      const currentGeneration = generation;
      let ready = false;
      try {
        if (!("caches" in window) || !("serviceWorker" in navigator)) {
          throw new Error("อุปกรณ์นี้ยังไม่รองรับการเตรียมแอปออฟไลน์");
        }
        if (!manifest) {
          const attempt = new AbortController();
          controller = attempt;
          const timeout = setTimeout(() => attempt.abort(), 10000);
          try {
            const loadedManifest = await readOfflineManifest(online, attempt.signal);
            if (cancelled || currentGeneration !== generation) return;
            manifest = loadedManifest;
          }
          finally { clearTimeout(timeout); }
        }
        const result = await inspectOfflineReadiness(manifest, userId, locationId);
        ready = result.ready;
        if (!cancelled && currentGeneration === generation) setState(result);
      } catch (error) {
        if (!cancelled && currentGeneration === generation) setState({ percent: 0, ready: false, detail: error instanceof Error ? error.message : "ตรวจข้อมูลออฟไลน์ไม่สำเร็จ" });
      } finally {
        running = false;
        if (!cancelled && (manifest || currentGeneration !== generation)) {
          clearTimeout(timer);
          timer = setTimeout(() => { if (!document.hidden) void check(); }, currentGeneration !== generation ? 0 : ready ? 30000 : 2000);
        }
      }
    }
    const recheck = () => { if (!document.hidden) { clearTimeout(timer); void check(); } };
    const workerChanged = () => {
      generation += 1;
      controller?.abort();
      manifest = undefined;
      setState(INITIAL);
      recheck();
    };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("storage", recheck);
    navigator.serviceWorker?.addEventListener("controllerchange", workerChanged);
    void check();
    return () => {
      cancelled = true;
      controller?.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("storage", recheck);
      navigator.serviceWorker?.removeEventListener("controllerchange", workerChanged);
    };
  }, [userId, locationId, online, revision]);

  return (
    <details className="max-w-xs rounded-lg border border-mint bg-white px-3 py-2 text-xs text-ink">
      <summary className="focus-ring cursor-pointer font-semibold">
        <span role="status">{state.ready ? "พร้อมใช้งานออฟไลน์" : online ? "เตรียมออฟไลน์" : "ยังไม่พร้อมออฟไลน์"} {state.percent}%</span>
      </summary>
      {businessCacheStatus && <p role="status" className="mt-1 text-pretty">{businessCacheSummary(businessCacheStatus, online)}</p>}
      <progress aria-label="ความพร้อมใช้งานออฟไลน์" value={state.percent} max={100} className="mt-2 h-2 w-full accent-leaf" />
      <p className="mt-1 text-pretty">{state.detail}</p>
      {businessCacheStatus && <BusinessCacheDetails status={businessCacheStatus} online={online} />}
      <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setRevision((value) => value + 1)} className="focus-ring min-h-11 rounded-md border border-mint px-3 font-semibold">
        ตรวจความพร้อมอีกครั้ง
      </button>
      <BusinessCacheSettings owner={userId} canEdit={canEditCacheSettings} online={online} />
      </div>
    </details>
  );
}
