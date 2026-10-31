"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ACTIONABLE_BADGES_QUERY_KEY } from "@/hooks/useActionableBadges";
import { AlertDialog } from "@/components/shared/AlertDialog";
import { authFetch } from "@/lib/auth-fetch";
import { formatPayrollCurrency } from "@/lib/time-tracking/format";
import { invalidatePaymentLocations } from "./invalidate-payment";
import { TIME_TRACKING_OFFLINE_MESSAGE } from "./policy";

export function WithdrawalAdjustmentDelete({ adjustment, reason, online, saving, ownerUserId, refresh }: {
  adjustment: { id: string; amount: number | string; adjustment_base_amount: number | string; expense_location_id?: string | null };
  reason: string | null; online: boolean; saving: boolean; ownerUserId: string;
  refresh: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const blocked = reason || (!online ? TIME_TRACKING_OFFLINE_MESSAGE : null);

  async function remove() {
    if (submitting.current || saving || blocked) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await authFetch("/api/lanflow/time-tracking/admin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DELETE_TRANSACTION", payload: { transaction_id: adjustment.id } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "ไม่สามารถลบการปรับยอดได้");
      setOpen(false);
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] }),
        invalidatePaymentLocations(queryClient, ownerUserId, [adjustment.expense_location_id]),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ไม่สามารถลบการปรับยอดได้ กรุณาลองใหม่");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0">
      <button type="button" aria-label="ลบการปรับยอด" title={blocked || "ลบการปรับยอดล่าสุด"} disabled={saving || busy || Boolean(blocked)}
        onClick={() => { setError(null); setOpen(true); }}
        className="inline-flex h-10 items-center justify-center rounded-md bg-danger px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
        ลบ
      </button>
      {blocked && <p className="mt-2 max-w-sm text-pretty text-xs text-ink/65">{blocked}</p>}
      <AlertDialog open={open} title="ลบการปรับยอดเบิกล่าสุด"
        description={`คืนยอดเบิกจาก ${formatPayrollCurrency(Number(adjustment.amount))} เป็น ${formatPayrollCurrency(Number(adjustment.adjustment_base_amount))} พร้อมลบรับ–จ่ายส่วนต่างที่คู่กัน (ถ้ามี) และคำนวณยอดหักของเดือนเปิดใหม่`}
        confirmLabel="ยืนยันลบ" confirmClassName="bg-danger" busy={busy}
        onCancel={() => setOpen(false)} onConfirm={() => void remove()}>
        {error && <p role="alert" className="mt-3 text-pretty text-sm font-semibold text-danger">{error}</p>}
      </AlertDialog>
    </div>
  );
}
