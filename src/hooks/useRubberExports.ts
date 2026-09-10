"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ACTIONABLE_BADGES_QUERY_KEY } from "@/hooks/useActionableBadges";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import type {
  RubberExportAvailableBill,
  RubberExportDetails,
  RubberExportExpenseDestination,
  RubberExportPermissions,
  RubberExportPreview,
  RubberExportSummary,
} from "@/types/rubber-exports";
import type { DocumentDeletionAudit } from "@/types/deletion-audits";

export function useRubberExports(
  locationId: string,
  online: boolean,
  view: "active" | "history" | "deletions",
  search: string,
  subfilter: string,
) {
  const queryClient = useQueryClient();
  const locationIdRef = useRef(locationId);
  locationIdRef.current = locationId;
  const scopeKey = `${locationId}:${view}:${search}:${subfilter}`;
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  const [exports, setExports] = useState<RubberExportSummary[]>([]);
  const [deletions, setDeletions] = useState<DocumentDeletionAudit[]>([]);
  const [availableBills, setAvailableBills] = useState<RubberExportAvailableBill[]>([]);
  const [permissions, setPermissions] = useState<RubberExportPermissions>({
    canVerify: false,
    canDelete: false,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletionsLoading, setDeletionsLoading] = useState(false);
  const [deletionsError, setDeletionsError] = useState<string | null>(null);
  const [deletionsHasMore, setDeletionsHasMore] = useState(false);
  const [deletionsCursor, setDeletionsCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [deletionRefreshError, setDeletionRefreshError] = useState<string | null>(null);
  const [deletionRefreshing, setDeletionRefreshing] = useState(false);
  const scopeVersion = useRef(0);
  const deletionRefreshVersion = useRef(0);
  const listController = useRef<AbortController | null>(null);
  const optionsController = useRef<AbortController | null>(null);
  const deletionsController = useRef<AbortController | null>(null);
  const optionsCache = useRef(new Map<string, RubberExportAvailableBill[]>());
  const exportsRef = useRef<RubberExportSummary[]>([]);

  const reload = useCallback(async () => {
    if (!locationId || !online) {
      setPermissions({ canVerify: false, canDelete: false });
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    if (view === "deletions") {
      setLoading(false);
      setLoadingMore(false);
      return true;
    }
    listController.current?.abort();
    setLoadingMore(false);
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    listController.current = controller;
    try {
      const params = new URLSearchParams({
        locationId,
        view,
        search,
        subfilter,
        limit: "50",
      });
      const response = await authFetch(
        `/api/lanflow/rubber-exports?${params}`,
        { cache: "no-store", signal: controller.signal }
      );
      await assertApiResponse(response);
      const body = await response.json() as {
        exports: RubberExportSummary[];
        permissions: RubberExportPermissions;
        hasMore: boolean;
        nextCursor: string | null;
      };
      if (scopeKeyRef.current !== scopeKey || controller.signal.aborted) return;
      exportsRef.current = body.exports;
      setExports(body.exports);
      setPermissions(body.permissions ?? { canVerify: false, canDelete: false });
      setHasMore(body.hasMore);
      setNextCursor(body.nextCursor);
      return true;
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "โหลดรายการส่งออกไม่สำเร็จ");
      return false;
    } finally {
      if (listController.current === controller) {
        listController.current = null;
        setLoading(false);
      }
    }
  }, [locationId, online, search, scopeKey, subfilter, view]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || !online || loading || view === "deletions") return false;
    const controller = new AbortController();
    listController.current?.abort();
    listController.current = controller;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        locationId,
        view,
        search,
        subfilter,
        limit: "50",
        cursor: nextCursor,
      });
      const response = await authFetch(
        `/api/lanflow/rubber-exports?${params}`,
        { cache: "no-store", signal: controller.signal },
      );
      await assertApiResponse(response);
      const body = await response.json() as {
        exports: RubberExportSummary[]; hasMore: boolean; nextCursor: string | null;
      };
      if (scopeKeyRef.current !== scopeKey || controller.signal.aborted) return;
      const current = exportsRef.current;
      const currentIds = new Set(current.map((item) => item.id));
      const additions = body.exports.filter((row) => !currentIds.has(row.id));
      if (additions.length > 0) {
        const next = [...current, ...additions];
        exportsRef.current = next;
        setExports(next);
      }
      setHasMore(body.hasMore);
      setNextCursor(body.nextCursor);
      return additions.length > 0;
    } catch (caught) {
      if (controller.signal.aborted || scopeKeyRef.current !== scopeKey) return;
      setError(caught instanceof Error ? caught.message : "โหลดรายการส่งออกเพิ่มไม่สำเร็จ");
      return false;
    } finally {
      if (listController.current === controller) {
        listController.current = null;
        setLoadingMore(false);
      }
    }
  }, [loading, locationId, nextCursor, online, search, scopeKey, subfilter, view]);

  const reloadDeletions = useCallback(async (cursor: string | null = null, append = false) => {
    if (!locationId || !online) return;
    deletionsController.current?.abort();
    const controller = new AbortController();
    deletionsController.current = controller;
    setDeletionsLoading(true);
    setDeletionsError(null);
    try {
      const params = new URLSearchParams({ locationId, view: "deletions" });
      if (cursor) params.set("cursor", cursor);
      const response = await authFetch(
        `/api/lanflow/rubber-exports?${params.toString()}`,
        { cache: "no-store", signal: controller.signal },
      );
      await assertApiResponse(response);
      const body = await response.json() as {
        deletions: DocumentDeletionAudit[];
        hasMore: boolean;
        nextCursor: string | null;
      };
      if (locationIdRef.current === locationId && !controller.signal.aborted) {
        setDeletions((current) => append
          ? [...current, ...body.deletions.filter((row) => !current.some((item) => item.id === row.id))]
          : body.deletions);
        setDeletionsHasMore(body.hasMore);
        setDeletionsCursor(body.nextCursor);
        return true;
      }
    } catch (caught) {
      if (controller.signal.aborted || locationIdRef.current !== locationId) return;
      setDeletionsError(
        caught instanceof Error ? caught.message : "โหลดประวัติการลบไม่สำเร็จ",
      );
      return false;
    } finally {
      if (deletionsController.current === controller) {
        deletionsController.current = null;
        setDeletionsLoading(false);
      }
    }
  }, [locationId, online]);

  useEffect(() => {
    setPermissions({ canVerify: false, canDelete: false });
  }, [locationId]);

  useEffect(() => {
    setDeletionRefreshError(null);
    setDeletionRefreshing(false);
    setError(null);
    exportsRef.current = [];
    setExports([]);
    setDeletions([]);
    setDeletionsError(null);
    setHasMore(false);
    setNextCursor(null);
    setLoadingMore(false);
    setDeletionsHasMore(false);
    setDeletionsCursor(null);
    setAvailableBills([]);
    optionsController.current?.abort();
    void reload();
    return () => {
      scopeVersion.current += 1;
      listController.current?.abort();
      optionsController.current?.abort();
      deletionsController.current?.abort();
    };
  }, [locationId, reload]);

  async function refreshAfterDelete() {
    const scope = scopeVersion.current;
    const request = ++deletionRefreshVersion.current;
    setDeletionRefreshing(true);
    const results = await Promise.allSettled([
      reload(),
      reloadDeletions(),
      queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] }, { throwOnError: true }),
    ]);
    if (scope !== scopeVersion.current || locationIdRef.current !== locationId || request !== deletionRefreshVersion.current) return;
    const failed = results.some((result, index) => result.status === "rejected"
      || (index < 2 && result.status === "fulfilled" && result.value !== true));
    setDeletionRefreshError(failed ? "ลบสำเร็จ แต่โหลดข้อมูลใหม่ไม่สำเร็จ" : null);
    setDeletionRefreshing(false);
  }

  const loadAvailableBills = useCallback(async (mode: "create" | "edit", exportId?: string) => {
    const key = `${locationId}:${mode}:${exportId ?? "new"}`;
    const cached = optionsCache.current.get(key);
    if (cached) {
      setAvailableBills(cached);
      return cached;
    }
    optionsController.current?.abort();
    const controller = new AbortController();
    optionsController.current = controller;
    setOptionsLoading(true);
    try {
      const response = await authFetch(
        `/api/lanflow/rubber-exports/options?locationId=${encodeURIComponent(locationId)}`,
        { cache: "no-store", signal: controller.signal },
      );
      await assertApiResponse(response);
      const body = await response.json() as { availableBills: RubberExportAvailableBill[] };
      if (controller.signal.aborted || locationIdRef.current !== locationId) return [];
      optionsCache.current.set(key, body.availableBills);
      setAvailableBills(body.availableBills);
      return body.availableBills;
    } finally {
      if (optionsController.current === controller) {
        optionsController.current = null;
        setOptionsLoading(false);
      }
    }
  }, [locationId]);

  async function reloadWithBadges() {
    optionsCache.current.clear();
    setAvailableBills([]);
    await Promise.all([
      reload(),
      queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] }),
    ]);
  }

  async function preview(selectedReportItemIds: string[], exportId?: string, signal?: AbortSignal) {
    const response = await authFetch("/api/lanflow/rubber-exports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId, selectedReportItemIds, exportId }),
      signal,
    });
    await assertApiResponse(response);
    return response.json() as Promise<RubberExportPreview>;
  }

  async function create(selectedReportItemIds: string[]) {
    const response = await authFetch("/api/lanflow/rubber-exports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId, selectedReportItemIds }),
    });
    await assertApiResponse(response);
    const created = await response.json() as { id: string; exportNo: string };
    await reloadWithBadges();
    return created;
  }

  async function details(exportId: string, signal?: AbortSignal) {
    const response = await authFetch(`/api/lanflow/rubber-exports/${exportId}`, {
      cache: "no-store",
      signal,
    });
    await assertApiResponse(response);
    return response.json() as Promise<RubberExportDetails>;
  }

  async function update(
    exportId: string,
    values: {
      currentWeight: number | null;
      workRate: number | null;
      otherOperatingCost: number;
    }
  ) {
    const response = await authFetch(`/api/lanflow/rubber-exports/${exportId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    await assertApiResponse(response);
    await reload();
  }

  async function replaceItems(exportId: string, selectedReportItemIds: string[]) {
    const response = await authFetch(`/api/lanflow/rubber-exports/${exportId}/items`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedReportItemIds }),
    });
    await assertApiResponse(response);
    optionsCache.current.clear();
    setAvailableBills([]);
    await reload();
  }

  async function setSoldOut(exportId: string, soldOut: boolean) {
    const response = await authFetch(`/api/lanflow/rubber-exports/${exportId}/sale`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ soldOut }),
    });
    await assertApiResponse(response);
    await reload();
  }

  async function verify(
    exportId: string,
    expenseDestination: RubberExportExpenseDestination,
    values: {
      currentWeight: number;
      workRate: number;
      otherOperatingCost: number;
    }
  ) {
    const response = await authFetch(`/api/lanflow/rubber-exports/${exportId}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expenseDestination, ...values }),
    });
    await assertApiResponse(response);
    await reloadWithBadges();
  }

  async function revertVerification(exportId: string) {
    const response = await authFetch(`/api/lanflow/rubber-exports/${exportId}/verify`, {
      method: "DELETE",
    });
    await assertApiResponse(response);
    await reloadWithBadges();
  }

  async function remove(exportId: string) {
    const scope = scopeVersion.current;
    const response = await authFetch(`/api/lanflow/rubber-exports/${exportId}`, {
      method: "DELETE",
    });
    await assertApiResponse(response);
    if (scope !== scopeVersion.current || locationIdRef.current !== locationId) return;
    listController.current?.abort();
    const remaining = exportsRef.current.filter((row) => row.id !== exportId);
    exportsRef.current = remaining;
    setExports(remaining);
    optionsController.current?.abort();
    optionsCache.current.clear();
    setAvailableBills([]);
    await refreshAfterDelete();
  }

  return {
    exports,
    deletions,
    availableBills,
    permissions,
    loading,
    loadingMore,
    error,
    deletionsLoading,
    deletionsError,
    deletionsHasMore,
    deletionsCursor,
    hasMore,
    optionsLoading,
    deletionRefreshError,
    deletionRefreshing,
    refreshAfterDelete,
    reload,
    loadMore,
    reloadDeletions,
    loadAvailableBills,
    preview,
    create,
    details,
    update,
    replaceItems,
    setSoldOut,
    verify,
    revertVerification,
    remove,
  };
}
