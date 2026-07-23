import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AcidStockMovement } from "@/types";
import { STOCK_ENTRY_APPROVAL_REQUESTS_KEY } from "@/hooks/useStockEntryApprovals";

const QUERY_KEY = "stock";

function mapMovement(row: any): AcidStockMovement {
  return {
    movementId: row.movement_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceLineId: row.source_line_id,
    txDate: row.tx_date,
    locationId: row.location_id,
    productId: row.product_id,
    productName: row.product_name,
    quantityDelta: Number(row.quantity_delta ?? 0),
    amount: Number(row.amount ?? 0),
    displayBillNo: row.display_bill_no,
    txType: row.tx_type,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdByPhone: row.created_by_phone,
    createdAt: row.created_at,
    relationLockReason: row.relation_lock_reason,
    reportLockNo: row.report_lock_no ?? null,
  };
}

async function postStock(payload: Record<string, unknown>) {
  const response = await fetch("/api/lanflow/acid-stock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.errorMessage || data.error || "บันทึกสต็อกไม่สำเร็จ");
  }

  return data;
}

function makeRequestKey(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

async function postStockEntryDeleteRequest(input: { stockEntryId: string }) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("ลบรายการสต็อกต้องออนไลน์ก่อน");
  }

  const response = await fetch("/api/lanflow/stock-entry-approval-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestIdempotencyKey: makeRequestKey("delete-stock-entry"),
      stockEntryId: input.stockEntryId,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.errorMessage || data.error || "ส่งคำขอลบรายการสต็อกไม่สำเร็จ");
  }

  if (data.status !== "pending") {
    throw new Error(data.errorMessage || "ส่งคำขอลบรายการสต็อกไม่สำเร็จ");
  }

  return data;
}

export function useAcidStock(locationId: string) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [QUERY_KEY, locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("*")
        .eq("location_id", locationId)
        .order("tx_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message || JSON.stringify(error));
      const rows = (data || []).map(mapMovement);
      const entryIds = [...new Set(
        rows.filter((row) => row.sourceType === "stock_entry").map((row) => row.sourceId)
      )];
      if (entryIds.length === 0) return rows;

      const { data: locks, error: lockError } = await supabase
        .from("stock_entries")
        .select("id, report_lock_no")
        .in("id", entryIds);
      if (lockError) throw new Error(lockError.message || JSON.stringify(lockError));
      const lockById = new Map(
        (locks || []).map((row) => [row.id, row.report_lock_no as string | null])
      );
      return rows.map((row) => ({
        ...row,
        reportLockNo: row.sourceType === "stock_entry"
          ? lockById.get(row.sourceId) ?? null
          : null,
      }));
    },
    enabled: !!locationId,
  });

  const receiveMutation = useMutation({
    mutationFn: async (input: { locationId: string; productId: string; txDate: string; quantity: number; amount: number }) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error("รับเข้าสต็อกต้องออนไลน์ก่อน");
      }

      return postStock({ action: "receive", ...input });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, locationId] });
    },
  });

  const transferMutation = useMutation({
    mutationFn: async (input: { fromLocationId: string; toLocationId: string; productId: string; txDate: string; quantity: number }) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error("ย้ายสต็อกต้องออนไลน์ก่อน");
      }

      return postStock({ action: "transfer", ...input });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  const deleteEntryMutation = useMutation({
    mutationFn: postStockEntryDeleteRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [STOCK_ENTRY_APPROVAL_REQUESTS_KEY] });
    },
  });

  return {
    movements: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    receiveStock: receiveMutation.mutateAsync,
    transferStock: transferMutation.mutateAsync,
    deleteStockEntry: deleteEntryMutation.mutateAsync,
  };
}
