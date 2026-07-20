import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { StockEntryApprovalRequest } from "@/types";

const REQUESTS_KEY = "stockEntryApprovalRequests";

function mapRequest(row: any): StockEntryApprovalRequest {
  return {
    id: row.id,
    requestStatus: row.request_status,
    requestType: row.request_type,
    stockEntryId: row.stock_entry_id,
    transferBillNo: row.transfer_bill_no,
    txType: row.tx_type,
    productId: row.product_id,
    productName: row.product_name,
    quantity: Number(row.quantity ?? 0),
    locationId: row.location_id,
    locationName: row.location_name,
    targetLocationId: row.target_location_id,
    targetLocationName: row.target_location_name,
    requestedByName: row.requested_by_name,
    requestedByPhone: row.requested_by_phone,
    decidedByName: row.decided_by_name,
    decidedByPhone: row.decided_by_phone,
    decidedAt: row.decided_at,
    decisionComment: row.decision_comment,
    createdAt: row.created_at,
  };
}

export function useStockEntryApprovals(options: { includeRequests?: boolean } = {}) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();
  const includeRequests = options.includeRequests ?? true;

  const requestsQuery = useQuery({
    queryKey: [REQUESTS_KEY],
    enabled: includeRequests,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_entry_approval_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(80);

      if (error) throw new Error(error.message || JSON.stringify(error));
      return (data || []).map(mapRequest);
    },
  });

  const decideRequestMutation = useMutation({
    mutationFn: async ({ id, decision, comment }: { id: string; decision: "approved" | "rejected"; comment?: string }) => {
      const response = await fetch(`/api/lanflow/stock-entry-approval-requests/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.errorMessage || data.error || "ดำเนินการคำขอลบรายการสต็อกไม่สำเร็จ");
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [REQUESTS_KEY] });
      queryClient.invalidateQueries({ queryKey: ["stock"] });
    },
  });

  return {
    requests: requestsQuery.data || [],
    isLoading: includeRequests && requestsQuery.isLoading,
    decideRequest: decideRequestMutation.mutateAsync,
  };
}

export { REQUESTS_KEY as STOCK_ENTRY_APPROVAL_REQUESTS_KEY };
