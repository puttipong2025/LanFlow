import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  RubberBillApprovalMarker,
  RubberBillApprovalReason,
  RubberBillApprovalRequest,
  RubberBillApprovalSettings,
} from "@/types";

export const RUBBER_BILL_APPROVAL_SETTINGS_KEY = "rubberBillApprovalSettings";
export const RUBBER_BILL_APPROVAL_MARKERS_KEY = "rubberBillApprovalMarkers";
export const RUBBER_BILL_APPROVAL_REQUESTS_KEY = "rubberBillApprovalRequests";

function mapRequest(row: any): RubberBillApprovalRequest {
  return {
    id: row.id,
    operation: row.operation,
    requestStatus: row.request_status,
    billId: row.bill_id,
    locationId: row.location_id,
    clientTempId: row.client_temp_id,
    baseRevisionNo: row.base_revision_no,
    matchedReasons: row.matched_reasons as RubberBillApprovalReason[],
    configuredPriceSnapshot:
      row.configured_price_snapshot == null ? null : Number(row.configured_price_snapshot),
    originalPayload: row.original_payload,
    proposedPayload: row.proposed_payload,
    requestedByName: row.requested_by_name,
    requestedByPhone: row.requested_by_phone,
    requestedAt: row.requested_at,
    approvedByName: row.approved_by_name,
    approvedByPhone: row.approved_by_phone,
    approvedAt: row.approved_at,
    createdBillId: row.created_bill_id,
  };
}

export function useRubberBillApprovals({
  locationId,
  includeRequests = false,
}: {
  locationId: string;
  includeRequests?: boolean;
}) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: [RUBBER_BILL_APPROVAL_SETTINGS_KEY],
    queryFn: async (): Promise<RubberBillApprovalSettings> => {
      const { data, error } = await supabase
        .from("rubber_bill_approval_settings")
        .select("*")
        .eq("id", true)
        .maybeSingle();

      if (error) throw new Error(error.message || JSON.stringify(error));
      return {
        editWindowMinutes: data?.edit_window_minutes ?? 30,
        configuredPrice: data?.configured_price == null ? null : Number(data.configured_price),
        updatedByName: data?.updated_by_name,
        updatedByPhone: data?.updated_by_phone,
        updatedAt: data?.updated_at,
      };
    },
  });

  const markersQuery = useQuery({
    queryKey: [RUBBER_BILL_APPROVAL_MARKERS_KEY, locationId],
    enabled: Boolean(locationId),
    queryFn: async (): Promise<RubberBillApprovalMarker[]> => {
      const { data, error } = await supabase.rpc(
        "list_rubber_bill_approval_markers",
        { p_location_id: locationId }
      );
      if (error) throw new Error(error.message || JSON.stringify(error));

      return (data ?? []).map((row: any) => ({
        requestId: row.request_id,
        billId: row.bill_id,
        clientTempId: row.client_temp_id,
        operation: row.operation,
        matchedReasons: row.matched_reasons,
        requestedAt: row.requested_at,
        proposedCreatePayload: row.proposed_create_payload,
      }));
    },
  });

  const requestsQuery = useQuery({
    queryKey: [RUBBER_BILL_APPROVAL_REQUESTS_KEY],
    enabled: includeRequests,
    queryFn: async (): Promise<RubberBillApprovalRequest[]> => {
      const { data, error } = await supabase
        .from("rubber_bill_approval_requests")
        .select("*")
        .order("requested_at", { ascending: false })
        .limit(100);

      if (error) throw new Error(error.message || JSON.stringify(error));
      return (data ?? []).map(mapRequest);
    },
  });

  function invalidateApprovalData() {
    void queryClient.invalidateQueries({ queryKey: [RUBBER_BILL_APPROVAL_REQUESTS_KEY] });
    void queryClient.invalidateQueries({ queryKey: [RUBBER_BILL_APPROVAL_MARKERS_KEY] });
    void queryClient.invalidateQueries({ queryKey: ["rubberBills"] });
    void queryClient.invalidateQueries({ queryKey: ["moneyTransfers"] });
    void queryClient.invalidateQueries({ queryKey: ["incomeExpense"] });
    void queryClient.invalidateQueries({ queryKey: ["acidStock"] });
  }

  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: Pick<RubberBillApprovalSettings, "editWindowMinutes" | "configuredPrice">) => {
      const response = await fetch("/api/lanflow/rubber-bills/approval-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.errorMessage || "บันทึกการตั้งค่าไม่สำเร็จ");
      }
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [RUBBER_BILL_APPROVAL_SETTINGS_KEY] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(
        `/api/lanflow/rubber-bills/approval-requests/${id}/approve`,
        { method: "POST" }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.errorMessage || "อนุมัติคำขอไม่สำเร็จ");
      }
      return data;
    },
    onSuccess: invalidateApprovalData,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(
        `/api/lanflow/rubber-bills/approval-requests/${id}`,
        { method: "DELETE" }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.errorMessage || "ลบคำขอไม่สำเร็จ");
      }
      return data;
    },
    onSuccess: invalidateApprovalData,
  });

  return {
    settings: settingsQuery.data,
    markers: markersQuery.data ?? [],
    requests: requestsQuery.data ?? [],
    pendingCount: (requestsQuery.data ?? []).filter(
      (request) => request.requestStatus === "pending"
    ).length,
    isLoading:
      settingsQuery.isLoading ||
      markersQuery.isLoading ||
      (includeRequests && requestsQuery.isLoading),
    error:
      settingsQuery.error ??
      markersQuery.error ??
      (includeRequests ? requestsQuery.error : null),
    saveSettings: saveSettingsMutation.mutateAsync,
    approveRequest: approveMutation.mutateAsync,
    deleteRequest: deleteMutation.mutateAsync,
  };
}
