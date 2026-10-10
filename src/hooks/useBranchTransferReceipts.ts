"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { mapMoneyTransferRow } from "@/hooks/useMoneyTransfers";
import { authFetchJson, assertApiResponse } from "@/lib/auth-fetch";
import { invalidateMoneyFlowLocation } from "@/lib/money-flow/invalidation";
import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { BranchMoneyTransferSummary } from "@/types";

const branchReceiptKeys = {
  pending: (ownerUserId: string, locationId: string) =>
    [...moneyFlowQueryKeys.branchMoneyTransferReceiptsRoot(), "pending", ownerUserId, locationId] as const,
  detail: (ownerUserId: string, locationId: string, id: string) =>
    [...moneyFlowQueryKeys.branchMoneyTransferReceiptsRoot(), "detail", ownerUserId, locationId, id] as const,
};

const PENDING_QUEUE_CONTRACT_ERROR = "รูปแบบคิวโอนเข้าบัญชีรอยืนยันไม่ถูกต้อง";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapSummary(raw: unknown): BranchMoneyTransferSummary {
  if (
    !isRecord(raw)
    || typeof raw.id !== "string"
    || !UUID_PATTERN.test(raw.id)
    || typeof raw.net_amount_to_pay !== "number"
    || !Number.isFinite(raw.net_amount_to_pay)
    || raw.net_amount_to_pay < 0
    || typeof raw.created_by_name !== "string"
  ) {
    throw new Error(PENDING_QUEUE_CONTRACT_ERROR);
  }

  return {
    id: raw.id,
    netAmountToPay: raw.net_amount_to_pay,
    createdByName: raw.created_by_name,
  };
}

export function parsePendingBranchMoneyTransfers(value: unknown): {
  transfers: BranchMoneyTransferSummary[];
  total: number;
} {
  if (
    !isRecord(value)
    || !Array.isArray(value.rows)
    || !Number.isSafeInteger(value.total)
    || value.rows.length !== Math.min(Number(value.total), 20)
  ) {
    throw new Error(PENDING_QUEUE_CONTRACT_ERROR);
  }

  return {
    transfers: value.rows.map(mapSummary),
    total: Number(value.total),
  };
}

export function useBranchTransferReceipts(
  ownerUserId: string,
  locationId: string,
  detailId?: string | null,
  { includePending = true }: { includePending?: boolean } = {},
) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const refresh = () => invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId });

  const pendingQuery = useQuery({
    queryKey: branchReceiptKeys.pending(ownerUserId, locationId),
    enabled: Boolean(includePending && ownerUserId && locationId && online),
    refetchInterval: online ? 15_000 : false,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_pending_branch_money_transfers", {
        p_location_id: locationId,
      });
      if (error) throw new Error(error.message);
      return parsePendingBranchMoneyTransfers(data);
    },
  });

  const detailQuery = useQuery({
    queryKey: branchReceiptKeys.detail(ownerUserId, locationId, detailId ?? "none"),
    enabled: Boolean(ownerUserId && locationId && detailId && online),
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_branch_money_transfer_detail", {
        p_transfer_id: detailId!,
      });
      if (error) throw new Error(error.message);
      return mapMoneyTransferRow(data);
    },
  });

  const receive = useMutation({
    mutationFn: async ({ id, revisionNo }: { id: string; revisionNo: number }) => {
      const response = await authFetchJson(
        `/api/lanflow/money-transfers/${id}/receive`,
        "POST",
        { revisionNo },
      );
      await assertApiResponse(response);
      return mapMoneyTransferRow(await response.json());
    },
    onSuccess: refresh,
  });

  return {
    pendingTransfers: pendingQuery.data?.transfers ?? [],
    pendingTotal: pendingQuery.data?.total ?? 0,
    pendingError: pendingQuery.isError ? "โหลดคิวโอนเข้าบัญชีรอยืนยันไม่สำเร็จ" : null,
    retryPending: pendingQuery.refetch,
    detail: detailQuery.data,
    detailError: detailQuery.isError ? "โหลดรายละเอียดการโอนเข้าบัญชีไม่สำเร็จ" : null,
    retryDetail: detailQuery.refetch,
    receive,
  };
}
