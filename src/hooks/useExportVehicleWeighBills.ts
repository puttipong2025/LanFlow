"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import type {
  WexDeleteReceipt,
  WexDetails,
  WexLineInput,
  WexListResponse,
  WexMutationReceipt,
  WexOptionsResponse,
  WexPermissions,
  WexSummary,
} from "@/types/export-vehicle-weigh-bills";

const PAGE_SIZE = 25;
const API_BASE = "/api/lanflow/export-vehicle-weigh-bills";

export type ExportVehicleWeighBillLineInput = WexLineInput;

export type ExportVehicleWeighBillPayload = {
  lines: ExportVehicleWeighBillLineInput[];
  rubberExportIds: string[];
};

export type ExportVehicleWeighBillPermissions = WexPermissions;

const noPermissions: ExportVehicleWeighBillPermissions = {
  canCreate: false,
  canEdit: false,
  canDelete: false,
};

export function useExportVehicleWeighBills({
  locationId,
  online,
}: {
  locationId: string;
  online: boolean;
}) {
  const [bills, setBills] = useState<WexSummary[]>([]);
  const [permissions, setPermissions] = useState<ExportVehicleWeighBillPermissions>(noPermissions);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const listControllerRef = useRef<AbortController | null>(null);
  const scopeRef = useRef(0);

  const cancelListRequest = useCallback(() => {
    listControllerRef.current?.abort();
    listControllerRef.current = null;
    setLoading(false);
    setLoadingMore(false);
  }, []);

  const requestList = useCallback(async ({ append }: { append: boolean }) => {
    if (!online || !locationId) return;
    cancelListRequest();
    const controller = new AbortController();
    const requestScope = scopeRef.current;
    listControllerRef.current = controller;
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setError(null);
    }

    try {
      const query = new URLSearchParams({ locationId, limit: String(PAGE_SIZE) });
      if (append && cursorRef.current) query.set("cursor", cursorRef.current);
      const response = await authFetch(`${API_BASE}?${query.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      await assertApiResponse(response);
      const data = await response.json() as WexListResponse;
      if (scopeRef.current !== requestScope || listControllerRef.current !== controller) return;
      setBills((current) => append ? [...current, ...data.bills] : data.bills);
      setPermissions(data.permissions ?? noPermissions);
      setHasMore(data.hasMore);
      cursorRef.current = data.nextCursor;
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return;
      if (scopeRef.current === requestScope && listControllerRef.current === controller) {
        setError(caught instanceof Error ? caught.message : "โหลดบิลรถส่งออกไม่สำเร็จ");
      }
    } finally {
      if (listControllerRef.current === controller && scopeRef.current === requestScope) {
        listControllerRef.current = null;
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    }
  }, [cancelListRequest, locationId, online]);

  const reload = useCallback(async () => {
    cursorRef.current = null;
    await requestList({ append: false });
  }, [requestList]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !cursorRef.current) return;
    await requestList({ append: true });
  }, [hasMore, loadingMore, requestList]);

  useEffect(() => {
    scopeRef.current += 1;
    cancelListRequest();
    cursorRef.current = null;
    setBills([]);
    setHasMore(false);
    setError(null);
    setPermissions(noPermissions);
    setLoading(false);
    setLoadingMore(false);
    if (online && locationId) void reload();
  }, [cancelListRequest, locationId, online, reload]);

  useEffect(() => () => {
    scopeRef.current += 1;
    cancelListRequest();
  }, [cancelListRequest]);

  const details = useCallback(async (wexId: string, signal?: AbortSignal) => {
    const response = await authFetch(`${API_BASE}/${encodeURIComponent(wexId)}`, {
      cache: "no-store",
      signal,
    });
    await assertApiResponse(response);
    return response.json() as Promise<WexDetails>;
  }, []);

  const options = useCallback(async (wexId?: string, signal?: AbortSignal) => {
    const query = new URLSearchParams({ locationId });
    if (wexId) query.set("wexId", wexId);
    const response = await authFetch(`${API_BASE}/options?${query.toString()}`, {
      cache: "no-store",
      signal,
    });
    await assertApiResponse(response);
    return response.json() as Promise<WexOptionsResponse>;
  }, [locationId]);

  const create = useCallback(async (payload: ExportVehicleWeighBillPayload) => {
    const response = await authFetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId, ...payload }),
    });
    await assertApiResponse(response);
    const created = await response.json() as WexMutationReceipt;
    await reload();
    return created;
  }, [locationId, reload]);

  const update = useCallback(async (
    wexId: string,
    expectedRevision: number,
    payload: ExportVehicleWeighBillPayload,
  ) => {
    const response = await authFetch(`${API_BASE}/${encodeURIComponent(wexId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision, ...payload }),
    });
    await assertApiResponse(response);
    const updated = await response.json() as WexMutationReceipt;
    await reload();
    return updated;
  }, [reload]);

  const remove = useCallback(async (wexId: string, expectedRevision: number) => {
    const requestScope = scopeRef.current;
    const response = await authFetch(`${API_BASE}/${encodeURIComponent(wexId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision }),
    });
    await assertApiResponse(response);
    const deleted = await response.json() as WexDeleteReceipt;
    if (scopeRef.current !== requestScope) return deleted;
    cancelListRequest();
    setBills((current) => current.filter((bill) => bill.id !== wexId));
    await reload();
    return deleted;
  }, [cancelListRequest, reload]);

  return {
    bills,
    permissions,
    loading,
    loadingMore,
    error,
    hasMore,
    reload,
    loadMore,
    details,
    options,
    create,
    update,
    remove,
  };
}
