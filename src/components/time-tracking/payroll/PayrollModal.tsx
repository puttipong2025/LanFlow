import { useCallback, useEffect, useRef, useState } from "react";
import { ModalShell } from "@/components/shared/ModalShell";
import { authFetch } from "@/lib/auth-fetch";
import { formatBangkokDateTime } from "@/lib/bangkok-date";
import { cn } from "@/lib/cn";
import { formatPayrollCurrency } from "@/lib/time-tracking/format";
import type { Location } from "@/types";
import { ExpenseLocationChangeModal } from "../ExpenseLocationChangeModal";
import { SlipPreviewModal } from "../SlipPreviewModal";
import { monthLabel } from "../display";
import { bangkokToday, paymentScopeReason, paymentSourceLabel, reportLockReason, TIME_TRACKING_OFFLINE_MESSAGE } from "../policy";

export function PayrollModal({ user, online, canDecide, expenseLocations, globalManager, onApprove, onReject, onChangePayment, onClose, onRefresh }: { user: any, online: boolean, canDecide: boolean, expenseLocations: Location[], globalManager: boolean, onApprove?: (slip: any, refreshOwner: () => Promise<void>) => Promise<boolean>, onReject?: (slip: any, refreshOwner: () => Promise<void>) => Promise<boolean>, onChangePayment: (slip: any, refreshOwner: () => Promise<void>) => void, onClose: () => void, onRefresh: () => Promise<void> }) {
  const missingPayrollMonths = Array.isArray(user.missing_payroll_months) ? user.missing_payroll_months : [];
  const [pendingCreatePayment, setPendingCreatePayment] = useState<{ month: string; netPay: number } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [slips, setSlips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [createMonth, setCreateMonth] = useState(missingPayrollMonths[0] ?? bangkokToday().slice(0, 7));
  const [previewSlipId, setPreviewSlipId] = useState<string | null>(null);
  const loadSlipsRequestIdRef = useRef(0);
  const createSubmitRef = useRef<HTMLButtonElement>(null);

  const loadSlips = useCallback(async () => {
    const requestId = ++loadSlipsRequestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await authFetch("/api/lanflow/time-tracking/admin", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'LIST_PAYROLL_SLIPS', payload: { user_id: user.id } })
      });
      if (!res.ok) throw new Error("โหลดสลิปเงินเดือนไม่สำเร็จ");
      const json = await res.json();
      if (requestId !== loadSlipsRequestIdRef.current) return;
      setSlips(json.slips || []);
    } catch (error) {
      if (requestId !== loadSlipsRequestIdRef.current) return;
      console.error("Failed to load payroll slips:", error);
      setLoadError("โหลดสลิปเงินเดือนไม่สำเร็จ");
    } finally {
      if (requestId === loadSlipsRequestIdRef.current) setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void loadSlips();
    return () => {
      loadSlipsRequestIdRef.current += 1;
    };
  }, [loadSlips]);

  async function runSlipDecision(action: () => Promise<boolean>) {
    setSaving(true);
    try {
      await action();
    } finally {
      setSaving(false);
    }
  }

  function openCreateSlip() {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    setCreateMonth(missingPayrollMonths[0] ?? bangkokToday().slice(0, 7));
    setCreateError(null);
    setCreateFormOpen(true);
  }

  async function createSlip() {
    if (!createMonth) return;
    setSaving(true);
    setCreateError(null);
    try {
      const response = await authFetch("/api/lanflow/time-tracking/admin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "PREVIEW_PAYROLL_SLIP", payload: { user_id: user.id, month: createMonth } }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "ตรวจยอดสลิปไม่สำเร็จ");
      const netPay = Number(json.preview?.netPay);
      if (!Number.isFinite(netPay) || netPay < 0) throw new Error("ตรวจยอดสลิปไม่สำเร็จ");
      if (netPay > 0) setPendingCreatePayment({ month: createMonth, netPay });
      else await submitCreateSlip(createMonth, netPay, null, "");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "ตรวจยอดสลิปไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function submitCreateSlip(month: string, expectedNetPay: number, locationId: string | null, comment: string) {
    const res = await authFetch("/api/lanflow/time-tracking/admin", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CREATE_PAYROLL_SLIP',
          payload: { user_id: user.id, month, expense_location_id: locationId, admin_comment: comment, expected_net_pay: expectedNetPay },
        })
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      throw new Error(json?.error || "สร้างสลิปเงินเดือนไม่สำเร็จ");
    }
    setPendingCreatePayment(null);
    setCreateFormOpen(false);
    await loadSlips();
    await onRefresh();
    return true;
  }

  function closeCreatePayment() {
    setPendingCreatePayment(null);
    window.requestAnimationFrame(() => createSubmitRef.current?.focus());
  }

  async function deleteSlip(slipId: string, month: string) {
    const slip = slips.find((item: any) => item.id === slipId);
    const lockReason = reportLockReason(slip ?? {});
    if (lockReason) {
      alert(lockReason);
      return;
    }
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    if (!confirm(`ยืนยันการลบสลิปเดือน ${month} หรือไม่? รายการจะถูกลบถาวร`)) return;
    setSaving(true);
    try {
      const res = await authFetch("/api/lanflow/time-tracking/admin", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'DELETE_PAYROLL_SLIP', payload: { slip_id: slipId } })
      });
      if (res.ok) {
        await loadSlips();
        await onRefresh();
      } else {
        const json = await res.json();
        alert(json.error || "เกิดข้อผิดพลาด");
      }
    } catch (e) {
      console.error(e);
      alert("เกิดข้อผิดพลาด");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <ModalShell
        title={`สลิปเงินเดือนของ ${user.name}`}
        onClose={onClose}
        nativeModal
        closeOnEscape
        closeDisabled={saving}
        size="wide"
      >
        <div className="space-y-4 p-3 sm:p-4" aria-busy={loading || saving}>
          {missingPayrollMonths.length > 0 && (
            <section className="rounded-lg border border-clay/20 bg-clay/5 p-3">
              <h3 className="text-balance text-sm font-bold text-clay">เดือนที่ยังไม่มีสลิป</h3>
              <p className="mt-1 text-pretty text-sm text-ink/70">{missingPayrollMonths.map(monthLabel).join(", ")}</p>
            </section>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={openCreateSlip}
              disabled={saving || loading || !online}
              title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE}
              className="focus-ring bg-leaf text-white px-4 py-2 rounded-lg font-bold shadow-sm hover:bg-leaf/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              สร้างสลิปเงินเดือน
            </button>
          </div>
          {loading ? (
             <div>กำลังโหลดข้อมูล...</div>
          ) : loadError ? (
             <div role="alert" className="rounded-lg border border-danger/25 bg-danger/5 p-3 text-sm font-semibold text-danger">
               <p>{loadError}</p>
               <button type="button" onClick={() => void loadSlips()} className="focus-ring mt-3 rounded-md bg-river px-3 py-2 text-white">โหลดอีกครั้ง</button>
             </div>
          ) : slips.length === 0 ? (
             <div className="text-ink/50">ไม่มีประวัติการทำสลิปเงินเดือน</div>
          ) : (
             <ul className="divide-y divide-black/5 bg-white border border-black/10 rounded-xl overflow-hidden shadow-sm">
                {slips.map((slip: any) => {
                   const cancelled = Boolean(slip.cancelled_at);
                   const canDelete = !cancelled;

                 return (
                  <li key={slip.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex flex-col">
                      <span className="font-bold text-lg">สลิปเดือน {slip.month}</span>
                      <div className="text-sm text-ink/70 flex gap-4 mt-1">
                        <span>ค่าแรง: <strong className="tabular-nums text-ink">{formatPayrollCurrency(slip.gross_pay)}</strong></span>
                        <span>หักหนี้/เบิก: <strong className="tabular-nums text-clay">{formatPayrollCurrency(slip.total_deductions)}</strong></span>
                        <span>ยอดสุทธิ: <strong className={cn('tabular-nums', slip.net_pay < 0 ? 'text-clay' : 'text-leaf')}>{formatPayrollCurrency(slip.net_pay)}</strong></span>
                      </div>

                       <span className="text-xs text-ink/50 mt-1">สร้างเมื่อ: {formatBangkokDateTime(slip.created_at)}</span>
                       {Number(slip.net_pay) <= 0 && <span className="text-xs text-ink/55 mt-1">อนุมัติได้ แต่จะไม่สร้างค่าใช้จ่าย</span>}
                       {slip.admin_comment && <span className="text-xs text-river mt-1">หมายเหตุ: {slip.admin_comment}</span>}
                      {slip.approver?.name && <span className="text-xs text-leaf mt-1">ผู้ทำรายการ: {slip.approver.name}</span>}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded-md ${!cancelled && slip.status === 'APPROVED' ? 'bg-success/15 text-success' : 'bg-ink/10 text-ink'}`}>
                        {cancelled ? 'ยกเลิก' : slip.status}
                      </span>

                      {!cancelled && (slip.status === 'PENDING' || slip.status === 'APPROVED') && (
                        <button
                          type="button"
                          onClick={() => setPreviewSlipId(slip.id)}
                          disabled={!online}
                          title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE}
                          className="focus-ring rounded-md bg-river px-3 py-1.5 text-sm font-semibold text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          ดูสลิป
                        </button>
                      )}

                        {!cancelled && canDecide && slip.status === 'PENDING' && onApprove && (
                         <button onClick={() => void runSlipDecision(() => onApprove(slip, loadSlips))} disabled={saving || loading || !online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="bg-success text-white px-3 py-1.5 rounded-md text-sm font-bold hover:bg-success/85 disabled:cursor-not-allowed disabled:opacity-50">อนุมัติ</button>
                       )}
                       {!cancelled && slip.status === 'APPROVED' && Number(slip.net_pay) > 0 && (
                          <div className="flex min-w-0 flex-col items-start gap-1">
                            <span className="text-pretty text-xs font-semibold text-ink/70">{paymentSourceLabel(slip)}</span>
                            <button onClick={() => onChangePayment(slip, loadSlips)} disabled={saving || loading || !online || Boolean(slip.report_lock_no) || Boolean(paymentScopeReason(slip, globalManager, expenseLocations))} title={reportLockReason(slip) ?? paymentScopeReason(slip, globalManager, expenseLocations) ?? undefined} className="bg-river text-white px-3 py-1.5 rounded-md text-sm font-bold hover:bg-river/85 disabled:opacity-40">เปลี่ยนวิธีจ่าย</button>
                          </div>
                       )}
                        {!cancelled && canDecide && slip.status === 'PENDING' && onReject && (
                          <button onClick={() => void runSlipDecision(() => onReject(slip, loadSlips))} disabled={saving || loading || !online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="bg-danger text-white px-3 py-1.5 rounded-md text-sm font-bold hover:bg-danger/85 disabled:cursor-not-allowed disabled:opacity-50">ปฏิเสธ</button>
                       )}

                      {canDelete && (
                        <button onClick={() => deleteSlip(slip.id, slip.month)} disabled={saving || !online || Boolean(slip.report_lock_no) || Boolean(paymentScopeReason(slip, globalManager, expenseLocations))} title={reportLockReason(slip) ?? paymentScopeReason(slip, globalManager, expenseLocations) ?? (online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE)} className="rounded-md bg-danger px-3 py-1.5 text-sm font-semibold text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-40">
                          {slip.status === 'APPROVED' && Number(slip.net_pay) > 0 ? 'ยกเลิกค่าใช้จ่าย' : 'ลบสลิป'}
                        </button>
                      )}
                    </div>
                  </li>
                 );
               })}
             </ul>
          )}
        </div>
      </ModalShell>
      {createFormOpen && (
        <ModalShell
          title="สร้างสลิปเงินเดือน"
          subtitle="ระบบจะตรวจเดือนทำงานเก่าสุด รายการรออนุมัติ และปิดเดือนนี้ทันทีหลังสร้างสลิป"
          onClose={() => setCreateFormOpen(false)}
          nativeModal
          closeOnEscape
          closeDisabled={saving}
          size="compact"
        >
          <form onSubmit={(event) => { event.preventDefault(); void createSlip(); }}>
            <label htmlFor="payroll-slip-month" className="block text-sm font-semibold text-ink">เดือน</label>
            <input
              id="payroll-slip-month"
              type="month"
              value={createMonth}
              max={bangkokToday().slice(0, 7)}
              onChange={(event) => setCreateMonth(event.target.value)}
              className="mt-2 w-full rounded-md border border-black/15 px-3 py-2"
              required
            />
            {createError && <p role="alert" className="mt-3 text-pretty text-sm font-semibold text-danger">{createError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setCreateFormOpen(false)} disabled={saving} className="rounded-md bg-actionSecondary px-4 py-2 font-semibold text-white disabled:opacity-50">ยกเลิก</button>
              <button ref={createSubmitRef} type="submit" disabled={saving || !createMonth} className="rounded-md bg-success px-4 py-2 font-bold text-white disabled:opacity-50">ยืนยันสร้างสลิป</button>
            </div>
          </form>
        </ModalShell>
      )}
      {previewSlipId && (
        <SlipPreviewModal
          sourceType="payroll"
          sourceId={previewSlipId}
          online={online}
          onClose={() => setPreviewSlipId(null)}
        />
      )}
      {pendingCreatePayment && (
        <ExpenseLocationChangeModal
          mode="create"
          locations={expenseLocations}
          paymentAmount={pendingCreatePayment.netPay}
          amountLabel={`ยอดสุทธิเดือน ${pendingCreatePayment.month} ของ ${user.name}`}
          primaryLocationId={user.primary_location_id}
          onClose={closeCreatePayment}
          onSubmit={(locationId, comment) => submitCreateSlip(pendingCreatePayment.month, pendingCreatePayment.netPay, locationId, comment)}
        />
      )}
    </>
  )
}
