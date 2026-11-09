import { useQueries, useQuery } from "@tanstack/react-query";

import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";
import { isPendingRubberApprovalIdentity } from "@/lib/rubber-bills/approval";
import { mapRubberBillFeedRow } from "@/lib/rubber-bills/map-feed-row";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { requireSupabaseExactCount } from "@/lib/supabase-pages";
import { isIsoTimestamp, isJsonObject, isoTimestampMicros, isUuid } from "@/lib/validation/primitives";
import type { Location, RubberBill } from "@/types";

export function useRubberPendingApprovalCount(ownerUserId: string, locations: Location[], enabled: boolean) {
  const locationIds = locations.map((location) => location.id).sort();
  return useQuery({
    queryKey: [...moneyFlowQueryKeys.rubberBillWorkCounts(ownerUserId, "all"), locationIds],
    enabled: enabled && locationIds.length > 0,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await createSupabaseBrowserClient()
        .from("rubber_bill_approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("request_status", "pending")
        .in("location_id", locationIds);
      if (error) throw new Error(error.message);
      return requireSupabaseExactCount(count);
    },
  });
}

async function loadBranchApprovalQueue(locationId: string, signal: AbortSignal) {
  const bills = new Map<string, RubberBill>();
  const seenCursors = new Set<string>();
  const params = new URLSearchParams({ locationId, mode: "pending_approval", limit: "150" });
  let cursor: string | null = null;
  do {
    if (cursor) params.set("cursor", cursor);
    const response = await authFetch(`/api/lanflow/rubber-bills/feed?${params}`, { signal });
    await assertApiResponse(response);
    const page: unknown = await response.json().catch(() => null);
    if (!isJsonObject(page) || !Array.isArray(page.rows) || typeof page.hasMore !== "boolean") {
      throw new Error("โหลดคิวบิลยางไม่สำเร็จ เพราะรูปแบบหน้าข้อมูลไม่ถูกต้อง");
    }
    const nextCursor = page.nextCursor;
    if (page.hasMore) {
      if (!page.rows.length || typeof nextCursor !== "string" || !nextCursor || seenCursors.has(nextCursor)) {
        throw new Error("โหลดคิวบิลยางไม่สำเร็จ เพราะไม่สามารถอ่านหน้าถัดไป");
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    } else {
      if (nextCursor !== null) throw new Error("โหลดคิวบิลยางไม่สำเร็จ เพราะข้อมูลหน้าสุดท้ายไม่ถูกต้อง");
      cursor = null;
    }
    for (const row of page.rows) {
      if (!isJsonObject(row)
        || row.location_id !== locationId
        || !isIsoTimestamp(row.operational_sort_at)
        || !isUuid(row.id)
        || !isPendingRubberApprovalIdentity(row)
        || row.work_identity !== `${row.row_kind === "bill" ? "bill" : "approval"}:${row.id}`) {
        throw new Error("โหลดคิวบิลยางไม่สำเร็จ เพราะรูปแบบรายการไม่ถูกต้อง");
      }
      const bill = mapRubberBillFeedRow(row);
      bills.set(bill.id, bill);
    }
  } while (cursor);
  return [...bills.values()];
}

export function useRubberApprovalQueue(
  ownerUserId: string, locations: Location[], locationFilter: string, online: boolean,
) {
  const branches = locationFilter === "all" ? locations : locations.filter(({ id }) => id === locationFilter);
  return useQueries({
    queries: branches.map(({ id }) => ({
      queryKey: [...moneyFlowQueryKeys.rubberBillOperationalFeedRoot(), "approvalQueue", ownerUserId, id],
      enabled: online,
      queryFn: ({ signal }: { signal: AbortSignal }) => loadBranchApprovalQueue(id, signal),
    })),
    combine: (results) => {
      const failed = results.filter((result) => result.isError);
      const ordered = results.flatMap((result) => result.isError ? [] : result.data ?? [])
        .map((bill) => ({
          bill,
          time: isoTimestampMicros(bill.operationalSortAt ?? bill.clientCreatedAt),
          workIdentity: bill.id.startsWith("approval:") ? bill.id : `bill:${bill.id}`,
        }))
        .sort((a, b) => {
          if (a.time !== b.time) return a.time < b.time ? -1 : 1;
          if (a.workIdentity === b.workIdentity) return 0;
          return a.workIdentity < b.workIdentity ? -1 : 1;
        });
      return {
        bills: ordered.map(({ bill }) => bill),
        error: failed[0]?.error,
        isLoading: results.some((result) => result.isLoading),
        isRetrying: failed.some((result) => result.isFetching),
        retryFailed: () => Promise.all(failed.map((result) => result.refetch({ cancelRefetch: false }))),
      };
    },
  });
}
