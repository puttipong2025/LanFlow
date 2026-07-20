import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { StockProductApprovalRequest } from "@/types";

const REQUESTS_KEY = "stockProductApprovalRequests";

function mapRequest(row: any): StockProductApprovalRequest {
  return {
    id: row.id,
    requestStatus: row.request_status,
    requestType: row.request_type,
    productId: row.product_id,
    productName: row.product_name,
    unit: row.unit,
    createSaleItem: row.create_sale_item,
    requestedByName: row.requested_by_name,
    requestedByPhone: row.requested_by_phone,
    decidedByName: row.decided_by_name,
    decidedByPhone: row.decided_by_phone,
    decidedAt: row.decided_at,
    decisionComment: row.decision_comment,
    createdAt: row.created_at,
  };
}

export function useStockProductApprovals(options: { includeRequests?: boolean } = {}) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();
  const includeRequests = options.includeRequests ?? true;

  const requestsQuery = useQuery({
    queryKey: [REQUESTS_KEY],
    enabled: includeRequests,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_product_approval_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(80);

      if (error) throw new Error(error.message || JSON.stringify(error));
      return (data || []).map(mapRequest);
    },
  });

  const decideRequestMutation = useMutation({
    mutationFn: async ({ id, decision, comment }: { id: string; decision: "approved" | "rejected"; comment?: string }) => {
      const response = await fetch(`/api/lanflow/stock-product-approval-requests/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.errorMessage || data.error || "ดำเนินการคำขอสินค้าไม่สำเร็จ");
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [REQUESTS_KEY] });
      queryClient.invalidateQueries({ queryKey: ["stockProducts"] });
      queryClient.invalidateQueries({ queryKey: ["incomeSaleItems"] });
      queryClient.invalidateQueries({ queryKey: ["stock"] });
    },
  });

  return {
    requests: requestsQuery.data || [],
    isLoading: includeRequests && requestsQuery.isLoading,
    decideRequest: decideRequestMutation.mutateAsync,
  };
}

export { REQUESTS_KEY as STOCK_PRODUCT_APPROVAL_REQUESTS_KEY };
