"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiResponseError, assertApiResponse, authFetch, authFetchJson } from "@/lib/auth-fetch";
import { clearBonusIntent, persistBonusIntent, readBonusIntent, type BonusIntent } from "@/lib/branch-bonus/intent";
import type { BonusChange, BonusDetail, BonusListRow, BonusPage, BonusSettings, BonusSource, BonusSourceSection } from "@/types/branch-bonus";

const baseUrl = "/api/lanflow/branch-bonuses";
export async function fetchBonus<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await authFetchJson(baseUrl, "POST", body, { cache: "no-store", signal });
  await assertApiResponse(response);
  return response.json() as Promise<T>;
}

export function useBranchBonuses(locationId: string, ownerId: string, online: boolean) {
  const [list, setList] = useState<BonusPage<BonusListRow>>({ rows: [], hasMore: false });
  const [loading, setLoading] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<BonusIntent | null>(() => readBonusIntent(ownerId, locationId));
  const flight = useRef(false), loadFlight = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async (view: "list", append = false, tail?: { createdAt: string; id: string }) => {
    if (!online || loadFlight.current === view) return;
    controller.current?.abort(); loadFlight.current = view;
    const abort = new AbortController(); controller.current = abort;
    setLoading(view); setError(null);
    try {
      const params = new URLSearchParams({ locationId, view });
      if (append && tail) { params.set("before", tail.createdAt); params.set("beforeId", tail.id); }
      const response = await authFetch(`${baseUrl}?${params}`, { signal: abort.signal, cache: "no-store" });
      await assertApiResponse(response);
      const page = await response.json();
      if (abort.signal.aborted) return;
      setList(old => ({ ...page, rows: append ? [...old.rows, ...page.rows] : page.rows }));
    } catch (caught) { if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : "โหลดข้อมูลไม่สำเร็จ"); }
    finally { if (controller.current === abort) { setLoading(null); loadFlight.current = null; } }
  }, [locationId, online]);

  useEffect(() => { void load("list"); return () => { controller.current?.abort(); loadFlight.current = null; }; }, [load]);

  async function detail(id: string) {
    const response = await authFetch(`${baseUrl}?${new URLSearchParams({ locationId, id })}`, { cache: "no-store" });
    await assertApiResponse(response); return response.json() as Promise<BonusDetail>;
  }
  async function retryLegacy(): Promise<BonusDetail | null> {
    if (flight.current || !online) return null;
    flight.current = true; setWorking(true); setError(null);
    try {
      const intent = readBonusIntent(ownerId, locationId);
      if (!intent) throw new Error("ไม่พบคำขอเดิม กรุณาตรวจยอดใหม่");
      persistBonusIntent(intent); setPending(intent);
      const saved = await fetchBonus<BonusDetail>({ ...intent, action: "confirm" });
      clearBonusIntent(ownerId, locationId); setPending(null); return saved;
    } catch (caught) {
      // Temporary auth/transport failures cannot disprove an earlier committed request.
      if (caught instanceof ApiResponseError && (caught.status === 400 || caught.status === 409)) {
        clearBonusIntent(ownerId, locationId); setPending(null);
      }
      setError(caught instanceof Error ? caught.message : "ยังไม่ทราบผลยืนยัน กรุณาลองคำขอเดิมอีกครั้ง"); return null;
    } finally { flight.current = false; setWorking(false); }
  }
  async function remove(id: string) {
    if (flight.current || !online) return false;
    flight.current = true; setWorking(true); setError(null);
    try {
      await fetchBonus({ action: "delete", locationId, id });
      controller.current?.abort(); controller.current = null; loadFlight.current = null;
      setLoading(null);
      setList(page => ({ ...page, rows: page.rows.filter(row => row.id !== id) }));
      return true;
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "ลบไม่สำเร็จ กรุณาลองใหม่"); return false; }
    finally { flight.current = false; setWorking(false); }
  }
  const sources = (input: BonusSettings, section: BonusSourceSection, offset: number, id?: string, signal?: AbortSignal) => fetchBonus<{ rows: BonusSource[]; sourceFingerprint: string }>({ action: "sources", locationId, input, section, offset, ...(id ? { id } : {}) },signal);
  const changeSources = (input: BonusSettings, offset: number, id?: string, signal?: AbortSignal) => fetchBonus<{ rows: BonusChange[]; sourceFingerprint: string }>({ action: "sources", locationId, input, section: "changes", offset, ...(id ? { id } : {}) }, signal);
  return { list, loading, working, error, setError, pending, load, detail, retryLegacy, remove, sources, changeSources };
}
