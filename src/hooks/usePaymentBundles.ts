"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MoneyTransfer } from "@/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { invalidateMoneyFlowLocation } from "@/lib/money-flow/invalidation";
import { parsePaymentBundleDetailPage } from "@/lib/payment-bundle-detail";
import { mapMoneyTransferRow, moneyTransferError } from "./useMoneyTransfers";

export function usePaymentBundleCandidates({
  locationId, bundleType, customerId, accountNumber, enabled,
}: {
  locationId: string;
  bundleType: "customer" | "rubber_export_work";
  customerId?: string | null;
  accountNumber?: string | null;
  enabled: boolean;
}) {
  const supabase = createSupabaseBrowserClient();
  return useQuery({
    queryKey: ["paymentBundleCandidates", locationId, bundleType, customerId, accountNumber],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_payment_bundle_candidates", {
        p_location_id: locationId, p_bundle_type: bundleType,
        p_customer_id: customerId ?? null, p_account_number: accountNumber ?? null, p_page_size: 100,
      });
      if (error) throw moneyTransferError(error);
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("ข้อมูลรายการที่รวมได้ไม่ถูกต้อง");
      }
      const payload = data as Record<string, unknown>;
      if (!Array.isArray(payload.rows)) {
        throw new Error("ข้อมูลรายการที่รวมได้ไม่ครบถ้วน");
      }
      return {
        rows: payload.rows.map(mapMoneyTransferRow) as MoneyTransfer[],
        eligibleCount: Number(payload.eligibleCount ?? 0),
        eligibleAmount: Number(payload.eligibleAmount ?? 0),
        alreadyBundledCount: Number(payload.alreadyBundledCount ?? 0),
        reportLockedCount: Number(payload.reportLockedCount ?? 0),
      };
    },
  });
}

export function usePaymentBundleDetail(bundleId: string | null) {
  const supabase = createSupabaseBrowserClient();
  return useQuery({
    queryKey: ["paymentBundleDetail", bundleId], enabled: Boolean(bundleId),
    queryFn: async () => {
      const children: Array<Record<string, unknown>> = [];
      const seenCursors = new Set<string>();
      const seenChildIds = new Set<string>();
      let cursorCreatedAt: string | null = null;
      let cursorId: string | null = null;
      let payload: Record<string, unknown> | null = null;
      do {
        const { data, error } = await supabase.rpc("get_payment_bundle_detail", {
          p_bundle_id: bundleId!, p_cursor_created_at: cursorCreatedAt,
          p_cursor_id: cursorId, p_page_size: 100,
        });
        if (error) throw moneyTransferError(error);
        const page = parsePaymentBundleDetailPage(data, seenCursors, bundleId!, seenChildIds);
        payload = page.payload;
        children.push(...page.children);
        cursorCreatedAt = page.nextCreatedAt;
        cursorId = page.nextId;
      } while (cursorCreatedAt && cursorId);
      if (!payload) throw new Error("ไม่พบรายละเอียดชุดจ่ายรวม");
      return mapMoneyTransferRow({ ...payload, children });
    },
  });
}

export function usePaymentBundleMutations(locationId: string, ownerUserId: string) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();
  const refresh = () => Promise.all([
    invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId }),
    queryClient.invalidateQueries({ queryKey: ["paymentBundleCandidates"] }),
    queryClient.invalidateQueries({ queryKey: ["paymentBundleDetail"] }),
  ]);
  const createPaymentBundle = useMutation({
    mutationFn: async ({ bundleType, customerId, accountNumber }: {
      bundleType: "customer" | "rubber_export_work"; customerId?: string | null; accountNumber?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("create_or_update_payment_bundle", {
        p_location_id: locationId, p_bundle_type: bundleType,
        p_customer_id: customerId ?? null, p_account_number: accountNumber ?? null,
      });
      if (error) throw moneyTransferError(error);
      return mapMoneyTransferRow(data);
    }, onSuccess: refresh,
  });
  const savePaymentBundle = useMutation({
    mutationFn: async ({ bundle, branchPaysRemaining }: { bundle: MoneyTransfer; branchPaysRemaining: boolean }) => {
      const { data, error } = await supabase.rpc("save_payment_bundle", {
        p_bundle_id: bundle.id, p_expected_revision: bundle.revisionNo ?? 0,
        p_slips: bundle.slips ?? [], p_branch_pays_remaining: branchPaysRemaining,
      });
      if (error) throw moneyTransferError(error);
      return mapMoneyTransferRow(data);
    }, onSuccess: refresh,
  });
  const dissolvePaymentBundle = useMutation({
    mutationFn: async (bundle: MoneyTransfer) => {
      const { data, error } = await supabase.rpc("dissolve_payment_bundle", {
        p_bundle_id: bundle.id, p_expected_revision: bundle.revisionNo ?? 0,
      });
      if (error) throw moneyTransferError(error);
      return data;
    }, onSuccess: refresh,
  });
  return { createPaymentBundle, savePaymentBundle, dissolvePaymentBundle };
}
