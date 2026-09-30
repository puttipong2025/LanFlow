import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UserCircle } from "lucide-react";
import { ACTIONABLE_BADGES_QUERY_KEY } from "@/hooks/useActionableBadges";
import { useInputDialog } from "@/hooks/useInputDialog";
import { authFetch } from "@/lib/auth-fetch";
import { canManageSystemFeatures, canManageTimePayroll } from "@/lib/permissions";
import type { AttendanceMonthDto, PayrollPeriodStateDto } from "@/lib/time-tracking/attendance-contract";
import type { Location, Profile } from "@/types";
import { AttendanceCalendar } from "../attendance/AttendanceCalendar";
import { AttendancePeriodControls } from "../periods/AttendancePeriodControls";
import type { ApprovalType } from "../contracts";
import { EmployeeDialogs } from "./EmployeeDialogs";
import { EmployeeFinancialSummary } from "./EmployeeFinancialSummary";
import { EmployeeSlipList } from "./EmployeeSlipList";
import { EmployeeTransactionHistory } from "./EmployeeTransactionHistory";
import { createEmployeeAttendanceActions } from "./employee-attendance-actions";
import { bangkokToday, paymentScopeReason, reportLockReason, TIME_TRACKING_OFFLINE_MESSAGE } from "../policy";

export function EmployeeWorkspace({ profile, targetUserId, targetPrimaryLocationId, online, expenseLocations = [], hideHeading = false, allowManagerActions, canDecide, canConfigure, onApprove, onReject }: { profile: Profile, targetUserId?: string, targetPrimaryLocationId?: string | null, online: boolean, expenseLocations?: Location[], hideHeading?: boolean, allowManagerActions?: boolean, canDecide?: boolean, canConfigure?: boolean, onApprove?: (type: ApprovalType, item: any, refreshOwner: () => Promise<void>) => Promise<boolean>, onReject?: (type: ApprovalType, item: any, refreshOwner: () => Promise<void>) => Promise<boolean> }) {
  const queryClient = useQueryClient();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingExpenseLocationTx, setPendingExpenseLocationTx] = useState<any>(null);
  const [pendingWithdrawal, setPendingWithdrawal] = useState<{ amount: number; effectiveDate: string } | null>(null);
  const [adjustingWithdrawal, setAdjustingWithdrawal] = useState<any>(null);
  const [previewSource, setPreviewSource] = useState<{ type: "withdrawal" | "payroll"; id: string } | null>(null);
  const { requestInput, inputDialog } = useInputDialog();
  const loadRequestIdRef = useRef(0);

  // Debt Modal State
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false);
  const [debtDueDate, setDebtDueDate] = useState(bangkokToday());
  const [debtDescription, setDebtDescription] = useState("");
  const [debtAmount, setDebtAmount] = useState("");
  const [attendanceMonth, setAttendanceMonth] = useState(bangkokToday().slice(0, 7));

  const managedUserId = targetUserId || profile.id;
  const isSelf = managedUserId === profile.id;
  const canManageTime = allowManagerActions ?? canManageTimePayroll(profile);
  const canDecideItems = canDecide ?? canManageTime;
  const globalManager = canManageSystemFeatures(profile);
  const withdrawalActionText = isSelf ? "ขอเบิกเงินตนเอง" : "ขอเบิกเงินแทน";

  const loadData = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const search = new URLSearchParams({ month: attendanceMonth });
      if (targetUserId) search.set("userId", targetUserId);
      const url = `/api/lanflow/time-tracking/user?${search.toString()}`;
      const res = await authFetch(url);
      if (!res.ok) throw new Error("โหลดข้อมูลเวลาและเงินเดือนไม่สำเร็จ");
      const json = await res.json();
      if (requestId !== loadRequestIdRef.current) return;
      setData(json);
    } catch (err) {
      if (requestId !== loadRequestIdRef.current) return;
      console.error("Failed to load user time tracking:", err);
      setLoadError("โหลดข้อมูลเวลาและเงินเดือนไม่สำเร็จ");
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }, [attendanceMonth, targetUserId]);

  useEffect(() => {
    void loadData();
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [loadData]);

  useEffect(() => {
    const refreshVisibleData = () => {
      if (document.visibilityState === "visible") void loadData();
    };
    window.addEventListener("focus", refreshVisibleData);
    document.addEventListener("visibilitychange", refreshVisibleData);
    return () => {
      window.removeEventListener("focus", refreshVisibleData);
      document.removeEventListener("visibilitychange", refreshVisibleData);
    };
  }, [loadData]);

  async function handleDeleteTransaction(tx: any) {
    const lockReason = reportLockReason(tx) || paymentScopeReason(tx, globalManager, expenseLocations);
    if (lockReason) {
      alert(lockReason);
      return;
    }
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    if (!confirm(`คุณต้องการลบรายการ ${tx.type === 'DEBT' ? 'สร้างหนี้สิน' : 'เบิกเงิน'} จำนวน ${tx.amount} ใช่หรือไม่?`)) return;

    setSaving(true);
    try {
      const res = await authFetch(
        canManageTime ? "/api/lanflow/time-tracking/admin" : "/api/lanflow/time-tracking/user",
        {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DELETE_TRANSACTION", payload: { transaction_id: tx.id } })
        },
      );
      if (!res.ok) {
         const json = await res.json();
         alert(json.error || "ไม่สามารถลบรายการได้");
      } else {
         alert("ลบรายการสำเร็จ");
         await loadData();
         await queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] });
      }
    } catch (e) {
      alert("เกิดข้อผิดพลาด");
    } finally {
      setSaving(false);
    }
  }

  async function runApprovalAction(action: () => Promise<boolean>) {
    setSaving(true);
    try {
      await action();
    } finally {
      setSaving(false);
    }
  }

  async function changeWithdrawalExpenseLocation(tx: any) {
    const lockReason = reportLockReason(tx) || paymentScopeReason(tx, globalManager, expenseLocations);
    if (lockReason) {
      alert(lockReason);
      return;
    }
    if (!online) return;
    setPendingExpenseLocationTx(tx);
  }

  async function submitWithdrawalExpenseLocation(expenseLocationId: string | null, adminComment: string) {
    if (!pendingExpenseLocationTx) return false;
    setSaving(true);
    try {
      const res = await authFetch('/api/lanflow/time-tracking/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CHANGE_EXPENSE_LOCATION',
          payload: {
            source_type: 'transaction',
            source_id: pendingExpenseLocationTx.id,
            expense_location_id: expenseLocationId,
            admin_comment: adminComment,
          },
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'ไม่สามารถเปลี่ยนสาขาค่าใช้จ่ายได้');
      }
      setPendingExpenseLocationTx(null);
      await loadData();
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function createWithdrawal(amount: number, effectiveDate: string | null, locationId: string | null = null, comment = "") {
    const response = await authFetch(canManageTime ? "/api/lanflow/time-tracking/admin" : "/api/lanflow/time-tracking/user", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: canManageTime ? "ADMIN_REQUEST_WITHDRAWAL" : "REQUEST_WITHDRAWAL",
        payload: canManageTime
          ? { user_id: managedUserId, amount, effective_date: effectiveDate, expense_location_id: locationId, admin_comment: comment }
          : { amount },
      }),
    });
    if (!response.ok) {
      const json = await response.json().catch(() => null);
      throw new Error(json?.error || "ไม่สามารถสร้างรายการเบิกได้");
    }
    setPendingWithdrawal(null);
    await loadData();
    await queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] });
    return true;
  }

  async function submitWithdrawalAdjustment(value: { targetAmount: number; locationId: string | null; reason: string }) {
    if (!adjustingWithdrawal) return false;
    const response = await authFetch(
      canManageTime ? "/api/lanflow/time-tracking/admin" : "/api/lanflow/time-tracking/user",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: canManageTime ? "ADMIN_REQUEST_WITHDRAWAL_ADJUSTMENT" : "REQUEST_WITHDRAWAL_ADJUSTMENT",
          payload: {
            withdrawal_id: adjustingWithdrawal.id,
            target_amount: value.targetAmount,
            ...(canManageTime ? { expense_location_id: value.locationId } : {}),
            reason: value.reason,
          },
        }),
      },
    );
    if (!response.ok) {
      const json = await response.json().catch(() => null);
      throw new Error(json?.error || "ไม่สามารถปรับยอดเบิกเงินได้");
    }
    setAdjustingWithdrawal(null);
    await loadData();
    await queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] });
    return true;
  }

  async function withdrawAdjustment(adjustmentId: string) {
    if (!online || saving) return;
    if (!confirm("ถอนคำขอปรับยอดเบิกเงินนี้ใช่หรือไม่?")) return;
    setSaving(true);
    try {
      const response = await authFetch("/api/lanflow/time-tracking/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "WITHDRAW_WITHDRAWAL_ADJUSTMENT", payload: { adjustment_id: adjustmentId } }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error || "ถอนคำขอไม่สำเร็จ");
      }
      await loadData();
      await queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] });
    } catch (error) {
      alert(error instanceof Error ? error.message : "ถอนคำขอไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  const attendance = data?.attendance as AttendanceMonthDto | undefined;
  const periodState = data?.periodState as PayrollPeriodStateDto | undefined;
  const {
    replaceAttendanceExceptions,
    setPayrollPeriod,
    cancelPayrollPeriodSchedule,
    correctPayrollPeriodStart,
  } = createEmployeeAttendanceActions({
    online,
    canConfigure: Boolean(canConfigure),
    attendance,
    managedUserId,
    setSaving,
    loadData,
  });

  if (loading && !data) return (
    <div role="status" aria-label="กำลังโหลดข้อมูล..." aria-busy="true" className="space-y-5 p-1">
      <p className="text-pretty text-sm font-semibold text-ink/65">กำลังโหลดข้อมูล...</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-hidden="true">
        <div className="h-28 animate-pulse rounded-xl bg-mint/60 motion-reduce:animate-none" />
        <div className="h-28 animate-pulse rounded-xl bg-mint/60 motion-reduce:animate-none" />
      </div>
      <div className="h-28 animate-pulse rounded-xl bg-mint/45 motion-reduce:animate-none" aria-hidden="true" />
      <div className="h-24 animate-pulse rounded-xl bg-mint/45 motion-reduce:animate-none" aria-hidden="true" />
    </div>
  );

  if (loadError) return (
    <div role="alert" className="rounded-xl border border-danger/25 bg-danger/5 p-4">
      <p className="text-pretty text-sm font-semibold text-danger">{loadError}</p>
      <button type="button" onClick={() => void loadData()} className="focus-ring mt-3 rounded-lg bg-river px-4 py-2 text-sm font-semibold text-white hover:bg-river/90">
        โหลดอีกครั้ง
      </button>
    </div>
  );

  const debtTransactions = data?.transactions?.filter((t: any) => (
    (canManageTime || t.status !== 'REJECTED')
    && (t.type === 'DEBT' || t.type === 'WITHDRAWAL')
  )) || [];
  const adjustmentSummaryByWithdrawal = new Map(
    (data?.adjustmentSummaries || []).map((item: any) => [item.withdrawalId, item]),
  );
  const adjustmentsByWithdrawal = new Map<string, any[]>();
  for (const adjustment of data?.adjustments || []) {
    const rows = adjustmentsByWithdrawal.get(adjustment.parent_debt_id) || [];
    rows.push(adjustment);
    adjustmentsByWithdrawal.set(adjustment.parent_debt_id, rows);
  }
  return (
    <div
      className={`flex flex-col gap-6 p-4 ${targetUserId ? 'bg-mint/35 rounded-2xl border border-black/5 shadow-inner' : ''}`}
      aria-busy={saving}
    >
      {!hideHeading && (
        <h2 className="flex items-center gap-2 text-balance text-xl font-bold text-ink">
          <UserCircle /> {targetUserId ? "ข้อมูลของพนักงาน" : "ระบบเวลาและเงินเดือน (ของตนเอง)"}
        </h2>
      )}
      <EmployeeFinancialSummary
        data={data}
        managed={Boolean(targetUserId)}
        canManageTime={canManageTime}
        online={online}
        onOpenDebt={() => setIsDebtModalOpen(true)}
      />

      {attendance && canConfigure && targetUserId && periodState && (
        <AttendancePeriodControls
          userName={data?.profile?.name || data?.user?.name || "พนักงาน"}
          periodState={periodState}
          workdayEndTime={attendance.workdayEndTime}
          online={online}
          saving={saving}
          onAction={setPayrollPeriod}
          onCancel={cancelPayrollPeriodSchedule}
          onCorrectPeriodStart={correctPayrollPeriodStart}
        />
      )}
      {attendance && (
        <AttendanceCalendar
          attendance={attendance}
          month={attendanceMonth}
          editable={canManageTime}
          saving={saving || loading || attendance.month !== attendanceMonth}
          disabledReason={!online ? TIME_TRACKING_OFFLINE_MESSAGE : undefined}
          onMonthChange={setAttendanceMonth}
          onSave={replaceAttendanceExceptions}
        />
      )}

      <div className="flex gap-4">
        <button
          onClick={async () => {
            if (!online) {
              alert(TIME_TRACKING_OFFLINE_MESSAGE);
              return;
            }
            const amount = await requestInput({
              title: withdrawalActionText,
              label: "ยอดเงินที่ต้องการเบิก (บาท)",
              inputType: "number",
              required: true,
              min: 0.01,
              step: 0.01,
            });
            if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return;
            const effectiveDate = canManageTime
              ? await requestInput({
                  title: "เลือกวันที่รายการ",
                  label: "วันที่เบิก (ห้ามเกินวันนี้ และเดือนต้องยังไม่มีสลิป)",
                  inputType: "date",
                  initialValue: bangkokToday(),
                  required: true,
                  max: bangkokToday(),
                })
              : null;
            if (canManageTime && !effectiveDate) return;

            if (canManageTime && effectiveDate) {
              setPendingWithdrawal({ amount: Number(amount), effectiveDate });
              return;
            }
            setSaving(true);
            try {
              await createWithdrawal(Number(amount), null);
            } catch (error) {
              alert(error instanceof Error ? error.message : "ไม่สามารถสร้างรายการเบิกได้");
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving || !online}
          title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE}
          className="bg-amber px-4 py-2 rounded-md font-semibold text-white hover:bg-amber/80 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {withdrawalActionText}
        </button>
      </div>

      <EmployeeTransactionHistory
        data={data}
        transactions={debtTransactions}
        adjustmentSummaryByWithdrawal={adjustmentSummaryByWithdrawal}
        adjustmentsByWithdrawal={adjustmentsByWithdrawal}
        online={online}
        saving={saving}
        canDecideItems={canDecideItems}
        canManageTime={canManageTime}
        isSelf={isSelf}
        globalManager={globalManager}
        expenseLocations={expenseLocations}
        onApprove={onApprove}
        onReject={onReject}
        loadData={loadData}
        runApprovalAction={runApprovalAction}
        onPreview={(source) => setPreviewSource(source)}
        onChangePayment={changeWithdrawalExpenseLocation}
        onAdjust={setAdjustingWithdrawal}
        onDelete={handleDeleteTransaction}
        onWithdrawAdjustment={withdrawAdjustment}
      />

      <EmployeeSlipList
        slips={data?.slips}
        online={online}
        onPreview={(id) => setPreviewSource({ type: "payroll", id })}
      />

      <EmployeeDialogs
        isDebtModalOpen={isDebtModalOpen}
        onCloseDebt={() => setIsDebtModalOpen(false)}
        saving={saving}
        setSaving={setSaving}
        debtDueDate={debtDueDate}
        setDebtDueDate={setDebtDueDate}
        debtDescription={debtDescription}
        setDebtDescription={setDebtDescription}
        debtAmount={debtAmount}
        setDebtAmount={setDebtAmount}
        online={online}
        managedUserId={managedUserId}
        loadData={loadData}
        pendingWithdrawal={pendingWithdrawal}
        setPendingWithdrawal={setPendingWithdrawal}
        expenseLocations={expenseLocations}
        primaryLocationId={targetPrimaryLocationId ?? profile.primaryLocationId}
        createWithdrawal={createWithdrawal}
        pendingExpenseLocationTx={pendingExpenseLocationTx}
        setPendingExpenseLocationTx={setPendingExpenseLocationTx}
        submitWithdrawalExpenseLocation={submitWithdrawalExpenseLocation}
        adjustingWithdrawal={adjustingWithdrawal}
        setAdjustingWithdrawal={setAdjustingWithdrawal}
        adjustmentSummaryByWithdrawal={adjustmentSummaryByWithdrawal}
        canManageTime={canManageTime}
        submitWithdrawalAdjustment={submitWithdrawalAdjustment}
        previewSource={previewSource}
        setPreviewSource={setPreviewSource}
        inputDialog={inputDialog}
      />
    </div>
  );
}
