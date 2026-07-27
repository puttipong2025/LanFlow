"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ACTIONABLE_BADGES_QUERY_KEY } from "@/hooks/useActionableBadges";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import type {
  RubberExportCutoffOption,
  RubberExportDetails,
  RubberExportExpenseDestination,
  RubberExportPreview,
  RubberExportSummary,
} from "@/types/rubber-exports";

export function useRubberExports(locationId: string, online: boolean) {
  const queryClient = useQueryClient();
  const [exports, setExports] = useState<RubberExportSummary[]>([]);
  const [cutoffOptions, setCutoffOptions] = useState<RubberExportCutoffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!locationId || !online) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch(
        `/api/lanflow/rubber-exports?locationId=${encodeURIComponent(locationId)}`,
        { cache: "no-store" }
      );
      await assertApiResponse(response);
      const body = await response.json() as {
        exports: RubberExportSummary[];
        cutoffOptions: RubberExportCutoffOption[];
      };
      setExports(body.exports);
      setCutoffOptions(body.cutoffOptions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "โหลดรายการส่งออกไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [locationId, online]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function reloadWithBadges() {
    await Promise.all([
      reload(),
      queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] }),
    ]);
  }

  async function preview(cutoffReportItemId: string) {
    const response = await authFetch("/api/lanflow/rubber-exports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId, cutoffReportItemId }),
    });
    await assertApiResponse(response);
    return response.json() as Promise<RubberExportPreview>;
  }

  async function create(cutoffReportItemId: string) {
    const response = await authFetch("/api/lanflow/rubber-exports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId, cutoffReportItemId }),
    });
    await assertApiResponse(response);
    const created = await response.json() as { id: string; exportNo: string };
    await reloadWithBadges();
    return created;
  }

  async function details(exportId: string) {
    const response = await authFetch(`/api/lanflow/rubber-exports/${exportId}`, {
      cache: "no-store",
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

  async function verify(exportId: string, expenseDestination: RubberExportExpenseDestination) {
    const response = await authFetch(`/api/lanflow/rubber-exports/${exportId}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expenseDestination }),
    });
    await assertApiResponse(response);
    await reloadWithBadges();
  }

  async function remove(exportId: string) {
    const response = await authFetch(`/api/lanflow/rubber-exports/${exportId}`, {
      method: "DELETE",
    });
    await assertApiResponse(response);
    await reloadWithBadges();
  }

  return {
    exports,
    cutoffOptions,
    loading,
    error,
    reload,
    preview,
    create,
    details,
    update,
    verify,
    remove,
  };
}
