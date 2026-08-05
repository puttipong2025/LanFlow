"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Clock, UserCircle, PlayCircle, PauseCircle, XCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { ACTIONABLE_BADGES_QUERY_KEY } from "@/hooks/useActionableBadges";
import { formatCurrency } from "@/lib/format";
import { authFetch } from "@/lib/auth-fetch";
import { Location, Profile } from "@/types";
import { useInputDialog } from "@/hooks/useInputDialog";
import { ExpenseLocationChangeModal } from "./time-tracking/ExpenseLocationChangeModal";
import { ExpenseLocationApprovalModal } from "./time-tracking/ExpenseLocationApprovalModal";
import { canManageTimePayroll } from "@/lib/permissions";
import { ModalShell } from "@/components/shared/ModalShell";
import { SlipPreviewModal } from "./time-tracking/SlipPreviewModal";
import {
  bangkokDateString,
  formatBangkokDateTime,
  formatBangkokTime,
  isAtOrAfterBangkokHour,
  nextBangkokCutoff,
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

function UserTimeTracking({ profile, targetUserId, targetPrimaryLocationId, online, expenseLocations = [], hideHeading = false, allowManagerActions, onApprove, onReject }: { profile: Profile, targetUserId?: string, targetPrimaryLocationId?: string | null, online: boolean, expenseLocations?: Location[], hideHeading?: boolean, allowManagerActions?: boolean, onApprove?: (type: ApprovalType, item: any) => void, onReject?: (type: ApprovalType, item: any) => void }) {
  const queryClient = useQueryClient();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [pendingExpenseLocationTx, setPendingExpenseLocationTx] = useState<any>(null);
  const [previewSource, setPreviewSource] = useState<{ type: "withdrawal" | "payroll"; id: string } | null>(null);
  const { requestInput, inputDialog } = useInputDialog();

  // Debt Modal State
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false);
  const [debtDueDate, setDebtDueDate] = useState(bangkokToday());
  const [debtDescription, setDebtDescription] = useState("");
  const [debtAmount, setDebtAmount] = useState("");

  const isRunning = data?.timeTracking?.status === 'RUNNING';
  const startTimeStr = data?.timeTracking?.start_time;
  const resumeSchedule = data?.timeTracking?.resume_schedule;
  const managedUserId = targetUserId || profile.id;
  const isSelf = managedUserId === profile.id;
  const canManageTime = allowManagerActions ?? canManageTimePayroll(profile);
  const withdrawalActionText = isSelf ? "ขอเบิกเงินตนเอง" : "ขอเบิกเงินแทน";

  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      const url = targetUserId ? `/api/lanflow/time-tracking/user?userId=${targetUserId}` : "/api/lanflow/time-tracking/user";
      const res = await authFetch(url);
      if (!res.ok) throw new Error("โหลดข้อมูลเวลาและเงินเดือนไม่สำเร็จ");
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to load user time tracking:", err);
      setLoadError("โหลดข้อมูลเวลาและเงินเดือนไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [targetUserId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!isRunning || !startTimeStr) {
      setTimeLeft(null);
      return;
    }

    const interval = setInterval(async () => {
      const now = new Date();
      const targetDate = nextBangkokCutoff(startTimeStr);

      const diff = targetDate.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft(0);
        clearInterval(interval);
      } else {
        setTimeLeft(Math.floor(diff / 1000));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, startTimeStr]);

  async function toggleRealTimeTracking() {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    if (!isRunning) {
      const now = new Date();
      if (isAtOrAfterBangkokHour(now, 15)) {
        if (!confirm("เลยเวลา 15:00 น. แล้ว\nการเริ่มนับเวลาตอนนี้ จะถูกนับไปรวมกับ 15:00 ของวันพรุ่งนี้\n\nยืนยันการเริ่มนับเวลาหรือไม่?")) {
          return;
        }
      }
    }

    setSaving(true);
    try {
      await authFetch("/api/lanflow/time-tracking/admin", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'TOGGLE_TRACKING',
          payload: { user_id: managedUserId, status: isRunning ? 'PAUSED' : 'RUNNING' },
        })
      });
      await loadData();
    } catch (e) {
      console.error(e);
      alert("เกิดข้อผิดพลาด");
    } finally {
      setSaving(false);
    }
  }

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
      <button type="button" onClick={() => { setLoading(true); void loadData(); }} className="focus-ring mt-3 rounded-lg bg-river px-4 py-2 text-sm font-semibold text-white hover:bg-river/90">
        โหลดอีกครั้ง
      </button>
    </div>
  );

  const debtTransactions = data?.transactions?.filter((t: any) => t.status !== 'REJECTED' && (t.type === 'DEBT' || t.type === 'WITHDRAWAL')) || [];

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
            <h3 className="font-semibold text-ink/70">สถานะเวลาทำงานปัจจุบัน</h3>
            <div className="flex items-center gap-2 mt-2">
              <span className={`px-2 py-1 rounded-md text-sm font-bold flex items-center gap-1 ${isRunning ? 'bg-leaf/20 text-leaf' : 'bg-amber/20 text-amber'}`}>
                {isRunning
                  ? <><PlayCircle size={16} /> กำลังทำงาน</>
                  : resumeSchedule
                    ? <><Clock size={16} /> รอเริ่มอัตโนมัติเดือนใหม่</>
                    : <><PauseCircle size={16} /> หยุดงาน</>}
              </span>
              {isRunning && startTimeStr && (
                <span className="text-xs text-ink/60">เริ่มเมื่อ: {formatBangkokTime(startTimeStr)}</span>
              )}
            </div>

            {isRunning && timeLeft !== null && (
              <div className="font-mono font-bold text-river mt-2 flex items-center gap-2 text-lg">
                ⏱ {Math.floor(timeLeft / 3600).toString().padStart(2, '0')}:
                {Math.floor((timeLeft % 3600) / 60).toString().padStart(2, '0')}:
                {(timeLeft % 60).toString().padStart(2, '0')}
                <span className="text-xs font-normal text-ink/50">(ถึง 15:00)</span>
              </div>
            )}
          </div>

          {canManageTime && <button
            onClick={toggleRealTimeTracking}
            disabled={saving || !online}
            title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE}
            className={`mt-4 w-full py-2 rounded-lg font-bold shadow-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 ${
              isRunning ? 'bg-clay text-white hover:bg-clay/80' : 'bg-leaf text-white hover:bg-leaf/80'
            }`}
          >
            {isRunning ? <><PauseCircle size={18} /> หยุดงาน</> : <><PlayCircle size={18} /> เริ่มนับเวลา</>}
          </button>}
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
            const effectiveDate = await requestInput({
              title: "เลือกวันที่รายการ",
              label: "วันที่เบิก (ห้ามเกินวันนี้ และเดือนต้องยังไม่มีสลิป)",
              inputType: "date",
              initialValue: bangkokToday(),
              required: true,
              max: bangkokToday(),
            });
            if (!effectiveDate) return;

            const endpoint = canManageTime ? "/api/lanflow/time-tracking/admin" : "/api/lanflow/time-tracking/user";
            const action = canManageTime ? "ADMIN_REQUEST_WITHDRAWAL" : "REQUEST_WITHDRAWAL";
            const payload = canManageTime
              ? { user_id: managedUserId, amount: Number(amount), effective_date: effectiveDate }
              : { amount: Number(amount), effective_date: effectiveDate };

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
                    {canManageTime && t.status === 'PENDING' && onApprove && (
                      <button onClick={() => onApprove('TRANSACTION', t)} disabled={!online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="rounded bg-success px-3 py-1 font-bold text-white hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-50">อนุมัติ</button>
                    )}
                    {canManageTime && t.status === 'PENDING' && onReject && (
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
                  <p className="font-semibold">เดือน {slip.month} · สุทธิ {formatCurrency(slip.net_pay)}</p>
                  <p className="text-xs text-ink/55">ขั้นต้น {formatCurrency(slip.gross_pay)} · หัก {formatCurrency(slip.total_deductions)} · {slip.status}</p>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-4 border-b border-black/10 flex justify-between items-center">
              <h3 className="font-bold text-lg text-ink">สร้างหนี้สิน</h3>
              <button onClick={() => setIsDebtModalOpen(false)} className="inline-flex h-10 items-center gap-1.5 rounded-md bg-actionSecondary px-3 text-sm font-semibold text-white hover:bg-actionSecondary/90">
                <XCircle />
                ปิด
              </button>
            </div>
            <div className="p-4 flex flex-col gap-4">
              <div>
                <label className="block text-sm font-semibold text-ink/70 mb-1">วันที่รายการ</label>
                <input
                  type="date"
                  value={debtDueDate}
                  onChange={(e) => setDebtDueDate(e.target.value)}
                  max={bangkokToday()}
                  className="w-full p-2 border border-black/20 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink/70 mb-1">รายละเอียด</label>
                <input
                  type="text"
                  value={debtDescription}
                  onChange={(e) => setDebtDescription(e.target.value)}
                  className="w-full p-2 border border-black/20 rounded-md"
                  placeholder="ค่าสินค้า, ค่ายืม ฯลฯ"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink/70 mb-1">ยอดเงิน (บาท)</label>
                <input
                  type="number"
                  value={debtAmount}
                  onChange={(e) => setDebtAmount(e.target.value)}
                  className="w-full p-2 border border-black/20 rounded-md"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="p-4 border-t border-black/10 flex justify-end gap-2 bg-black/5">
              <button
                onClick={() => setIsDebtModalOpen(false)}
                className="rounded-md bg-actionSecondary px-4 py-2 font-semibold text-white hover:bg-actionSecondary/90"
              >
                ยกเลิก
              </button>
              <button
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
                      loadData();
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
        </div>
      )}
      {pendingExpenseLocationTx && (
        <ExpenseLocationChangeModal
          locations={expenseLocations}
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

  const [manageTimeUser, setManageTimeUser] = useState<any>(null);
  const [viewDashboardUserId, setViewDashboardUserId] = useState<string | null>(null);
  const [viewAuditLogsAdminId, setViewAuditLogsAdminId] = useState<string | null>(null);
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
    primaryLocationId?: string | null;
    currentLocationId?: string | null;
    onSuccess?: () => void;
  } | null>(null);
  const expenseLocations = useMemo(
    () => data?.paymentLocations ?? locations.filter((location) => location.active),
    [data?.paymentLocations, locations],
  );

  async function load() {
    setLoading(true);
    try {
      const res = await authFetch("/api/lanflow/time-tracking/admin");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error("Failed to load admin time tracking:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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

  async function editWage(userId: string, currentWage: number) {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    const wageStr = await requestInput({
      title: "แก้ไขค่าแรงรายวัน",
      label: "ค่าแรงรายวัน (บาท)",
      initialValue: currentWage.toString(),
      inputType: "number",
      required: true,
      min: 0,
      step: 0.01,
    });
    if (wageStr === null) return;
    const wage = Number(wageStr);
    if (isNaN(wage) || wage < 0) return;

    await authFetch("/api/lanflow/time-tracking/admin", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'UPDATE_WAGE', payload: { user_id: userId, daily_wage: wage } })
    });
    load();
  }

  function pendingCountForUser(items: Array<{ profile_id: string }> | undefined, userId: string) {
    return items?.filter((item) => item.profile_id === userId).length || 0;
  }

  if (loading) return <div>กำลังโหลดข้อมูล...</div>;

  const users = [...(data?.users || [])].sort((left: any, right: any) => {
    if (left.id === profile.id) return -1;
    if (right.id === profile.id) return 1;
    return 0;
  });
  const dashboardUser = users.find((user: any) => user.id === viewDashboardUserId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-ink flex items-center gap-2">
            <Clock /> จัดการเวลาและเงินเดือน
          </h2>
        <div className="flex flex-wrap gap-2">
          {data?.admins && data.admins.length > 0 && (
            <select
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

      <div className="bg-white p-4 rounded-xl border border-black/10 shadow-sm overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-black/10 text-ink/65">
              <th className="pb-3 font-semibold">จัดการ</th>
              <th className="pb-3 font-semibold">พนักงาน</th>
              <th className="pb-3 font-semibold">ค่าแรง/วัน</th>
              <th className="pb-3 font-semibold">สถานะ</th>
              <th className="pb-3 font-semibold">แดชบอร์ด</th>
              <th className="pb-3 font-semibold">หนี้สิน</th>
              <th className="pb-3 font-semibold">สรุปสิ้นเดือน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
             {users.map((user: any) => {
               const isSelf = user.id === profile.id;
               const canManageRow = !isSelf || Boolean(user.primary_location_id);
               const activeSegment = user.time_segments?.find((s: any) => !s.end_time);
               const status = activeSegment
                 ? 'RUNNING'
                 : user.resume_schedule
                   ? 'AUTO_START_PENDING'
                   : user.current_month_closed
                     ? 'MONTH_CLOSED'
                     : 'MANAGER_PAUSED';
               const debtRemainingAmount = Number(user.debt_remaining_amount || 0);
               const dashboardPendingCount = pendingCountForUser(data?.pendingTransactions, user.id);
               const payrollPendingCount = pendingCountForUser(data?.pendingSlips, user.id);
               return (
                <tr
                  key={user.id}
                  data-user-id={user.id}
                  data-time-payroll-self={isSelf ? "true" : undefined}
                  className={`hover:bg-sand/30 data-[time-payroll-self=true]:bg-mint/35 ${user.is_active === false ? 'opacity-70 bg-red-50/50' : ''}`}
                >
                  <td className="py-3 pr-3">
                    {canManageRow ? (
                      <button onClick={() => {
                        if (!online) { alert(TIME_TRACKING_OFFLINE_MESSAGE); return; }
                        setManageTimeUser(user);
                      }} disabled={!online} title={online ? "เลือกวันทำงาน" : TIME_TRACKING_OFFLINE_MESSAGE}
                        aria-label={online ? "เลือกวันทำงาน" : TIME_TRACKING_OFFLINE_MESSAGE}
                        className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md bg-river text-white disabled:cursor-not-allowed disabled:opacity-50">
                        <CalendarCheck size={17} />
                      </button>
                    ) : <span className="text-xs text-ink/45">—</span>}
                  </td>
                  <td className="py-3">
                    {user.name}
                    {isSelf && <span className="ml-2 rounded border border-leaf/20 bg-mint px-1.5 py-0.5 text-xs font-semibold text-leaf">ของตนเอง</span>}
                    {user.is_active === false && <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded border border-red-200">ถูกระงับ</span>}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <span>{formatCurrency(user.daily_wage || 0)}</span>
                      {canManageRow && <button onClick={() => editWage(user.id, user.daily_wage || 0)} disabled={!online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="rounded-md bg-amber px-2 py-1 text-xs font-semibold text-white hover:bg-amber/90 disabled:cursor-not-allowed disabled:opacity-40">แก้ไข</button>}
                    </div>
                  </td>
                  <td className="py-3">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${status === 'RUNNING' ? 'bg-leaf/20 text-leaf' : status === 'MONTH_CLOSED' ? 'bg-river/15 text-river' : 'bg-amber/20 text-amber'}`}>
                      {status === 'RUNNING'
                        ? 'กำลังนับเวลา'
                        : status === 'AUTO_START_PENDING'
                          ? 'รอเริ่มอัตโนมัติเดือนใหม่'
                          : status === 'MONTH_CLOSED'
                            ? 'เดือนปิด'
                            : 'หยุดงาน'}
                    </span>
                  </td>
                  <td className="py-3">
                     <button onClick={() => setViewDashboardUserId(user.id)} className="inline-flex items-center gap-1 rounded bg-river px-3 py-1 text-xs font-bold text-white hover:bg-river/90">
                       ดู Dashboard
                       {dashboardPendingCount > 0 && <span className="min-w-4 rounded-full bg-clay px-1.5 py-0.5 text-[10px] text-white">{dashboardPendingCount}</span>}
                     </button>
                  </td>
                  <td className="py-3">
                     <span className="text-clay font-bold">{formatCurrency(debtRemainingAmount)}</span>
                  </td>
                  <td className="py-3">
                     {canManageRow ? <button onClick={() => openPayroll(user)} disabled={!online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="bg-leaf text-white px-3 py-1 rounded text-xs hover:bg-leaf/80 font-bold shadow-sm disabled:cursor-not-allowed disabled:opacity-50 inline-flex items-center gap-1">
                       คำนวณเงินเดือน
                       {payrollPendingCount > 0 && <span className="min-w-4 rounded-full bg-white px-1.5 py-0.5 text-[10px] text-leaf">{payrollPendingCount}</span>}
                     </button> : <span className="text-xs text-ink/45">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {manageTimeUser && (
        <ManageTimeModal
           user={data?.users?.find((u: any) => u.id === manageTimeUser.id) || manageTimeUser}
           admins={data?.admins || []}
           online={online}
           onClose={() => setManageTimeUser(null)}
           onSuccess={() => { setManageTimeUser(null); load(); }}
           onRefresh={() => load()}
        />
      )}

      {viewDashboardUserId && dashboardUser && (
        <ModalShell
          title={dashboardUser.id === profile.id ? "ข้อมูลของตนเอง" : "ข้อมูลของพนักงาน"}
          subtitle={dashboardUser.name}
          onClose={() => setViewDashboardUserId(null)}
        >
          <UserTimeTracking
            profile={profile}
            targetUserId={viewDashboardUserId}
            targetPrimaryLocationId={dashboardUser.primary_location_id ?? null}
            online={online}
            expenseLocations={expenseLocations}
            hideHeading
            allowManagerActions={dashboardUser.id !== profile.id || Boolean(dashboardUser.primary_location_id)}
            onApprove={(type, item) => handleApprove(
              type,
              item.id,
              type === 'TRANSACTION' && item.type === 'WITHDRAWAL'
                ? { title: dashboardUser.id === profile.id ? "เบิกเงินของตนเอง" : `เบิกเงินของ ${item.profiles?.name || 'พนักงาน'}`, amount: Number(item.amount), primaryLocationId: dashboardUser.primary_location_id ?? null }
                : undefined,
              () => load(),
            )}
            onReject={(type, item) => void submitApproval(type, item.id, 'REJECTED')}
          />
        </ModalShell>
      )}

      {viewAuditLogsAdminId && (
        <AuditLogsModal
          adminId={viewAuditLogsAdminId}
          adminName={data?.admins?.find((a: any) => a.id === viewAuditLogsAdminId)?.name}
          onClose={() => setViewAuditLogsAdminId(null)}
        />
      )}
      {payrollUser && (
        <PayrollModal
          user={payrollUser}
          online={online}
          onApprove={(slip) => handleApprove('SLIP', slip.id, Number(slip.net_pay) > 0 ? { title: `เงินเดือนของ ${payrollUser.name} เดือน ${slip.month}`, amount: Number(slip.net_pay), primaryLocationId: payrollUser.primary_location_id } : undefined, () => load())}
          onReject={(slip) => void submitApproval('SLIP', slip.id, 'REJECTED')}
          onChangePayment={(slip) => setPendingPaymentChange({
            sourceType: 'payroll_slip',
            sourceId: slip.id,
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

function ManageTimeModal({ user, admins, online, onClose, onSuccess, onRefresh }: { user: any, admins: any[], online: boolean, onClose: () => void, onSuccess: () => void, onRefresh: () => void }) {
  const [selectedDates, setSelectedDates] = useState<Record<string, 'FULL_DAY' | 'HALF_DAY'>>({});
  const [saving, setSaving] = useState(false);
  const [histories, setHistories] = useState<any[]>([]);
  const [lockedDates, setLockedDates] = useState<Map<string, string>>(new Map());
  const { requestInput, inputDialog } = useInputDialog();

  const activeSegment = useMemo(() => user.time_segments?.find((s: any) => !s.end_time), [user]);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!activeSegment) {
      setTimeLeft(null);
      return;
    }

    const interval = setInterval(async () => {
      const now = new Date();
      const targetDate = nextBangkokCutoff(activeSegment.start_time);

      const diff = targetDate.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft(0);
        clearInterval(interval);
      } else {
        setTimeLeft(Math.floor(diff / 1000));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activeSegment]);

  async function toggleRealTimeTracking() {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    const isRunning = !!activeSegment;

    if (!isRunning) {
      const now = new Date();
      if (isAtOrAfterBangkokHour(now, 15)) {
        if (!confirm("เลยเวลา 15:00 น. แล้ว\nการเริ่มนับเวลาตอนนี้ จะถูกนับไปรวมกับ 15:00 ของวันพรุ่งนี้\n\nยืนยันการเริ่มนับเวลาหรือไม่?")) {
          return;
        }
      }
    }

    setSaving(true);
    try {
      await authFetch("/api/lanflow/time-tracking/admin", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'TOGGLE_TRACKING', payload: { user_id: user.id, status: isRunning ? 'PAUSED' : 'RUNNING' } })
      });
      onRefresh();
    } catch (e) {
      console.error(e);
      alert("เกิดข้อผิดพลาด");
    } finally {
      setSaving(false);
    }
  }

  const loadHistory = useCallback(async () => {
    try {
      const res = await authFetch("/api/lanflow/time-tracking/admin", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'GET_AUDIT_LOGS', payload: { target_user_id: user.id, action_filter: 'BULK_UPDATE_SEGMENTS' } })
      });
      if (res.ok) {
        const json = await res.json();
        setHistories(json.logs || []);
      }
    } catch (e) {
      console.error(e);
    }
  }, [user.id]);

  const loadLockedDates = useCallback(async () => {
    try {
      const res = await authFetch("/api/lanflow/time-tracking/admin", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'GET_LOCKED_DATES', payload: { user_id: user.id } })
      });
      if (res.ok) {
        const json = await res.json();
        setLockedDates(new Map(Object.entries(json.lockedDates || {})));
      }
    } catch (e) {
      console.error(e);
    }
  }, [user.id]);

  const [viewMonth, setViewMonth] = useState(0); // 0 = current month, -1 = previous month

  const initialDates = useMemo(() => {
    const initial: Record<string, 'FULL_DAY' | 'HALF_DAY'> = {};
    const currentMonth = bangkokToday().slice(0, 7);
    const [currentYear, currentMonthNumber] = currentMonth.split("-").map(Number);

    // Build prefixes for current month and previous month
    const prefixes: string[] = [];
    for (let offset = 0; offset >= -1; offset--) {
      const d = new Date(Date.UTC(currentYear, currentMonthNumber - 1 + offset, 1));
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const y = String(d.getUTCFullYear());
      prefixes.push(`${y}-${m}-`);
    }

    user.time_segments?.forEach((s: any) => {
      if (!s.end_time) return;
      const d = bangkokDateString(new Date(s.start_time));
      if (prefixes.some(p => d.startsWith(p))) {
        const start = new Date(s.start_time).getTime();
        const end = new Date(s.end_time).getTime();
        const hours = (end - start) / (1000 * 60 * 60);
        initial[d] = hours <= 4 ? 'HALF_DAY' : 'FULL_DAY';
      }
    });
    return initial;
  }, [user]);

  useEffect(() => {
    setSelectedDates(initialDates);
    void loadHistory();
    void loadLockedDates();
  }, [initialDates, loadHistory, loadLockedDates]);

  const viewDate = useMemo(() => {
    const [year, month] = bangkokToday().slice(0, 7).split("-").map(Number);
    return new Date(Date.UTC(year, month - 1 + viewMonth, 1));
  }, [viewMonth]);

  const days = useMemo(() => {
    const today = bangkokToday();
    const targetMonth = viewDate.getUTCMonth();
    const targetYear = viewDate.getUTCFullYear();
    const daysInMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

    // For current month: only show up to today. For past months: show all days.
    const isCurrentMonth = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}` === today.slice(0, 7);
    const maxDay = isCurrentMonth ? Number(today.slice(8, 10)) : daysInMonth;

    const result = [];
    for (let d = 1; d <= maxDay; d++) {
      const dateStr = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      result.push(dateStr);
    }
    return result;
  }, [viewDate]);

  function toggleDate(d: string) {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    const lockReason = lockedDates.get(d);
    if (lockReason) {
      const reason = lockReason.startsWith('REPORT:')
        ? `ล็อกโดยรายงาน ${lockReason.slice('REPORT:'.length)} — ต้องลบรายงานล่าสุดตามลำดับก่อน`
        : lockReason === 'SLIP'
          ? 'ได้ออกสลิปเงินเดือนของเดือนนี้ไปแล้ว'
          : 'ยอดค่าแรงวันนี้ถูกนำไปหักหนี้สินแล้ว';
      alert(`วันที่ ${d} ไม่สามารถแก้ไขได้\nเนื่องจาก${reason}`);
      return;
    }
    setSelectedDates(prev => {
      const current = prev[d];
      const next = { ...prev };
      if (!current) {
        next[d] = 'FULL_DAY';
      } else if (current === 'FULL_DAY') {
        next[d] = 'HALF_DAY';
      } else {
        delete next[d];
      }
      return next;
    });
  }

  async function handleSubmit() {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    const selections: Array<{ date: string, work_type: string }> = [];

    // Check deleted days (skip locked dates)
    for (const d of Object.keys(initialDates)) {
      if (!selectedDates[d] && !lockedDates.has(d)) {
        selections.push({ date: d, work_type: 'NONE' });
      }
    }

    // Check added/updated days (skip locked dates)
    for (const d of Object.keys(selectedDates)) {
      if (initialDates[d] !== selectedDates[d] && !lockedDates.has(d)) {
        selections.push({ date: d, work_type: selectedDates[d] });
      }
    }

    if (selections.length === 0) {
      alert("ไม่มีการเปลี่ยนแปลงข้อมูล");
      return;
    }

    const admin_comment = await requestInput({
      title: "บันทึกการแก้ไขเวลา",
      label: "หมายเหตุการแก้ไขเวลา",
      multiline: true,
      required: true,
    });
    if (!admin_comment) return;

    setSaving(true);
    try {
      const res = await authFetch("/api/lanflow/time-tracking/admin", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ADD_BULK_SEGMENTS',
          payload: { user_id: user.id, selections, full_snapshot: selectedDates, admin_comment }
        })
      });
      if (res.ok) {
        alert(`บันทึกข้อมูล ${user.name} สำเร็จ`);
        onSuccess();
      } else {
        alert("เกิดข้อผิดพลาดในการบันทึก");
      }
    } catch (e) {
      console.error(e);
      alert("เกิดข้อผิดพลาด");
    } finally {
      setSaving(false);
    }
  }

  async function applyHistorySelections(fullSnapshot: Record<string, string>) {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    if (!confirm("ยืนยันการนำข้อมูลชุดนี้กลับมาใหม่?")) return;

    // Calculate new diff based on initialDates
    const selections: Array<{ date: string, work_type: string }> = [];
    for (const d of days) {
      const current = initialDates[d] || 'NONE';
      const target = fullSnapshot[d] || 'NONE';
      if (current !== target && !lockedDates.has(d)) {
        selections.push({ date: d, work_type: target });
      }
    }

    if (selections.length === 0) return;

    setSaving(true);
    try {
      const res = await authFetch("/api/lanflow/time-tracking/admin", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ADD_BULK_SEGMENTS', payload: { user_id: user.id, selections, full_snapshot: fullSnapshot, admin_comment: 'กู้คืนจากประวัติ' } })
      });
      if (res.ok) {
        alert("ดึงข้อมูลกลับมาเรียบร้อยแล้ว");
        onSuccess();
      } else {
        alert("เกิดข้อผิดพลาดในการบันทึก");
      }
    } catch (e) {
      console.error(e);
      alert("เกิดข้อผิดพลาด");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl p-6 shadow-2xl relative max-h-[95vh] overflow-hidden flex flex-col">
        <button onClick={onClose} className="absolute right-4 top-4 inline-flex h-10 items-center gap-1.5 rounded-md bg-actionSecondary px-3 text-sm font-semibold text-white hover:bg-actionSecondary/90"><XCircle size={20} />ปิด</button>
        <h2 className="text-xl font-bold mb-2 shrink-0">จัดการเวลาทำงานของ {user.name}</h2>

        {/* Real-time Timer Section */}
        <div className="bg-sand/30 p-4 rounded-lg border border-black/10 mb-4 shrink-0 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ink/70">สถานะ:</span>
              <span className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 ${activeSegment ? 'bg-leaf/20 text-leaf' : 'bg-amber/20 text-amber'}`}>
                {activeSegment ? <><PlayCircle size={14} /> กำลังทำงาน</> : <><PauseCircle size={14} /> หยุดพัก</>}
              </span>
            </div>
            {activeSegment && (
              <div className="text-xs text-ink/60 mt-1">
                เริ่มเมื่อ: {formatBangkokDateTime(activeSegment.start_time)}
              </div>
            )}
            {activeSegment && timeLeft !== null && (
              <div className="font-mono font-bold text-river mt-1 flex items-center gap-2">
                ⏱ {Math.floor(timeLeft / 3600).toString().padStart(2, '0')}:
                {Math.floor((timeLeft % 3600) / 60).toString().padStart(2, '0')}:
                {(timeLeft % 60).toString().padStart(2, '0')}
                <span className="text-xs font-normal text-ink/50">(ถึง 15:00)</span>
              </div>
            )}
          </div>
          <button
            onClick={toggleRealTimeTracking}
            disabled={saving || !online}
            title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE}
            className={`px-4 py-2 rounded-lg font-bold shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2 ${
              activeSegment ? 'bg-clay text-white hover:bg-clay/80' : 'bg-leaf text-white hover:bg-leaf/80'
            }`}
          >
            {activeSegment ? <><PauseCircle size={18} /> หยุดงาน</> : <><PlayCircle size={18} /> เริ่มนับเวลา</>}
          </button>
        </div>

        <h3 className="text-sm font-bold text-ink/70 mb-2 shrink-0 border-t border-black/10 pt-4">ปฏิทินติ๊กเลือกวันทำงาน (ย้อนหลังได้ 1 เดือน)</h3>

        {/* Month Navigation */}
        <div className="flex items-center justify-between mb-3 shrink-0">
          <button
            onClick={() => setViewMonth(-1)}
            disabled={viewMonth === -1}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-md border border-black/10 hover:bg-sand disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={14} /> เดือนก่อน
          </button>
          <span className="text-sm font-bold text-ink">
            {viewDate.toLocaleString('th-TH', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
          </span>
          <button
            onClick={() => setViewMonth(0)}
            disabled={viewMonth === 0}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-md border border-black/10 hover:bg-sand disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            เดือนนี้ <ChevronRight size={14} />
          </button>
        </div>

        <p className="text-xs text-ink/65 mb-4 shrink-0">คลิกเพื่อเลือก: <span className="font-bold text-river">กด 1 รอบ = เต็มวัน</span>, <span className="font-bold text-river/70">กด 2 รอบ = ครึ่งวัน</span>, <span className="font-bold text-ink">กด 3 รอบ = ไม่เลือก</span></p>

        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mb-6 overflow-y-auto p-1 flex-1">
          {days.map(d => {
            const current = selectedDates[d];
            const lockReason = lockedDates.get(d);
            const lockLabel = lockReason?.startsWith('REPORT:')
              ? lockReason.slice('REPORT:'.length)
              : lockReason === 'SLIP' ? '🔒 เงินเดือน' : '🔒 หักหนี้';
            const lockTitle = lockReason?.startsWith('REPORT:')
              ? `ล็อกโดยรายงาน ${lockLabel} — ต้องลบรายงานล่าสุดตามลำดับก่อน`
              : undefined;
            return (
              <button
                key={d}
                onClick={() => toggleDate(d)}
                disabled={!online || lockedDates.has(d)}
                title={!online ? TIME_TRACKING_OFFLINE_MESSAGE : lockTitle}
                className={`
                  relative overflow-hidden h-14 rounded-md border flex flex-col items-center justify-center text-sm font-semibold transition-colors
                  ${!online || lockedDates.has(d) ? 'bg-black/5 border-black/20 cursor-not-allowed opacity-60' : current ? 'border-river ring-2 ring-river/30 ring-offset-1' : 'bg-white border-black/10 text-ink/70 hover:bg-sand'}
                `}
              >
                {current === 'FULL_DAY' && <div className={`absolute inset-0 ${lockedDates.has(d) ? 'bg-ink/40' : 'bg-river'}`} />}
                {current === 'HALF_DAY' && <div className={`absolute inset-y-0 left-0 w-1/2 ${lockedDates.has(d) ? 'bg-ink/20' : 'bg-river/30'}`} />}

                <span className={`relative z-10 ${current === 'FULL_DAY' ? 'text-white' : 'text-ink'}`}>
                  {d.split('-')[2]}
                </span>

                {lockedDates.has(d) && (
                  <span className="relative z-10 text-[9px] text-clay font-bold">
                    {lockLabel}
                  </span>
                )}
                {current && !lockedDates.has(d) && (
                  <span className={`relative z-10 text-[10px] ${current === 'FULL_DAY' ? 'text-white/90' : 'text-river font-bold'}`}>
                    {current === 'FULL_DAY' ? 'เต็มวัน' : 'ครึ่งวัน'}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex justify-end gap-3 border-t border-black/10 pt-4 shrink-0">
           <button onClick={onClose} className="rounded-md bg-actionSecondary px-4 py-2 font-semibold text-white hover:bg-actionSecondary/90">ยกเลิก</button>
           <button onClick={handleSubmit} disabled={saving || !online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="rounded-md bg-commit px-4 py-2 font-bold text-white hover:bg-commit/90 disabled:cursor-not-allowed disabled:opacity-50">
             {saving ? 'กำลังบันทึก...' : `บันทึกข้อมูล (${Object.keys(selectedDates).length} วัน)`}
           </button>
        </div>

        {histories.length > 0 && (
          <div className="mt-4 border-t border-black/10 pt-4 shrink-0">
            <h3 className="text-sm font-bold text-ink/70 mb-2">ประวัติการบันทึกล่าสุด</h3>
            <ul className="text-xs space-y-2 max-h-32 overflow-y-auto">
              {histories.map((h) => {
                const adminName = admins.find(a => a.id === h.admin_id)?.name || 'Admin';
                const fullSnapshot = h.new_data?.full_snapshot;
                if (!fullSnapshot) return null; // Hide old logs that don't have a full snapshot

                // Check if current SELECTED state matches this history's full snapshot
                let isMatching = true;
                for (const d of days) {
                  const currentState = selectedDates[d] || 'NONE';
                  const historyState = fullSnapshot[d] || 'NONE';
                  if (currentState !== historyState) {
                    isMatching = false;
                    break;
                  }
                }

                const activeDaysCount = Object.keys(fullSnapshot).length;

                return (
                <li key={h.id} className={`flex justify-between items-center p-2 rounded gap-3 ${isMatching ? 'bg-black/5' : 'bg-sand'}`}>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className={`font-semibold truncate ${isMatching ? 'text-ink/50' : 'text-ink'}`}>
                      {formatBangkokDateTime(h.created_at)} <span className="text-river">({adminName})</span>
                    </span>
                    <span className="text-ink/60 truncate">ทำงาน {activeDaysCount} วัน</span>
                  </div>
                  <button
                    onClick={() => applyHistorySelections(fullSnapshot)}
                    disabled={saving || isMatching || !online}
                    title={!online ? TIME_TRACKING_OFFLINE_MESSAGE : undefined}
                    className={`px-3 py-1 rounded font-bold shrink-0 whitespace-nowrap transition-colors ${
                       isMatching || !online ? 'bg-black/10 text-ink/40 cursor-not-allowed' : 'bg-clay text-white hover:bg-clay/80'
                    }`}
                  >
                    {isMatching ? 'ข้อมูลตรงกันแล้ว' : 'นำข้อมูลกลับมาใหม่'}
                  </button>
                </li>
              )})}
            </ul>
          </div>
        )}
      </div>
      {inputDialog}
    </div>
  )
}

function AuditLogsModal({ adminId, adminName, onClose }: { adminId: string, adminName: string, onClose: () => void }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await authFetch("/api/lanflow/time-tracking/admin", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'GET_AUDIT_LOGS', payload: { admin_user_id: adminId } })
        });
        if (res.ok) {
          const json = await res.json();
          setLogs(json.logs);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [adminId]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl relative">
        <div className="p-6 border-b border-black/10 flex justify-between items-center shrink-0">
          <h2 className="text-xl font-bold">ประวัติการกระทำของ Admin: {adminName}</h2>
          <button onClick={onClose} className="inline-flex h-10 items-center gap-1.5 rounded-md bg-actionSecondary px-3 text-sm font-semibold text-white hover:bg-actionSecondary/90"><XCircle size={20} />ปิด</button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {loading ? (
             <div>กำลังโหลดข้อมูล...</div>
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
      </div>
    </div>
  )
}

function PayrollModal({ user, online, onApprove, onReject, onChangePayment, onClose, onRefresh }: { user: any, online: boolean, onApprove: (slip: any) => void, onReject: (slip: any) => void, onChangePayment: (slip: any) => void, onClose: () => void, onRefresh: () => void }) {
  const [slips, setSlips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [createMonth, setCreateMonth] = useState(bangkokToday().slice(0, 7));
  const [autoStartNextMonth, setAutoStartNextMonth] = useState(true);
  const [previewSlipId, setPreviewSlipId] = useState<string | null>(null);
  const { requestInput, inputDialog } = useInputDialog();
  const userIsRunning = Boolean(user.time_segments?.some((segment: any) => !segment.end_time));

  const loadSlips = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/lanflow/time-tracking/admin", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'LIST_PAYROLL_SLIPS', payload: { user_id: user.id } })
      });
      if (res.ok) {
        const json = await res.json();
        setSlips(json.slips || []);
      }
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
    setAutoStartNextMonth(userIsRunning);
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
          payload: {
            user_id: user.id,
            month: createMonth,
            auto_start_next_month: createMonth === bangkokToday().slice(0, 7)
              && userIsRunning
              && autoStartNextMonth,
          },
        })
      });
      if (res.ok) {
        setCreateFormOpen(false);
        alert("สร้างสลิปเงินเดือนสำเร็จ");
        void loadSlips();
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
        loadSlips();
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
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-sand rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl relative">
        <button onClick={onClose} className="absolute right-4 top-4 inline-flex h-10 items-center gap-1.5 rounded-md bg-actionSecondary px-3 text-sm font-semibold text-white shadow-sm hover:bg-actionSecondary/90"><XCircle size={20} />ปิด</button>

        <div className="p-6 border-b border-black/10 bg-white rounded-t-xl flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-ink flex items-center gap-2">สลิปเงินเดือนของ {user.name}</h2>
          </div>
          <button
            onClick={openCreateSlip}
            disabled={saving || !online}
            title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE}
            className="bg-leaf text-white px-4 py-2 rounded-lg font-bold shadow-sm hover:bg-leaf/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            สร้างสลิปเงินเดือน
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {loading ? (
             <div>กำลังโหลดข้อมูล...</div>
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
                        <span>ค่าแรง: <strong className="text-ink">{formatCurrency(slip.gross_pay)}</strong></span>
                        <span>หักหนี้/เบิก: <strong className="text-clay">{formatCurrency(slip.total_deductions)}</strong></span>
                        <span>ยอดสุทธิ: <strong className={slip.net_pay < 0 ? 'text-clay' : 'text-leaf'}>{formatCurrency(slip.net_pay)}</strong></span>
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

                       {slip.status === 'PENDING' && (
                         <button onClick={() => onApprove(slip)} disabled={!online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="bg-success text-white px-3 py-1.5 rounded-md text-sm font-bold hover:bg-success/85 disabled:cursor-not-allowed disabled:opacity-50">อนุมัติ</button>
                       )}
                       {slip.status === 'APPROVED' && Number(slip.net_pay) > 0 && (
                         <button onClick={() => onChangePayment(slip)} disabled={!online || Boolean(slip.report_lock_no)} title={reportLockReason(slip) ?? undefined} className="bg-river text-white px-3 py-1.5 rounded-md text-sm font-bold hover:bg-river/85 disabled:opacity-40">เปลี่ยนวิธีจ่าย</button>
                       )}
                       {slip.status === 'PENDING' && (
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
      </div>
      {createFormOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-ink">สร้างสลิปเงินเดือน</h3>
            <label className="mt-4 block text-sm font-semibold text-ink">เดือน</label>
            <input
              type="month"
              value={createMonth}
              max={bangkokToday().slice(0, 7)}
              onChange={(event) => setCreateMonth(event.target.value)}
              className="mt-2 w-full rounded-md border border-black/15 px-3 py-2"
            />
            <p className="mt-3 rounded-md bg-amber/10 p-3 text-sm text-ink/75">
              ระบบจะตรวจเดือนทำงานเก่าสุด รายการรออนุมัติ และปิดเดือนนี้ทันทีหลังสร้างสลิป
            </p>
            {createMonth === bangkokToday().slice(0, 7) && userIsRunning && (
              <label className="mt-4 flex items-start gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={autoStartNextMonth}
                  onChange={(event) => setAutoStartNextMonth(event.target.checked)}
                  className="mt-1"
                />
                <span>เริ่มนับเวลาให้อัตโนมัติเมื่อขึ้นวันที่ 1 เวลา 00:00 น. (ปิดเวลาเดิมเพื่อออกสลิปก่อน)</span>
              </label>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setCreateFormOpen(false)} className="rounded-md bg-actionSecondary px-4 py-2 font-semibold text-white">ยกเลิก</button>
              <button onClick={() => void createSlip()} disabled={saving || !createMonth} className="rounded-md bg-success px-4 py-2 font-bold text-white disabled:opacity-50">ยืนยันสร้างสลิป</button>
            </div>
          </div>
        </div>
      )}
      {previewSlipId && (
        <SlipPreviewModal
          sourceType="payroll"
          sourceId={previewSlipId}
          online={online}
          onClose={() => setPreviewSlipId(null)}
        />
      )}
      {inputDialog}
    </div>
  )
}
