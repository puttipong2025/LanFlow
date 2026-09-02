"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Clock, UserCircle, XCircle } from "lucide-react";
import { ACTIONABLE_BADGES_QUERY_KEY } from "@/hooks/useActionableBadges";
import { formatCurrency } from "@/lib/format";
import {
  formatDailyWage,
  formatDailyWageCurrency,
  formatPayrollCurrency,
} from "@/lib/time-tracking/format";
import { parseDailyWageInput } from "@/lib/time-tracking/wage";
import { authFetch } from "@/lib/auth-fetch";
import { Location, Profile } from "@/types";
import { useInputDialog } from "@/hooks/useInputDialog";
import { ExpenseLocationChangeModal } from "./time-tracking/ExpenseLocationChangeModal";
import { ExpenseLocationApprovalModal } from "./time-tracking/ExpenseLocationApprovalModal";
import { canManageTimePayroll } from "@/lib/permissions";
import { ModalShell } from "@/components/shared/ModalShell";
import { TablePageSizeSelect, TablePagination } from "@/components/shared/TablePagination";
import {
  countPendingItemsForUsers,
  filterTimeTrackingEmployees,
  resolveEmployeeFilter,
} from "@/components/time-tracking/employee-list";
import { cn } from "@/lib/cn";
import { SlipPreviewModal } from "./time-tracking/SlipPreviewModal";
import {
  AttendanceCalendar,
  AttendancePeriodControls,
  formatThaiDate,
  payrollPeriodActionLabel,
  TimePayrollConfigPanel,
} from "./time-tracking/AttendanceControls";
import type {
  AttendanceExceptionDto,
  AttendanceMonthDto,
  PayrollPeriodAction,
  PayrollPeriodStateDto,
  TimePayrollSettingsDto,
} from "@/lib/time-tracking/attendance-contract";
import {
  bangkokDateString,
  formatBangkokDateTime,
} from "@/lib/bangkok-date";

interface TimeTrackingModuleProps {
  profile: Profile;
  online: boolean;
  locations: Location[];
}

const TIME_TRACKING_OFFLINE_MESSAGE = "เวลาและเงินเดือนใช้ได้เมื่อออนไลน์เท่านั้น";
type ApprovalType = 'TRANSACTION' | 'SLIP';

function bangkokToday() {
  return bangkokDateString();
}

function reportLockReason(item: { report_lock_no?: string | null }) {
  return item.report_lock_no
    ? `ล็อกโดยรายงาน ${item.report_lock_no} — ต้องลบรายงานล่าสุดตามลำดับก่อน`
    : null;
}

export function TimeTrackingModule({ profile, online, locations }: TimeTrackingModuleProps) {
  if (canManageTimePayroll(profile)) {
    return <AdminTimeTracking profile={profile} online={online} locations={locations} />;
  }

  return <UserTimeTracking profile={profile} online={online} />;
}

function UserTimeTracking({ profile, targetUserId, targetPrimaryLocationId, online, expenseLocations = [], hideHeading = false, allowManagerActions, canDecide, canConfigure, onApprove, onReject }: { profile: Profile, targetUserId?: string, targetPrimaryLocationId?: string | null, online: boolean, expenseLocations?: Location[], hideHeading?: boolean, allowManagerActions?: boolean, canDecide?: boolean, canConfigure?: boolean, onApprove?: (type: ApprovalType, item: any) => void, onReject?: (type: ApprovalType, item: any) => void }) {
  const queryClient = useQueryClient();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingExpenseLocationTx, setPendingExpenseLocationTx] = useState<any>(null);
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
    const lockReason = reportLockReason(tx);
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
         void queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] });
      }
    } catch (e) {
      alert("เกิดข้อผิดพลาด");
    } finally {
      setSaving(false);
    }
  }

  async function changeWithdrawalExpenseLocation(tx: any) {
    const lockReason = reportLockReason(tx);
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
        alert(json.error || 'ไม่สามารถเปลี่ยนสาขาค่าใช้จ่ายได้');
        return false;
      }
      setPendingExpenseLocationTx(null);
      await loadData();
      return true;
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
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

  const debtTransactions = data?.transactions?.filter((t: any) => t.status !== 'REJECTED' && (t.type === 'DEBT' || t.type === 'WITHDRAWAL')) || [];
  const attendance = data?.attendance as AttendanceMonthDto | undefined;
  const periodState = data?.periodState as PayrollPeriodStateDto | undefined;

  async function replaceAttendanceExceptions(selections: AttendanceExceptionDto[]) {
    if (!online || !attendance) return false;
    setSaving(true);
    try {
      const response = await authFetch("/api/lanflow/time-tracking/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REPLACE_ATTENDANCE_EXCEPTIONS",
          payload: { user_id: managedUserId, month: attendanceMonth, selections },
        }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        alert(json?.error || "บันทึกปฏิทินไม่สำเร็จ");
        return false;
      }
      await loadData();
      return true;
    } catch (error) {
      console.error(error);
      alert("บันทึกปฏิทินไม่สำเร็จ");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function setPayrollPeriod(action: PayrollPeriodAction, effectiveDate: string) {
    if (!online) return TIME_TRACKING_OFFLINE_MESSAGE;
    if (!canConfigure) return "คุณไม่มีสิทธิ์เปลี่ยนช่วงทำงาน";
    setSaving(true);
    try {
      const response = await authFetch("/api/lanflow/time-tracking/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SET_PAYROLL_ACTIVE_PERIOD",
          payload: { user_id: managedUserId, action, effective_date: effectiveDate },
        }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        return json?.error || "บันทึกช่วงทำงานไม่สำเร็จ กรุณาลองใหม่";
      }
      await loadData();
      return null;
    } catch (error) {
      console.error(error);
      return "บันทึกช่วงทำงานไม่สำเร็จ กรุณาลองใหม่";
    } finally {
      setSaving(false);
    }
  }

  async function cancelPayrollPeriodSchedule() {
    if (!online) return TIME_TRACKING_OFFLINE_MESSAGE;
    if (!canConfigure) return "คุณไม่มีสิทธิ์เปลี่ยนช่วงทำงาน";
    setSaving(true);
    try {
      const response = await authFetch("/api/lanflow/time-tracking/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CANCEL_PAYROLL_ACTIVE_PERIOD_SCHEDULE",
          payload: { user_id: managedUserId },
        }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        return json?.error || "ยกเลิกกำหนดการไม่สำเร็จ กรุณาลองใหม่";
      }
      await loadData();
      return null;
    } catch (error) {
      console.error(error);
      return "ยกเลิกกำหนดการไม่สำเร็จ กรุณาลองใหม่";
    } finally {
      setSaving(false);
    }
  }

  async function correctPayrollPeriodStart(periodId: string, startOn: string) {
    if (!online) return TIME_TRACKING_OFFLINE_MESSAGE;
    if (!canConfigure) return "คุณไม่มีสิทธิ์เปลี่ยนช่วงทำงาน";
    setSaving(true);
    try {
      const response = await authFetch("/api/lanflow/time-tracking/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CORRECT_PAYROLL_PERIOD_START",
          payload: { user_id: managedUserId, period_id: periodId, start_on: startOn },
        }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        return json?.error || "แก้วันเริ่มช่วงทำงานไม่สำเร็จ กรุณาลองใหม่";
      }
      await loadData();
      return null;
    } catch (error) {
      console.error(error);
      return "แก้วันเริ่มช่วงทำงานไม่สำเร็จ กรุณาลองใหม่";
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`flex flex-col gap-6 p-4 ${targetUserId ? 'bg-mint/35 rounded-2xl border border-black/5 shadow-inner' : ''}`}>
      {!hideHeading && (
        <h2 className="flex items-center gap-2 text-balance text-xl font-bold text-ink">
          <UserCircle /> {targetUserId ? "ข้อมูลของพนักงาน" : "ระบบเวลาและเงินเดือน (ของตนเอง)"}
        </h2>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white p-4 rounded-xl border border-black/10 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-semibold text-ink/70">สถานะการลงเวลา</h3>
            <span className="mt-2 inline-flex rounded-md bg-river/10 px-2 py-1 text-sm font-bold text-river">วันเต็มอัตโนมัติ</span>
            <p className="mt-3 text-pretty text-sm text-ink/60">ไม่ต้องเริ่มหรือหยุดนับเวลา ระบบคำนวณจากช่วงทำงานและปฏิทิน</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-black/10 shadow-sm flex flex-col justify-between overflow-x-auto">
          <div>
            <h3 className="font-semibold text-ink/70">ยอดเงินคงเหลือ</h3>
            <p className={`text-2xl font-bold mt-2 ${data?.wageInfo?.remainingBalance < 0 ? 'text-clay' : 'text-leaf'}`}>
              {formatCurrency(data?.wageInfo?.remainingBalance || 0)}
            </p>
            <p className="text-xs text-ink/50 mt-1">
              (จำนวนวันทำงาน {data?.wageInfo?.totalDays?.toFixed(2) || 0} วัน)
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-black/5 flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-semibold text-ink/70">ยอดหนี้สินค้างชำระ</h3>
              <p className="text-lg font-bold text-clay mt-1">
                {formatCurrency(data?.wageInfo?.totalDebt || 0)}
              </p>
            </div>

            {targetUserId && canManageTime && (
              <button
                onClick={() => {
                  if (!online) {
                    alert(TIME_TRACKING_OFFLINE_MESSAGE);
                    return;
                  }
                  setIsDebtModalOpen(true);
                }}
                disabled={!online}
                title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE}
                className="w-full rounded-lg bg-clay py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-clay/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                สร้างหนี้สินเพิ่ม
              </button>
            )}
          </div>
        </div>
      </div>

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
          saving={saving}
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
            if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
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

            const endpoint = canManageTime ? "/api/lanflow/time-tracking/admin" : "/api/lanflow/time-tracking/user";
            const action = canManageTime ? "ADMIN_REQUEST_WITHDRAWAL" : "REQUEST_WITHDRAWAL";
            const payload = canManageTime
              ? { user_id: managedUserId, amount: Number(amount), effective_date: effectiveDate }
              : { amount: Number(amount) };

            setSaving(true);
            try {
              const response = await authFetch(endpoint, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, payload })
              });
              if (!response.ok) {
                const json = await response.json().catch(() => null);
                alert(json?.error || "ไม่สามารถสร้างรายการเบิกได้");
                return;
              }
              await loadData();
              void queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] });
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

      <div className="bg-white p-4 rounded-xl border border-clay/30 shadow-sm mt-4">
        <h3 className="font-semibold text-clay mb-4">ประวัติสร้างหนี้สิน/เบิกเงิน</h3>
        {debtTransactions.length === 0 ? (
          <p className="text-sm text-ink/50">ไม่มีประวัติหนี้สิน/เบิกเงิน</p>
        ) : (
          <ul className="divide-y divide-black/5">
             {debtTransactions.map((t: any) => (
                <li key={t.id} className={`py-3 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 border-b border-black/5 last:border-0 ${t.type === 'DEBT' ? 'bg-clay/5 -mx-4 px-4' : t.type === 'WITHDRAWAL' ? 'bg-amber/5 -mx-4 px-4' : ''}`}>
                  <div className="flex flex-col">
                    <span className={t.type === 'DEBT' ? 'text-clay font-bold' : t.type === 'WITHDRAWAL' ? 'text-amber font-bold' : 'text-river font-bold'}>
                      {t.type === 'DEBT' ? 'สร้างหนี้สิน' : t.type === 'WITHDRAWAL' ? 'เบิกเงิน' : 'หักหนี้อัตโนมัติ'}{' '}
                      {formatCurrency(t.amount)}
                    </span>
                    {t.description && <span className="text-sm text-ink/70 mt-1">{t.description}</span>}
                    {t.effective_date && <span className="text-xs text-clay mt-1 font-semibold">วันที่รายการ: {new Date(`${t.effective_date}T00:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}</span>}
                    {t.status === 'APPROVED' && Number(t.remaining_amount || 0) > 0 && (
                      <span className="text-xs text-amber mt-1 font-semibold">ยอดค้างยกไปเดือนถัดไป: {formatCurrency(t.remaining_amount)}</span>
                    )}
                    {data?.deductions
                      ?.filter((deduction: any) => deduction.parent_debt_id === t.id)
                      .map((deduction: any) => (
                        <span key={deduction.id} className="text-xs text-leaf mt-1">
                          หักแล้ว {formatCurrency(deduction.amount)} ในเดือน {deduction.applied_month?.slice(0, 7)}
                        </span>
                      ))}
                    <span className="text-xs text-ink/50 mt-1">วันที่ทำรายการ: {t.created_at ? formatBangkokDateTime(t.created_at) : '-'}</span>
                    {t.status === 'APPROVED' && (
                      <span className="text-xs text-ink/50">วันที่อนุมัติ: {t.updated_at ? formatBangkokDateTime(t.updated_at) : (t.created_at ? formatBangkokDateTime(t.created_at) : '-')}</span>
                    )}
                    {t.type === 'WITHDRAWAL' && t.status === 'APPROVED' && !t.expense_location_id && (
                      <span className="text-xs font-semibold text-river">ส่วนกลางจ่าย (จ่ายนอกระบบ)</span>
                    )}
                    {t.admin_comment?.startsWith("ระบบอัตโนมัติ:") && (
                      <span className="text-xs text-amber mt-1 font-bold">{t.admin_comment}</span>
                    )}
                    {t.admin_comment?.startsWith("ยื่นแทนโดย") && (
                      <span className="text-xs text-river mt-1">{t.admin_comment}</span>
                    )}
                    {t.approver?.name && (
                      <span className="text-xs text-leaf mt-1">ผู้ทำรายการ: {t.approver.name}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <span className={`text-xs font-bold px-2 py-1 rounded-md ${t.status === 'APPROVED' ? 'bg-success/15 text-success' : 'bg-ink/10 text-ink'}`}>{t.status}</span>
                    {t.type === 'WITHDRAWAL' && (t.status === 'PENDING' || t.status === 'APPROVED') && (
                      <button
                        type="button"
                        onClick={() => setPreviewSource({ type: "withdrawal", id: t.id })}
                        disabled={!online}
                        title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE}
                        className="focus-ring rounded-md bg-river px-3 py-1.5 text-sm font-semibold text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        ดูสลิป
                      </button>
                    )}
                    {canDecideItems && t.status === 'PENDING' && onApprove && (
                      <button onClick={() => onApprove('TRANSACTION', t)} disabled={!online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="rounded bg-success px-3 py-1 font-bold text-white hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-50">อนุมัติ</button>
                    )}
                    {canDecideItems && t.status === 'PENDING' && onReject && (
                      <button onClick={() => onReject('TRANSACTION', t)} disabled={!online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="rounded bg-danger px-3 py-1 font-bold text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50">ปฏิเสธ</button>
                    )}
                    {canManageTime && t.type === 'WITHDRAWAL' && t.status === 'APPROVED' && (
                      <button onClick={() => changeWithdrawalExpenseLocation(t)} disabled={saving || !online || Boolean(t.report_lock_no)} title={reportLockReason(t) ?? undefined} className="rounded-md bg-river px-3 py-1 text-sm font-semibold text-white hover:bg-river/90 disabled:opacity-40">เปลี่ยนวิธีจ่าย</button>
                    )}
                    {(canManageTime || (isSelf && t.type === 'WITHDRAWAL' && t.status === 'PENDING')) && (
                      <button onClick={() => handleDeleteTransaction(t)} disabled={saving || !online || Boolean(t.report_lock_no)} title={reportLockReason(t) ?? (online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE)} className="inline-flex h-10 items-center gap-1 rounded-md bg-danger px-2 text-sm font-semibold text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-40">
                        <XCircle size={18} />
                        ลบ
                      </button>
                    )}
                  </div>
                </li>
             ))}
          </ul>
        )}
      </div>

      <div className="bg-white p-4 rounded-xl border border-black/10 shadow-sm">
        <h3 className="font-semibold text-ink/70 mb-4">สลิปเงินเดือน</h3>
        {!data?.slips?.length ? (
          <p className="text-sm text-ink/50">ยังไม่มีสลิปเงินเดือน</p>
        ) : (
          <ul className="divide-y divide-black/5">
            {data.slips.map((slip: any) => (
              <li key={slip.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">เดือน {slip.month} · สุทธิ {formatPayrollCurrency(slip.net_pay)}</p>
                  <p className="text-xs text-ink/55">ขั้นต้น {formatPayrollCurrency(slip.gross_pay)} · หัก {formatPayrollCurrency(slip.total_deductions)} · {slip.status}</p>
                </div>
                {!slip.cancelled_at && (slip.status === 'PENDING' || slip.status === 'APPROVED') && (
                  <button
                    type="button"
                    onClick={() => setPreviewSource({ type: "payroll", id: slip.id })}
                    disabled={!online}
                    title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE}
                    className="focus-ring self-start rounded-md bg-river px-3 py-1.5 text-sm font-semibold text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ดูสลิป
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {isDebtModalOpen && (
        <ModalShell
          title="สร้างหนี้สิน"
          onClose={() => setIsDebtModalOpen(false)}
          nativeModal
          closeOnEscape
          closeDisabled={saving}
          size="compact"
        >
          <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="time-payroll-debt-date" className="block text-sm font-semibold text-ink/70 mb-1">วันที่รายการ</label>
                <input
                  id="time-payroll-debt-date"
                  type="date"
                  value={debtDueDate}
                  onChange={(e) => setDebtDueDate(e.target.value)}
                  max={bangkokToday()}
                  className="w-full p-2 border border-black/20 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="time-payroll-debt-description" className="block text-sm font-semibold text-ink/70 mb-1">รายละเอียด</label>
                <input
                  id="time-payroll-debt-description"
                  type="text"
                  value={debtDescription}
                  onChange={(e) => setDebtDescription(e.target.value)}
                  className="w-full p-2 border border-black/20 rounded-md"
                  placeholder="ค่าสินค้า, ค่ายืม ฯลฯ"
                />
              </div>
              <div>
                <label htmlFor="time-payroll-debt-amount" className="block text-sm font-semibold text-ink/70 mb-1">ยอดเงิน (บาท)</label>
                <input
                  id="time-payroll-debt-amount"
                  type="number"
                  value={debtAmount}
                  onChange={(e) => setDebtAmount(e.target.value)}
                  className="w-full p-2 border border-black/20 rounded-md"
                  placeholder="0.00"
                />
              </div>
            <div className="flex justify-end gap-2 border-t border-black/10 pt-4">
              <button
                type="button"
                onClick={() => setIsDebtModalOpen(false)}
                disabled={saving}
                className="rounded-md bg-actionSecondary px-4 py-2 font-semibold text-white hover:bg-actionSecondary/90"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={saving || !online || !debtAmount || Number(debtAmount) <= 0 || !debtDescription}
                title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE}
                onClick={async () => {
                  if (!online) {
                    alert(TIME_TRACKING_OFFLINE_MESSAGE);
                    return;
                  }
                  if (debtDueDate > bangkokToday()) {
                    alert("วันที่รายการต้องไม่เกินวันปัจจุบัน");
                    return;
                  }

                  setSaving(true);
                  try {
                    const res = await authFetch("/api/lanflow/time-tracking/admin", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "CREATE_DEBT", payload: { user_id: managedUserId, amount: Number(debtAmount), effective_date: debtDueDate, description: debtDescription } })
                    });
                    if (res.ok) {
                      setIsDebtModalOpen(false);
                      setDebtDescription("");
                      setDebtAmount("");
                      await loadData();
                    } else {
                      const json = await res.json();
                      alert(json.error || "Failed to create debt");
                    }
                  } finally {
                    setSaving(false);
                  }
                }}
                className="rounded-md bg-commit px-4 py-2 font-bold text-white hover:bg-commit/90 disabled:opacity-50"
              >
                บันทึก
              </button>
            </div>
          </div>
        </ModalShell>
      )}
      {pendingExpenseLocationTx && (
        <ExpenseLocationChangeModal
          locations={expenseLocations}
          paymentAmount={Number(pendingExpenseLocationTx.amount) || 0}
          amountLabel="ยอดเบิกที่ใช้จ่าย"
          primaryLocationId={targetPrimaryLocationId ?? profile.primaryLocationId}
          currentLocationId={pendingExpenseLocationTx.expense_location_id ?? null}
          onClose={() => setPendingExpenseLocationTx(null)}
          onSubmit={submitWithdrawalExpenseLocation}
        />
      )}
      {previewSource && (
        <SlipPreviewModal
          sourceType={previewSource.type}
          sourceId={previewSource.id}
          online={online}
          onClose={() => setPreviewSource(null)}
        />
      )}
      {inputDialog}
    </div>
  );
}

function AdminTimeTracking({ profile, online, locations }: { profile: Profile, online: boolean, locations: Location[] }) {
  const queryClient = useQueryClient();
  const { requestInput, inputDialog } = useInputDialog();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const adminLoadRequestIdRef = useRef(0);

  const [viewDashboardUserId, setViewDashboardUserId] = useState<string | null>(null);
  const [viewAuditLogsAdminId, setViewAuditLogsAdminId] = useState<string | null>(null);
  const auditLogsTriggerRef = useRef<HTMLSelectElement>(null);
  const [pendingExpenseApproval, setPendingExpenseApproval] = useState<{
    type: 'TRANSACTION' | 'SLIP';
    id: string;
    title: string;
    amount: number;
    primaryLocationId?: string | null;
    onSuccess?: () => void;
  } | null>(null);
  const [pendingPaymentChange, setPendingPaymentChange] = useState<{
    sourceType: 'transaction' | 'payroll_slip';
    sourceId: string;
    paymentAmount: number;
    amountLabel: string;
    primaryLocationId?: string | null;
    currentLocationId?: string | null;
    onSuccess?: () => void;
  } | null>(null);
  const [employeeFilter, setEmployeeFilter] = useState<"pending" | "all" | null>(null);
  const [employeeBranchFilter, setEmployeeBranchFilter] = useState("all");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeePageSize, setEmployeePageSize] = useState(10);
  const [employeePage, setEmployeePage] = useState(1);
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const expenseLocations = useMemo(
    () => data?.paymentLocations ?? locations.filter((location) => location.active),
    [data?.paymentLocations, locations],
  );

  const load = useCallback(async () => {
    const requestId = ++adminLoadRequestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await authFetch("/api/lanflow/time-tracking/admin");
      if (!res.ok) throw new Error("โหลดข้อมูลจัดการเงินเดือนไม่สำเร็จ");
      const json = await res.json();
      if (requestId !== adminLoadRequestIdRef.current) return;
      setData(json);
    } catch (err) {
      if (requestId !== adminLoadRequestIdRef.current) return;
      console.error("Failed to load admin time tracking:", err);
      setLoadError("โหลดข้อมูลจัดการเงินเดือนไม่สำเร็จ");
    } finally {
      if (requestId === adminLoadRequestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      adminLoadRequestIdRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    const refreshVisibleData = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refreshVisibleData);
    document.addEventListener("visibilitychange", refreshVisibleData);
    return () => {
      window.removeEventListener("focus", refreshVisibleData);
      document.removeEventListener("visibilitychange", refreshVisibleData);
    };
  }, [load]);

  const permissions = data?.permissions ?? {};
  const canManage = permissions.canManage ?? canManageTimePayroll(profile);
  const canDecide = permissions.canDecide ?? canManageTimePayroll(profile);
  const canConfigure = permissions.canConfigure ?? canManageTimePayroll(profile);

  async function updateTimePayrollConfig(workdayEndTime: string) {
    setAttendanceSaving(true);
    try {
      const response = await authFetch("/api/lanflow/time-tracking/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "UPDATE_TIME_PAYROLL_CONFIG", payload: { workday_end_time: workdayEndTime } }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        alert(json?.error || "บันทึกการตั้งค่าไม่สำเร็จ");
        return false;
      }
      await load();
      return true;
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      setAttendanceSaving(false);
    }
  }

  async function submitApproval(
    type: ApprovalType,
    id: string,
    status: 'APPROVED' | 'REJECTED',
    expenseLocationId?: string | null,
    providedComment?: string,
  ) {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return false;
    }
    const requestedComment = providedComment === undefined
      ? await requestInput({
          title: "อนุมัติรายการ",
          label: "เหตุผลการอนุมัติ",
          multiline: true,
        })
      : providedComment;
    if (requestedComment === null) return false;
    const comment = requestedComment;
    const res = await authFetch("/api/lanflow/time-tracking/admin", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: type === 'TRANSACTION' ? 'APPROVE_TRANSACTION' : 'APPROVE_PAYROLL_SLIP',
        payload: type === 'TRANSACTION'
          ? { transaction_id: id, status, admin_comment: comment, expense_location_id: expenseLocationId }
          : { slip_id: id, status, admin_comment: comment, expense_location_id: expenseLocationId }
      })
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      alert(json?.error || 'ไม่สามารถบันทึกการอนุมัติได้');
      return false;
    }
    void load();
    void queryClient.invalidateQueries({
      queryKey: [ACTIONABLE_BADGES_QUERY_KEY],
    });
    return true;
  }

  function handleApprove(
    type: ApprovalType,
    id: string,
    expense?: { title: string; amount: number; primaryLocationId?: string | null },
    onSuccess?: () => void,
  ) {
    if (expense) {
      setPendingExpenseApproval({ type: type as 'TRANSACTION' | 'SLIP', id, ...expense, onSuccess });
      return;
    }
    void submitApproval(type, id, 'APPROVED').then((success) => {
      if (success) onSuccess?.();
    });
  }

  async function submitPaymentChange(locationId: string | null, comment: string) {
    if (!pendingPaymentChange) return false;
    const res = await authFetch("/api/lanflow/time-tracking/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "CHANGE_EXPENSE_LOCATION",
        payload: {
          source_type: pendingPaymentChange.sourceType,
          source_id: pendingPaymentChange.sourceId,
          expense_location_id: locationId,
          admin_comment: comment,
        },
      }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      alert(json?.error || "ไม่สามารถเปลี่ยนวิธีจ่ายได้");
      return false;
    }
    const onSuccess = pendingPaymentChange.onSuccess;
    setPendingPaymentChange(null);
    await load();
    onSuccess?.();
    return true;
  }

  const [payrollUser, setPayrollUser] = useState<any>(null);

  function openPayroll(user: any) {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    setPayrollUser(user);
  }

  function closeAuditLogs() {
    setViewAuditLogsAdminId(null);
    window.requestAnimationFrame(() => auditLogsTriggerRef.current?.focus());
  }

  async function editWage(userId: string, currentWage: number) {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    const wageText = await requestInput({
      title: "แก้ไขค่าแรงรายวัน",
      label: "ค่าแรงรายวัน (บาท)",
      initialValue: formatDailyWage(currentWage),
      inputType: "number",
      required: true,
      min: 0,
      step: 0.0001,
    });
    if (wageText === null) return;
    if (parseDailyWageInput(wageText) === null) {
      alert("ค่าแรงต้องเป็น 0 ขึ้นไปและมีทศนิยมไม่เกิน 4 ตำแหน่ง");
      return;
    }

    try {
      const response = await authFetch("/api/lanflow/time-tracking/admin", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'UPDATE_WAGE', payload: { user_id: userId, daily_wage: wageText.trim() } })
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        alert(json?.error || "แก้ไขค่าแรงรายวันไม่สำเร็จ");
        return;
      }
      await load();
    } catch (error) {
      console.error("Failed to update daily wage:", error);
      alert("แก้ไขค่าแรงรายวันไม่สำเร็จ");
    }
  }

  function pendingCountForUser(items: Array<{ profile_id: string }> | undefined, userId: string) {
    return items?.filter((item) => item.profile_id === userId).length || 0;
  }

  if (loading) return <div>กำลังโหลดข้อมูล...</div>;

  if (loadError) return (
    <div role="alert" className="rounded-xl border border-danger/25 bg-danger/5 p-4">
      <p className="text-sm font-semibold text-danger">{loadError}</p>
      <button type="button" onClick={() => void load()} className="focus-ring mt-3 rounded-lg bg-river px-4 py-2 text-sm font-semibold text-white hover:bg-river/90">
        โหลดอีกครั้ง
      </button>
    </div>
  );

  const users = [...(data?.users || [])].sort((left: any, right: any) => {
    if (left.id === profile.id) return -1;
    if (right.id === profile.id) return 1;
    return 0;
  });
  const pendingUserIds = new Set(users.filter((user: any) => (
    pendingCountForUser(data?.pendingTransactions, user.id) + pendingCountForUser(data?.pendingSlips, user.id) > 0
  )).map((user: any) => user.id));
  const activeEmployeeFilter = resolveEmployeeFilter(employeeFilter, pendingUserIds.size > 0);
  const branchUsers = filterTimeTrackingEmployees(users, pendingUserIds, "", "all", employeeBranchFilter);
  const branchUserIds = new Set(branchUsers.map((user: any) => user.id as string));
  const branchPendingCount = countPendingItemsForUsers(data?.pendingTransactions, data?.pendingSlips, branchUserIds);
  const filteredUsers = filterTimeTrackingEmployees(
    users,
    pendingUserIds,
    employeeSearch,
    activeEmployeeFilter,
    employeeBranchFilter,
  );
  const branchLocationIds = new Set(users.map((user: any) => user.primary_location_id).filter(Boolean));
  const branchOptions = (data?.paymentLocations || locations)
    .filter((location: Location) => location.active && branchLocationIds.has(location.id));
  const hasUnassignedUsers = users.some((user: any) => !user.primary_location_id);
  const totalEmployeePages = Math.max(1, Math.ceil(filteredUsers.length / employeePageSize));
  const currentEmployeePage = Math.min(employeePage, totalEmployeePages);
  const visibleUsers = filteredUsers.slice((currentEmployeePage - 1) * employeePageSize, currentEmployeePage * employeePageSize);
  const dashboardUser = users.find((user: any) => user.id === viewDashboardUserId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6 p-4">
         <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
           <h2 className="flex items-center gap-2 text-balance text-xl font-bold text-ink">
             <Clock /> จัดการเวลาและเงินเดือน
           </h2>
         <div className="flex flex-wrap gap-2">
           {data?.settings && (
             <TimePayrollConfigPanel
               settings={data.settings as TimePayrollSettingsDto}
               canConfigure={canConfigure}
               online={online}
               saving={attendanceSaving}
               onSave={updateTimePayrollConfig}
             />
           )}
           {canDecide && data?.admins && data.admins.length > 0 && (
             <select
               ref={auditLogsTriggerRef}
               aria-label="ดูประวัติของแอดมิน"
               className="text-sm bg-ink/5 px-3 py-1.5 rounded-md hover:bg-ink/10 font-semibold border border-black/10 outline-none focus:border-river focus:ring-1 focus:ring-river cursor-pointer"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  setViewAuditLogsAdminId(e.target.value);
                  e.target.value = "";
                }
              }}
            >
              <option value="">ดูประวัติของแอดมิน...</option>
              {data.admins.map((admin: any) => (
                <option key={admin.id} value={admin.id}>
                  ประวัติของ {admin.name}
                </option>
              ))}
            </select>
          )}
        </div>
        </div>

       <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
         <label className="grid gap-1 text-sm font-semibold text-ink">ค้นหาพนักงาน
           <input value={employeeSearch} onChange={(event) => { setEmployeeSearch(event.target.value); setEmployeePage(1); }} className="focus-ring h-10 rounded-md border border-black/15 bg-white px-3" placeholder="ชื่อพนักงาน" />
         </label>
         <div className="flex flex-wrap items-end gap-3">
           <label className="grid gap-1 text-sm font-semibold text-ink">กรองสาขา
             <select value={employeeBranchFilter} onChange={(event) => { setEmployeeBranchFilter(event.target.value); setEmployeePage(1); }} className="focus-ring h-10 rounded-md border border-black/15 bg-white px-3">
               <option value="all">ทุกสาขา</option>
               {branchOptions.map((location: Location) => <option key={location.id} value={location.id}>{location.name}</option>)}
               {hasUnassignedUsers && <option value="unassigned">ไม่มีสาขาหลัก</option>}
             </select>
           </label>
           <div className="flex flex-wrap gap-2" aria-label="กรองตามสถานะ">
             {(["pending", "all"] as const).map((filter) => {
               const selected = activeEmployeeFilter === filter;
               const label = filter === "pending" ? "รออนุมัติ" : "ทั้งหมด";
               const accessibleLabel = filter === "pending" && branchPendingCount > 0
                 ? `${label} ${branchPendingCount} รายการ`
                 : label;
               return (
                 <button
                   key={filter}
                   type="button"
                   aria-pressed={selected}
                   aria-label={accessibleLabel}
                   onClick={() => { setEmployeeFilter(filter); setEmployeePage(1); }}
                   className={cn(
                     "focus-ring inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold",
                     selected
                       ? "border-leaf bg-leaf text-white hover:bg-leaf/90"
                       : "border-black/15 bg-white text-ink hover:bg-field",
                   )}
                 >
                   {label}
                   {filter === "pending" && branchPendingCount > 0 && (
                     <span aria-hidden="true" className="min-w-5 rounded-full bg-clay px-1.5 py-0.5 text-center text-xs font-bold leading-none text-white tabular-nums">
                       {branchPendingCount > 99 ? "99+" : branchPendingCount}
                     </span>
                   )}
                 </button>
               );
             })}
           </div>
           <TablePageSizeSelect pageSize={employeePageSize} onPageSizeChange={(size) => { setEmployeePageSize(size); setEmployeePage(1); }} />
         </div>
       </div>

       <div className="bg-white p-4 rounded-xl border border-black/10 shadow-sm overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-black/10 text-ink/65">
              <th className="pb-3 font-semibold">จัดการ</th>
              <th className="pb-3 font-semibold">พนักงาน</th>
              <th className="pb-3 font-semibold">ค่าแรง/วัน</th>
              <th className="pb-3 font-semibold">สถานะ</th>
              <th className="pb-3 font-semibold">หนี้สิน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
             {visibleUsers.map((user: any) => {
               const isSelf = user.id === profile.id;
                  const periodState = user.period_state as PayrollPeriodStateDto | undefined;
                  const status = periodState?.currentStatus === "ACTIVE" ? 'ACTIVE_PERIOD' : 'INACTIVE_PERIOD';
               const debtRemainingAmount = Number(user.debt_remaining_amount || 0);
               const dashboardPendingCount = pendingCountForUser(data?.pendingTransactions, user.id);
               const payrollPendingCount = pendingCountForUser(data?.pendingSlips, user.id);
               const overviewAction = canManage
                 ? `จัดการปฏิทินวันทำงานของ ${user.name}`
                 : `ดูข้อมูลเวลาและเงินเดือนของ ${user.name}`;
               const overviewLabel = dashboardPendingCount > 0
                 ? `${overviewAction} มีรายการรออนุมัติ ${dashboardPendingCount} รายการ`
                 : overviewAction;
               const payrollLabel = payrollPendingCount > 0
                 ? `จัดการสลิปเงินเดือนของ ${user.name} มีสลิปรออนุมัติ ${payrollPendingCount} รายการ`
                 : `จัดการสลิปเงินเดือนของ ${user.name}`;
               return (
                <tr
                  key={user.id}
                  data-user-id={user.id}
                  data-time-payroll-self={isSelf ? "true" : undefined}
                  className={`hover:bg-sand/30 data-[time-payroll-self=true]:bg-mint/35 ${user.is_active === false ? 'opacity-70 bg-red-50/50' : ''}`}
                >
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (!online) { alert(TIME_TRACKING_OFFLINE_MESSAGE); return; }
                          setViewDashboardUserId(user.id);
                        }}
                        disabled={!online}
                        title={online ? overviewLabel : TIME_TRACKING_OFFLINE_MESSAGE}
                        aria-label={overviewLabel}
                        className="focus-ring relative inline-flex h-10 w-10 items-center justify-center rounded-md bg-river text-lg text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span aria-hidden="true">🗓️</span>
                        {dashboardPendingCount > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-4 rounded-full bg-clay px-1 py-0.5 text-[10px] leading-none text-white">{dashboardPendingCount}</span>}
                      </button>
                      {canConfigure && (
                        <button
                          type="button"
                          onClick={() => editWage(user.id, user.daily_wage || 0)}
                          disabled={!online}
                          title={online ? `แก้ไขค่าแรงรายวันของ ${user.name}` : TIME_TRACKING_OFFLINE_MESSAGE}
                          aria-label={`แก้ไขค่าแรงรายวันของ ${user.name}`}
                          className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md bg-amber text-lg text-white hover:bg-amber/90 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <span aria-hidden="true">✏️</span>
                        </button>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => openPayroll(user)}
                          disabled={!online}
                          title={online ? payrollLabel : TIME_TRACKING_OFFLINE_MESSAGE}
                          aria-label={payrollLabel}
                          className="focus-ring relative inline-flex h-10 w-10 items-center justify-center rounded-md bg-leaf text-lg text-white hover:bg-leaf/80 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span aria-hidden="true">🧾</span>
                          {payrollPendingCount > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-4 rounded-full bg-clay px-1 py-0.5 text-[10px] leading-none text-white">{payrollPendingCount}</span>}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="py-3">
                    {user.name}
                    {isSelf && <span className="ml-2 rounded border border-leaf/20 bg-mint px-1.5 py-0.5 text-xs font-semibold text-leaf">ของตนเอง</span>}
                    {user.is_active === false && <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded border border-red-200">ถูกระงับ</span>}
                  </td>
                  <td className="py-3">
                    <span className="tabular-nums">{formatDailyWageCurrency(user.daily_wage || 0)}</span>
                  </td>
                    <td className="py-3">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${status === 'ACTIVE_PERIOD' ? 'bg-leaf/20 text-leaf' : 'bg-black/10 text-ink/60'}`}>
                        {status === 'ACTIVE_PERIOD' ? 'กำลังคิดค่าแรง' : 'ไม่ได้คิดค่าแรง'}
                      </span>
                      {periodState?.nextAction && (
                        <p className="mt-1 text-pretty text-xs text-amber">
                          กำหนด{payrollPeriodActionLabel(periodState.nextAction.action)} · {formatThaiDate(periodState.nextAction.activationOn)}
                        </p>
                      )}
                   </td>
                  <td className="py-3">
                     <span className="text-clay font-bold">{formatCurrency(debtRemainingAmount)}</span>
                  </td>
                </tr>
              )
            })}
           </tbody>
         </table>
         {filteredUsers.length === 0 && <p className="py-8 text-center text-sm text-ink/55">ไม่พบพนักงานตามตัวกรอง</p>}
       </div>
       <TablePagination totalItems={filteredUsers.length} page={currentEmployeePage} pageSize={employeePageSize} onPageChange={setEmployeePage} />

      {viewDashboardUserId && dashboardUser && (
        <ModalShell
          title={dashboardUser.id === profile.id ? "ข้อมูลของตนเอง" : "ข้อมูลของพนักงาน"}
          subtitle={dashboardUser.name}
          onClose={() => setViewDashboardUserId(null)}
          nativeModal
          closeOnEscape
        >
          <UserTimeTracking
            profile={profile}
            targetUserId={viewDashboardUserId}
            targetPrimaryLocationId={dashboardUser.primary_location_id ?? null}
            online={online}
             expenseLocations={expenseLocations}
             hideHeading
             allowManagerActions={canManage}
             canDecide={canDecide}
             canConfigure={canConfigure}
             onApprove={canDecide ? (type, item) => handleApprove(
               type,
               item.id,
               type === 'TRANSACTION' && item.type === 'WITHDRAWAL'
                 ? { title: dashboardUser.id === profile.id ? "เบิกเงินของตนเอง" : `เบิกเงินของ ${item.profiles?.name || 'พนักงาน'}`, amount: Number(item.amount), primaryLocationId: dashboardUser.primary_location_id ?? null }
                 : undefined,
               () => load(),
             ) : undefined}
             onReject={canDecide ? (type, item) => void submitApproval(type, item.id, 'REJECTED') : undefined}
          />
        </ModalShell>
      )}

      {viewAuditLogsAdminId && (
        <AuditLogsModal
          adminId={viewAuditLogsAdminId}
          adminName={data?.admins?.find((a: any) => a.id === viewAuditLogsAdminId)?.name}
          onClose={closeAuditLogs}
        />
      )}
      {payrollUser && (
        <PayrollModal
          user={payrollUser}
          online={online}
          canDecide={canDecide}
          onApprove={canDecide ? (slip) => handleApprove('SLIP', slip.id, Number(slip.net_pay) > 0 ? { title: `เงินเดือนของ ${payrollUser.name} เดือน ${slip.month}`, amount: Number(slip.net_pay), primaryLocationId: payrollUser.primary_location_id } : undefined, () => load()) : undefined}
          onReject={canDecide ? (slip) => void submitApproval('SLIP', slip.id, 'REJECTED') : undefined}
          onChangePayment={(slip) => setPendingPaymentChange({
            sourceType: 'payroll_slip',
            sourceId: slip.id,
            paymentAmount: Number(slip.net_pay) || 0,
            amountLabel: 'ยอดสุทธิที่ใช้จ่าย',
            primaryLocationId: payrollUser.primary_location_id,
            currentLocationId: slip.expense_location_id ?? null,
          })}
          onClose={() => setPayrollUser(null)}
          onRefresh={() => load()}
        />
      )}
      {pendingExpenseApproval && (
        <ExpenseLocationApprovalModal
          approval={pendingExpenseApproval}
          locations={expenseLocations}
          primaryLocationId={pendingExpenseApproval.primaryLocationId}
          onClose={() => setPendingExpenseApproval(null)}
          onSubmit={async (locationId, comment) => {
            const approval = pendingExpenseApproval;
            const success = await submitApproval(approval.type, approval.id, 'APPROVED', locationId, comment);
            if (success) {
              setPendingExpenseApproval(null);
              approval.onSuccess?.();
            }
            return success;
          }}
        />
      )}
       {pendingPaymentChange && (
        <ExpenseLocationChangeModal
          locations={expenseLocations}
          paymentAmount={pendingPaymentChange.paymentAmount}
          amountLabel={pendingPaymentChange.amountLabel}
          primaryLocationId={pendingPaymentChange.primaryLocationId}
          currentLocationId={pendingPaymentChange.currentLocationId}
          onClose={() => setPendingPaymentChange(null)}
          onSubmit={submitPaymentChange}
        />
       )}
      {inputDialog}
      </div>
    </div>
  );
}

function AuditLogsModal({ adminId, adminName, onClose }: { adminId: string, adminName: string, onClose: () => void }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoadError(null);
      try {
        const res = await authFetch("/api/lanflow/time-tracking/admin", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'GET_AUDIT_LOGS', payload: { admin_user_id: adminId } }),
        });
        if (!res.ok) throw new Error("โหลดประวัติไม่สำเร็จ");
        const json = await res.json();
        if (!active) return;
        setLogs(json.logs || []);
      } catch (error) {
        if (!active) return;
        console.error("Failed to load time/payroll audit logs:", error);
        setLoadError("โหลดประวัติไม่สำเร็จ");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [adminId]);

  return (
    <ModalShell
      title={`ประวัติการกระทำของ Admin: ${adminName}`}
      onClose={onClose}
      nativeModal
      closeOnEscape
      size="wide"
    >
      <div className="p-3 sm:p-4" aria-busy={loading}>
        {loading ? (
           <div>กำลังโหลดข้อมูล...</div>
        ) : loadError ? (
           <div role="alert" className="rounded-lg border border-danger/25 bg-danger/5 p-3 text-sm font-semibold text-danger">{loadError}</div>
        ) : logs.length === 0 ? (
           <div className="text-ink/50">ไม่มีประวัติ</div>
        ) : (
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-black/10 text-ink/65">
                <th className="pb-3 font-semibold">เวลา</th>
                <th className="pb-3 font-semibold">Action</th>
                <th className="pb-3 font-semibold">ข้อมูลเดิม</th>
                <th className="pb-3 font-semibold">ข้อมูลใหม่</th>
                <th className="pb-3 font-semibold">หมายเหตุ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-sand/30">
                  <td className="py-3">{formatBangkokDateTime(log.created_at)}</td>
                  <td className="py-3 font-bold text-river">{log.action}</td>
                  <td className="py-3 text-[11px] text-ink/60 max-w-[150px] truncate" title={JSON.stringify(log.old_data)}>{JSON.stringify(log.old_data) || '-'}</td>
                  <td className="py-3 text-[11px] text-ink/60 max-w-[150px] truncate" title={JSON.stringify(log.new_data)}>{JSON.stringify(log.new_data)}</td>
                  <td className="py-3 text-ink/80 truncate max-w-[150px]" title={log.comment}>{log.comment || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ModalShell>
  )
}

function PayrollModal({ user, online, canDecide, onApprove, onReject, onChangePayment, onClose, onRefresh }: { user: any, online: boolean, canDecide: boolean, onApprove?: (slip: any) => void, onReject?: (slip: any) => void, onChangePayment: (slip: any) => void, onClose: () => void, onRefresh: () => void }) {
  const [slips, setSlips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [createMonth, setCreateMonth] = useState(bangkokToday().slice(0, 7));
  const [previewSlipId, setPreviewSlipId] = useState<string | null>(null);

  const loadSlips = useCallback(async () => {
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
      setSlips(json.slips || []);
    } catch (error) {
      console.error("Failed to load payroll slips:", error);
      setLoadError("โหลดสลิปเงินเดือนไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void loadSlips();
  }, [loadSlips]);

  function openCreateSlip() {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    setCreateMonth(bangkokToday().slice(0, 7));
    setCreateFormOpen(true);
  }

  async function createSlip() {
    if (!createMonth) return;
    setSaving(true);
    try {
      const res = await authFetch("/api/lanflow/time-tracking/admin", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'CREATE_PAYROLL_SLIP',
            payload: { user_id: user.id, month: createMonth },
          })
      });
      if (res.ok) {
        setCreateFormOpen(false);
        alert("สร้างสลิปเงินเดือนสำเร็จ");
        await loadSlips();
        onRefresh();
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
        onRefresh();
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
          <div className="flex justify-end">
            <button
              type="button"
              onClick={openCreateSlip}
              disabled={saving || !online}
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
                  const canDelete = !slip.cancelled_at;

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
                       {slip.status === 'APPROVED' && Number(slip.net_pay) > 0 && !slip.expense_location_id && <span className="text-xs font-semibold text-river mt-1">ส่วนกลางจ่าย (จ่ายนอกระบบ)</span>}
                       {slip.admin_comment && <span className="text-xs text-river mt-1">หมายเหตุ: {slip.admin_comment}</span>}
                      {slip.approver?.name && <span className="text-xs text-leaf mt-1">ผู้ทำรายการ: {slip.approver.name}</span>}
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded-md ${slip.status === 'APPROVED' ? 'bg-success/15 text-success' : 'bg-ink/10 text-ink'}`}>
                        {slip.status}
                      </span>

                      {!slip.cancelled_at && (slip.status === 'PENDING' || slip.status === 'APPROVED') && (
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

                        {canDecide && slip.status === 'PENDING' && onApprove && (
                         <button onClick={() => onApprove(slip)} disabled={!online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="bg-success text-white px-3 py-1.5 rounded-md text-sm font-bold hover:bg-success/85 disabled:cursor-not-allowed disabled:opacity-50">อนุมัติ</button>
                       )}
                       {slip.status === 'APPROVED' && Number(slip.net_pay) > 0 && (
                         <button onClick={() => onChangePayment(slip)} disabled={!online || Boolean(slip.report_lock_no)} title={reportLockReason(slip) ?? undefined} className="bg-river text-white px-3 py-1.5 rounded-md text-sm font-bold hover:bg-river/85 disabled:opacity-40">เปลี่ยนวิธีจ่าย</button>
                       )}
                        {canDecide && slip.status === 'PENDING' && onReject && (
                         <button onClick={() => onReject(slip)} disabled={!online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="bg-danger text-white px-3 py-1.5 rounded-md text-sm font-bold hover:bg-danger/85 disabled:cursor-not-allowed disabled:opacity-50">ปฏิเสธ</button>
                       )}

                      {canDelete && (
                        <button onClick={() => deleteSlip(slip.id, slip.month)} disabled={saving || !online || Boolean(slip.report_lock_no)} title={reportLockReason(slip) ?? (online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE)} className="rounded-md bg-danger px-3 py-1.5 text-sm font-semibold text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-40">
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
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setCreateFormOpen(false)} disabled={saving} className="rounded-md bg-actionSecondary px-4 py-2 font-semibold text-white disabled:opacity-50">ยกเลิก</button>
              <button type="submit" disabled={saving || !createMonth} className="rounded-md bg-success px-4 py-2 font-bold text-white disabled:opacity-50">ยืนยันสร้างสลิป</button>
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
    </>
  )
}
