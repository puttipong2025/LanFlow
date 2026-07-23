"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { Clock, UserCircle, PlayCircle, PauseCircle, XCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { authFetch } from "@/lib/auth-fetch";
import { Location, Profile } from "@/types";
import { ExpenseLocationApprovalModal } from "./time-tracking/ExpenseLocationApprovalModal";

interface TimeTrackingModuleProps {
  profile: Profile;
  online: boolean;
  locations: Location[];
}

const TIME_TRACKING_OFFLINE_MESSAGE = "เวลาและเงินเดือนใช้ได้เมื่อออนไลน์เท่านั้น";
type ApprovalType = 'TRANSACTION' | 'LEAVE' | 'SLIP';

export function TimeTrackingModule({ profile, online, locations }: TimeTrackingModuleProps) {
  const isAdmin = profile.role === "admin" || profile.role === "super_admin";

  if (isAdmin) {
    return <AdminTimeTracking profile={profile} online={online} locations={locations} />;
  }

  return <UserTimeTracking profile={profile} online={online} />;
}

function UserTimeTracking({ profile, targetUserId, online, expenseLocations = [], onApprove }: { profile: Profile, targetUserId?: string, online: boolean, expenseLocations?: Location[], onApprove?: (type: ApprovalType, item: any) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // Debt Modal State
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false);
  const [debtDueDate, setDebtDueDate] = useState(new Date().toISOString().split('T')[0]);
  const [debtDescription, setDebtDescription] = useState("");
  const [debtAmount, setDebtAmount] = useState("");

  const isRunning = data?.timeTracking?.status === 'RUNNING';
  const startTimeStr = data?.timeTracking?.start_time;

  const loadData = useCallback(async () => {
    try {
      const url = targetUserId ? `/api/lanflow/time-tracking/user?userId=${targetUserId}` : "/api/lanflow/time-tracking/user";
      const res = await authFetch(url);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error("Failed to load user time tracking:", err);
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
      const startTime = new Date(startTimeStr);
      let targetDate = new Date(startTime);
      targetDate.setHours(15, 0, 0, 0);

      if (startTime.getTime() >= targetDate.getTime()) {
         targetDate.setDate(targetDate.getDate() + 1);
      }

      const diff = targetDate.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft(0);
        clearInterval(interval);

        // Call CUTOFF API
        try {
          const endpoint = targetUserId ? "/api/lanflow/time-tracking/admin" : "/api/lanflow/time-tracking/user";
          const payload = targetUserId ? { user_id: targetUserId, cutoff_time: targetDate.toISOString() } : { cutoff_time: targetDate.toISOString() };
          await authFetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'CUTOFF_TRACKING', payload })
          });
          window.location.reload();
        } catch (e) {
          console.error(e);
        }
      } else {
        setTimeLeft(Math.floor(diff / 1000));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, startTimeStr, targetUserId]);

  async function toggleRealTimeTracking() {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    if (!isRunning) {
      const now = new Date();
      const target15 = new Date(now);
      target15.setHours(15, 0, 0, 0);

      if (now.getTime() >= target15.getTime()) {
        if (!confirm("เลยเวลา 15:00 น. แล้ว\nการเริ่มนับเวลาตอนนี้ จะถูกนับไปรวมกับ 15:00 ของวันพรุ่งนี้\n\nยืนยันการเริ่มนับเวลาหรือไม่?")) {
          return;
        }
      }
    }

    setSaving(true);
    try {
      const endpoint = targetUserId ? "/api/lanflow/time-tracking/admin" : "/api/lanflow/time-tracking/user";
      const payload = targetUserId
        ? { user_id: targetUserId, status: isRunning ? 'PAUSED' : 'RUNNING' }
        : { status: isRunning ? 'PAUSED' : 'RUNNING' };

      await authFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'TOGGLE_TRACKING', payload })
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
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    if (!confirm(`คุณต้องการลบรายการ ${tx.type === 'DEBT' ? 'สร้างหนี้สิน' : 'เบิกเงิน'} จำนวน ${tx.amount} ใช่หรือไม่?`)) return;

    setSaving(true);
    try {
      const res = await authFetch("/api/lanflow/time-tracking/admin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DELETE_TRANSACTION", payload: { transaction_id: tx.id } })
      });
      if (!res.ok) {
         const json = await res.json();
         alert(json.error || "ไม่สามารถลบรายการได้");
      } else {
         alert("ลบรายการสำเร็จ");
         loadData();
      }
    } catch (e) {
      alert("เกิดข้อผิดพลาด");
    } finally {
      setSaving(false);
    }
  }

  async function changeWithdrawalExpenseLocation(tx: any) {
    if (!online || expenseLocations.length === 0) return;
    const choices = expenseLocations.map((location, index) => `${index + 1}. ${location.name}`).join('\n');
    const selected = Number(prompt(`เลือกสาขาค่าใช้จ่ายใหม่\n${choices}`));
    const location = expenseLocations[selected - 1];
    if (!location) return;
    const admin_comment = prompt('หมายเหตุ (ถ้ามี):') || '';
    setSaving(true);
    try {
      const res = await authFetch('/api/lanflow/time-tracking/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CHANGE_EXPENSE_LOCATION', payload: { source_type: 'transaction', source_id: tx.id, expense_location_id: location.id, admin_comment } }),
      });
      if (!res.ok) {
        const json = await res.json();
        alert(json.error || 'ไม่สามารถเปลี่ยนสาขาค่าใช้จ่ายได้');
        return;
      }
      await loadData();
    } finally { setSaving(false); }
  }

  if (loading) return <div>กำลังโหลดข้อมูล...</div>;

  const regularTransactions = data?.transactions?.filter((t: any) => t.status !== 'REJECTED' && t.type !== 'DEBT' && t.type !== 'WITHDRAWAL') || [];
  const debtTransactions = data?.transactions?.filter((t: any) => t.status !== 'REJECTED' && (t.type === 'DEBT' || t.type === 'WITHDRAWAL')) || [];
  const leaveRequests = data?.leaveRequests?.filter((request: any) => request.status !== 'REJECTED') || [];

  return (
    <div className={`flex flex-col gap-6 p-4 ${targetUserId ? 'bg-sky-50/50 rounded-2xl border border-black/5 shadow-inner' : ''}`}>
      <h2 className="text-xl font-bold text-ink flex items-center gap-2">
        <UserCircle /> {targetUserId ? "ข้อมูลของพนักงาน" : "ระบบเวลาและเงินเดือน (ของตนเอง)"}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white p-4 rounded-xl border border-black/10 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-semibold text-ink/70">สถานะเวลาทำงานปัจจุบัน</h3>
            <div className="flex items-center gap-2 mt-2">
              <span className={`px-2 py-1 rounded-md text-sm font-bold flex items-center gap-1 ${isRunning ? 'bg-leaf/20 text-leaf' : 'bg-amber/20 text-amber'}`}>
                {isRunning ? <><PlayCircle size={16} /> กำลังทำงาน</> : <><PauseCircle size={16} /> หยุดพัก</>}
              </span>
              {isRunning && startTimeStr && (
                <span className="text-xs text-ink/60">เริ่มเมื่อ: {new Date(startTimeStr).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span>
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

          <button
            onClick={toggleRealTimeTracking}
            disabled={saving || !online}
            title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE}
            className={`mt-4 w-full py-2 rounded-lg font-bold shadow-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 ${
              isRunning ? 'bg-clay text-white hover:bg-clay/80' : 'bg-leaf text-white hover:bg-leaf/80'
            }`}
          >
            {isRunning ? <><PauseCircle size={18} /> หยุดงาน</> : <><PlayCircle size={18} /> เริ่มนับเวลา</>}
          </button>
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

            {targetUserId && (
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
                className="w-full py-2 rounded-lg text-sm font-bold shadow-sm transition-colors bg-clay/10 text-clay border border-clay/20 hover:bg-clay/20 disabled:cursor-not-allowed disabled:opacity-50"
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
            const amount = prompt("ระบุยอดเงินที่ต้องการเบิก (บาท):");
            if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;

            const endpoint = targetUserId ? "/api/lanflow/time-tracking/admin" : "/api/lanflow/time-tracking/user";
            const action = targetUserId ? "ADMIN_REQUEST_WITHDRAWAL" : "REQUEST_WITHDRAWAL";
            const payload = targetUserId
              ? { user_id: targetUserId, amount: Number(amount) }
              : { amount: Number(amount) };

            await authFetch(endpoint, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action, payload })
            });
            await loadData();
          }}
          disabled={!online}
          title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE}
          className="bg-amber text-ink px-4 py-2 rounded-md font-semibold hover:bg-amber/80 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {targetUserId ? 'ขอเบิกเงินแทน' : 'ขอเบิกเงินล่วงหน้า'}
        </button>
      </div>

      <div className="bg-white p-4 rounded-xl border border-black/10 shadow-sm mt-4">
        <h3 className="font-semibold text-ink/70 mb-4">ประวัติหักเงิน</h3>
        {leaveRequests.length === 0 && regularTransactions.length === 0 ? (
          <p className="text-sm text-ink/50">ไม่มีประวัติ</p>
        ) : (
          <ul className="divide-y divide-black/5">
             {regularTransactions.map((t: any) => (
                <li key={t.id} className="py-3 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 border-b border-black/5 last:border-0">
                  <div className="flex flex-col">
                    <span>
                      {t.type === 'DEBT' ? 'สร้างหนี้สิน' : t.type === 'DEBT_DEDUCTION' ? 'หักหนี้อัตโนมัติ' : t.type === 'WITHDRAWAL_DEDUCTION' ? 'หักยอดเบิกเงินอัตโนมัติ' : t.type === 'SALARY' ? 'รับค่าแรง' : 'เบิกเงิน'}{' '}
                      <strong>{formatCurrency(t.amount)}</strong>
                    </span>
                    {t.description && <span className="text-sm text-ink/70 mt-1">{t.description}</span>}
                    {t.due_date && <span className="text-xs text-clay mt-1">กำหนดชำระ: {new Date(t.due_date).toLocaleDateString('th-TH')}</span>}
                    <span className="text-xs text-ink/50 mt-1">วันที่ขอ: {t.created_at ? new Date(t.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</span>
                    {t.status === 'APPROVED' && (
                      <span className="text-xs text-ink/50">วันที่อนุมัติ: {t.updated_at ? new Date(t.updated_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : (t.created_at ? new Date(t.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-')}</span>
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
                    <span className={`text-xs font-bold px-2 py-1 rounded-md ${t.status === 'APPROVED' ? 'bg-leaf/20 text-leaf' : 'bg-ink/10 text-ink'}`}>{t.status}</span>
                    {targetUserId && t.status === 'PENDING' && onApprove && (profile.role === 'super_admin' || t.type === 'WITHDRAWAL') && (
                      <button onClick={() => onApprove('TRANSACTION', t)} disabled={!online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="bg-leaf/20 text-leaf px-3 py-1 rounded font-bold hover:bg-leaf/30 disabled:cursor-not-allowed disabled:opacity-50">อนุมัติ</button>
                    )}
                    {t.type === 'WITHDRAWAL' && t.status === 'APPROVED' && !t.cancelled_at && (profile.role === 'admin' || profile.role === 'super_admin') && (
                      <button onClick={() => changeWithdrawalExpenseLocation(t)} disabled={saving || !online || expenseLocations.length === 0} className="text-river hover:text-river/70 text-sm underline disabled:opacity-40">เปลี่ยนสาขาค่าใช้จ่าย</button>
                    )}
                    {(profile.role === 'super_admin' || (profile.role === 'admin' && !targetUserId && t.status !== 'APPROVED')) && (t.type === 'DEBT' || t.type === 'WITHDRAWAL') && (
                      <button onClick={() => handleDeleteTransaction(t)} disabled={saving || !online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="text-clay hover:text-clay/70 p-1 disabled:cursor-not-allowed disabled:opacity-40">
                        <XCircle size={18} />
                      </button>
                    )}
                  </div>
                </li>
             ))}
              {leaveRequests.map((r: any) => (
                <li key={r.id} className="py-3 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 border-b border-black/5 last:border-0">
                  <div className="flex flex-col">
                    <span>ลางาน ({r.type}) <strong>{r.start_date}</strong></span>
                    <span className="text-xs text-ink/50 mt-1">วันที่ขอ: {r.created_at ? new Date(r.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</span>
                    {r.status === 'APPROVED' && (
                      <span className="text-xs text-ink/50">วันที่อนุมัติ: {r.updated_at ? new Date(r.updated_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : (r.created_at ? new Date(r.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-')}</span>
                    )}
                    {r.admin_comment?.startsWith("ยื่นแทนโดย") && (
                      <span className="text-xs text-river mt-1">{r.admin_comment}</span>
                    )}
                    {r.approver?.name && (
                      <span className="text-xs text-leaf mt-1">ผู้ทำรายการ: {r.approver.name}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <span className={`text-xs font-bold px-2 py-1 rounded-md ${r.status === 'APPROVED' ? 'bg-leaf/20 text-leaf' : 'bg-ink/10 text-ink'}`}>{r.status}</span>
                    {targetUserId && r.status === 'PENDING' && onApprove && (
                      <button onClick={() => onApprove('LEAVE', r)} disabled={!online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="bg-leaf/20 text-leaf px-3 py-1 rounded font-bold hover:bg-leaf/30 disabled:cursor-not-allowed disabled:opacity-50">อนุมัติ</button>
                    )}
                  </div>
                </li>
             ))}
          </ul>
        )}
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
                    {t.type === 'DEBT' && t.due_date && <span className="text-xs text-clay mt-1 font-semibold">กำหนดชำระ: {new Date(t.due_date).toLocaleDateString('th-TH')}</span>}
                    <span className="text-xs text-ink/50 mt-1">วันที่ทำรายการ: {t.created_at ? new Date(t.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</span>
                    {t.status === 'APPROVED' && (
                      <span className="text-xs text-ink/50">วันที่อนุมัติ: {t.updated_at ? new Date(t.updated_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : (t.created_at ? new Date(t.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-')}</span>
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
                    <span className={`text-xs font-bold px-2 py-1 rounded-md ${t.status === 'APPROVED' ? 'bg-leaf/20 text-leaf' : 'bg-ink/10 text-ink'}`}>{t.status}</span>
                    {targetUserId && t.status === 'PENDING' && onApprove && (profile.role === 'super_admin' || t.type === 'WITHDRAWAL') && (
                      <button onClick={() => onApprove('TRANSACTION', t)} disabled={!online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="bg-leaf/20 text-leaf px-3 py-1 rounded font-bold hover:bg-leaf/30 disabled:cursor-not-allowed disabled:opacity-50">อนุมัติ</button>
                    )}
                    {(profile.role === 'super_admin' || (profile.role === 'admin' && !targetUserId && t.status !== 'APPROVED')) && (t.type === 'DEBT' || t.type === 'WITHDRAWAL') && (
                      <button onClick={() => handleDeleteTransaction(t)} disabled={saving || !online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="text-clay hover:text-clay/70 p-1 disabled:cursor-not-allowed disabled:opacity-40">
                        <XCircle size={18} />
                      </button>
                    )}
                  </div>
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
              <button onClick={() => setIsDebtModalOpen(false)} className="text-ink/50 hover:text-clay">
                <XCircle />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-4">
              <div>
                <label className="block text-sm font-semibold text-ink/70 mb-1">วันที่ค้างชำระ</label>
                <input
                  type="date"
                  value={debtDueDate}
                  onChange={(e) => setDebtDueDate(e.target.value)}
                  min={new Date(new Date().getFullYear(), new Date().getMonth(), 1).toLocaleString('sv').split(' ')[0]}
                  max={new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toLocaleString('sv').split(' ')[0]}
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
                className="px-4 py-2 font-semibold text-ink/70 hover:bg-black/10 rounded-md"
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
                  const selectedDate = new Date(debtDueDate);
                  const now = new Date();
                  if (selectedDate.getMonth() !== now.getMonth() || selectedDate.getFullYear() !== now.getFullYear()) {
                    alert("กรุณาเลือกวันที่ค้างชำระให้อยู่ในเดือนปัจจุบันเท่านั้น");
                    return;
                  }

                  setSaving(true);
                  try {
                    const res = await authFetch("/api/lanflow/time-tracking/admin", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "CREATE_DEBT", payload: { user_id: targetUserId, amount: Number(debtAmount), due_date: debtDueDate, description: debtDescription } })
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
                className="px-4 py-2 font-bold bg-clay text-white rounded-md hover:bg-clay/80 disabled:opacity-50"
              >
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminTimeTracking({ profile, online, locations }: { profile: Profile, online: boolean, locations: Location[] }) {
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
    onSuccess?: () => void;
  } | null>(null);
  const expenseLocations = useMemo(
    () => locations.filter((location) => location.active && profile.locationIds.includes(location.id)),
    [locations, profile.locationIds],
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
    status: 'APPROVED',
    expenseLocationId?: string,
    providedComment?: string,
  ) {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return false;
    }
    const comment = providedComment ?? prompt('ระบุเหตุผลการอนุมัติ:') ?? '';
    const res = await authFetch("/api/lanflow/time-tracking/admin", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: type === 'TRANSACTION' ? 'APPROVE_TRANSACTION' : type === 'LEAVE' ? 'APPROVE_LEAVE' : 'APPROVE_PAYROLL_SLIP',
        payload: type === 'TRANSACTION'
          ? { transaction_id: id, status, admin_comment: comment, expense_location_id: expenseLocationId }
          : type === 'LEAVE'
            ? { request_id: id, status, admin_comment: comment }
            : { slip_id: id, status, admin_comment: comment, expense_location_id: expenseLocationId }
      })
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      alert(json?.error || 'ไม่สามารถบันทึกการอนุมัติได้');
      return false;
    }
    load();
    return true;
  }

  function handleApprove(
    type: ApprovalType,
    id: string,
    expense?: { title: string; amount: number },
    onSuccess?: () => void,
  ) {
    if (expense) {
      if (expenseLocations.length === 0) {
        alert('ไม่พบสาขาที่คุณดูแลและยังเปิดใช้งานอยู่ จึงไม่สามารถอนุมัติรายจ่ายนี้ได้');
        return;
      }
      setPendingExpenseApproval({ type: type as 'TRANSACTION' | 'SLIP', id, ...expense, onSuccess });
      return;
    }
    void submitApproval(type, id, 'APPROVED').then((success) => {
      if (success) onSuccess?.();
    });
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
    const wageStr = prompt("ระบุค่าแรงรายวัน (บาท):", currentWage.toString());
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

  return (
    <div className="flex flex-col gap-6">
      {/* Admin's Personal Dashboard */}
      <div className="bg-sand/30 border-b border-black/10 pb-6 shadow-inner">
        <UserTimeTracking profile={profile} online={online} expenseLocations={expenseLocations} />
      </div>

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
              <th className="pb-3 font-semibold">พนักงาน</th>
              <th className="pb-3 font-semibold">ค่าแรง/วัน</th>
              <th className="pb-3 font-semibold">สถานะ</th>
              <th className="pb-3 font-semibold">จัดการเวลา</th>
              <th className="pb-3 font-semibold">แดชบอร์ด</th>
              <th className="pb-3 font-semibold">หนี้สิน</th>
              <th className="pb-3 font-semibold">สรุปสิ้นเดือน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
             {data?.users?.map((user: any) => {
               const activeSegment = user.time_segments?.find((s: any) => !s.end_time);
               const status = activeSegment ? 'RUNNING' : 'PAUSED';
               const debtRemainingAmount = Number(user.debt_remaining_amount || 0);
               const dashboardPendingCount = pendingCountForUser(data?.pendingTransactions, user.id)
                 + pendingCountForUser(data?.pendingLeaves, user.id);
               const payrollPendingCount = pendingCountForUser(data?.pendingSlips, user.id);
               return (
                <tr key={user.id} className={`hover:bg-sand/30 ${user.is_active === false ? 'opacity-70 bg-red-50/50' : ''}`}>
                  <td className="py-3">
                    {user.name}
                    {user.is_active === false && <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded border border-red-200">ถูกระงับ</span>}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <span>{formatCurrency(user.daily_wage || 0)}</span>
                      <button onClick={() => editWage(user.id, user.daily_wage || 0)} disabled={!online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="text-river hover:underline text-xs disabled:cursor-not-allowed disabled:opacity-40">แก้ไข</button>
                    </div>
                  </td>
                  <td className="py-3">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${status === 'RUNNING' ? 'bg-leaf/20 text-leaf' : 'bg-amber/20 text-amber'}`}>
                      {status}
                    </span>
                  </td>
                  <td className="py-3">
                    <button onClick={() => {
                      if (!online) {
                        alert(TIME_TRACKING_OFFLINE_MESSAGE);
                        return;
                      }
                      setManageTimeUser(user);
                    }} disabled={!online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="bg-river text-white px-3 py-1 rounded text-xs hover:bg-river/80 font-bold border border-black/10 shadow-sm disabled:cursor-not-allowed disabled:opacity-50">
                      คลิกเพื่อติ๊กเลือกวันทำงาน
                    </button>
                  </td>
                  <td className="py-3">
                     <button onClick={() => setViewDashboardUserId(user.id)} className="bg-ink/5 text-ink px-3 py-1 rounded text-xs hover:bg-ink/10 font-bold inline-flex items-center gap-1">
                       ดู Dashboard
                       {dashboardPendingCount > 0 && <span className="min-w-4 rounded-full bg-clay px-1.5 py-0.5 text-[10px] text-white">{dashboardPendingCount}</span>}
                     </button>
                  </td>
                  <td className="py-3">
                     <span className="text-clay font-bold">{formatCurrency(debtRemainingAmount)}</span>
                  </td>
                  <td className="py-3">
                    <button onClick={() => openPayroll(user)} disabled={!online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="bg-leaf text-white px-3 py-1 rounded text-xs hover:bg-leaf/80 font-bold shadow-sm disabled:cursor-not-allowed disabled:opacity-50 inline-flex items-center gap-1">
                      คำนวณเงินเดือน
                      {payrollPendingCount > 0 && <span className="min-w-4 rounded-full bg-white px-1.5 py-0.5 text-[10px] text-leaf">{payrollPendingCount}</span>}
                    </button>
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

      {viewDashboardUserId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-sand rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto relative shadow-2xl">
            <button onClick={() => setViewDashboardUserId(null)} className="absolute top-4 right-4 text-ink/50 hover:text-ink bg-white rounded-full"><XCircle size={32} /></button>
            <UserTimeTracking
              profile={profile}
              targetUserId={viewDashboardUserId}
              online={online}
              expenseLocations={expenseLocations}
              onApprove={(type, item) => handleApprove(
                type,
                item.id,
                type === 'TRANSACTION' && item.type === 'WITHDRAWAL'
                  ? { title: `เบิกเงินของ ${item.profiles?.name || 'พนักงาน'}`, amount: Number(item.amount) }
                  : undefined,
                () => load(),
              )}
            />
          </div>
        </div>
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
          profile={profile}
          online={online}
          onApprove={(slip) => handleApprove('SLIP', slip.id, Number(slip.net_pay) > 0 ? { title: `เงินเดือนของ ${payrollUser.name} เดือน ${slip.month}`, amount: Number(slip.net_pay) } : undefined, () => load())}
          onClose={() => setPayrollUser(null)}
          onRefresh={() => load()}
        />
      )}
      {pendingExpenseApproval && (
        <ExpenseLocationApprovalModal
          approval={pendingExpenseApproval}
          locations={expenseLocations}
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
      </div>
    </div>
  );
}

function ManageTimeModal({ user, admins, online, onClose, onSuccess, onRefresh }: { user: any, admins: any[], online: boolean, onClose: () => void, onSuccess: () => void, onRefresh: () => void }) {
  const [selectedDates, setSelectedDates] = useState<Record<string, 'FULL_DAY' | 'HALF_DAY'>>({});
  const [saving, setSaving] = useState(false);
  const [histories, setHistories] = useState<any[]>([]);
  const [lockedDates, setLockedDates] = useState<Map<string, 'SLIP' | 'DEBT'>>(new Map());

  const activeSegment = useMemo(() => user.time_segments?.find((s: any) => !s.end_time), [user]);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!activeSegment) {
      setTimeLeft(null);
      return;
    }

    const interval = setInterval(async () => {
      const now = new Date();
      const startTime = new Date(activeSegment.start_time);
      let targetDate = new Date(startTime);
      targetDate.setHours(15, 0, 0, 0);

      if (startTime.getTime() >= targetDate.getTime()) {
         targetDate.setDate(targetDate.getDate() + 1);
      }

      const diff = targetDate.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft(0);
        clearInterval(interval);

        // Call CUTOFF API
        try {
          await authFetch("/api/lanflow/time-tracking/admin", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'CUTOFF_TRACKING', payload: { user_id: user.id, cutoff_time: targetDate.toISOString() } })
          });
          onRefresh();
        } catch (e) {
          console.error(e);
        }
      } else {
        setTimeLeft(Math.floor(diff / 1000));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activeSegment, user.id, onRefresh]);

  async function toggleRealTimeTracking() {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    const isRunning = !!activeSegment;

    if (!isRunning) {
      const now = new Date();
      const target15 = new Date(now);
      target15.setHours(15, 0, 0, 0);

      if (now.getTime() >= target15.getTime()) {
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
    const now = new Date();

    // Build prefixes for current month and previous month
    const prefixes: string[] = [];
    for (let offset = 0; offset >= -1; offset--) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const y = String(d.getFullYear());
      prefixes.push(`${y}-${m}-`);
    }

    user.time_segments?.forEach((s: any) => {
      if (!s.end_time) return;
      const d = s.start_time.split('T')[0];
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
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + viewMonth, 1);
  }, [viewMonth]);

  const days = useMemo(() => {
    const now = new Date();
    const targetMonth = viewDate.getMonth();
    const targetYear = viewDate.getFullYear();
    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

    // For current month: only show up to today. For past months: show all days.
    const isCurrentMonth = targetMonth === now.getMonth() && targetYear === now.getFullYear();
    const maxDay = isCurrentMonth ? now.getDate() : daysInMonth;

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
      alert(`วันที่ ${d} ไม่สามารถแก้ไขได้\nเนื่องจาก${lockReason === 'SLIP' ? 'ได้ออกสลิปเงินเดือนของเดือนนี้ไปแล้ว' : 'ยอดค่าแรงวันนี้ถูกนำไปหักหนี้สินแล้ว'}`);
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

    const admin_comment = prompt("กรุณาระบุหมายเหตุการแก้ไขเวลา:");
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
      if (current !== target) {
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
        <button onClick={onClose} className="absolute top-4 right-4 text-ink/50 hover:text-ink"><XCircle size={28} /></button>
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
                เริ่มเมื่อ: {new Date(activeSegment.start_time).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
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
            {viewDate.toLocaleString('th-TH', { month: 'long', year: 'numeric' })}
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
            return (
              <button
                key={d}
                onClick={() => toggleDate(d)}
                disabled={!online || lockedDates.has(d)}
                title={!online ? TIME_TRACKING_OFFLINE_MESSAGE : undefined}
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
                    {lockedDates.get(d) === 'SLIP' ? '🔒 เงินเดือน' : '🔒 หักหนี้'}
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
           <button onClick={onClose} className="px-4 py-2 rounded-md font-semibold text-ink/70 hover:bg-sand">ยกเลิก</button>
           <button onClick={handleSubmit} disabled={saving || !online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="px-4 py-2 rounded-md font-bold bg-river text-white hover:bg-river/80 disabled:cursor-not-allowed disabled:opacity-50">
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
                      {new Date(h.created_at).toLocaleString('th-TH')} <span className="text-river">({adminName})</span>
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
          <button onClick={onClose} className="text-ink/50 hover:text-ink"><XCircle size={28} /></button>
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
                    <td className="py-3">{new Date(log.created_at).toLocaleString('th-TH')}</td>
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

function PayrollModal({ user, profile, online, onApprove, onClose, onRefresh }: { user: any, profile: Profile, online: boolean, onApprove: (slip: any) => void, onClose: () => void, onRefresh: () => void }) {
  const [slips, setSlips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  async function createSlip() {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    const month = prompt("ระบุเดือนที่ต้องการสร้างสลิปเงินเดือน (YYYY-MM):", new Date().toISOString().slice(0, 7));
    if (!month) return;

    setSaving(true);
    try {
      const res = await authFetch("/api/lanflow/time-tracking/admin", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CREATE_PAYROLL_SLIP', payload: { user_id: user.id, month } })
      });
      if (res.ok) {
        alert("สร้างสลิปเงินเดือนสำเร็จ");
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

  async function deleteSlip(slipId: string, month: string) {
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
        <button onClick={onClose} className="absolute top-4 right-4 text-ink/50 hover:text-ink bg-white rounded-full"><XCircle size={32} /></button>

        <div className="p-6 border-b border-black/10 bg-white rounded-t-xl flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-ink flex items-center gap-2">สลิปเงินเดือนของ {user.name}</h2>
          </div>
          <button
            onClick={createSlip}
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
                {slips.filter((slip: any) => slip.status !== 'REJECTED').map((slip: any) => {
                  const canDelete = (profile.role === 'super_admin' || slip.status !== 'APPROVED') && !slip.cancelled_at && new Date(slip.created_at).getMonth() === new Date().getMonth() && new Date(slip.created_at).getFullYear() === new Date().getFullYear();
                 const canApprove = slip.created_by !== profile.id || profile.role === 'super_admin';

                 return (
                  <li key={slip.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex flex-col">
                      <span className="font-bold text-lg">สลิปเดือน {slip.month}</span>
                      <div className="text-sm text-ink/70 flex gap-4 mt-1">
                        <span>ค่าแรง: <strong className="text-ink">{formatCurrency(slip.gross_pay)}</strong></span>
                        <span>หักหนี้/เบิก: <strong className="text-clay">{formatCurrency(slip.total_deductions)}</strong></span>
                        <span>ยอดสุทธิ: <strong className={slip.net_pay < 0 ? 'text-clay' : 'text-leaf'}>{formatCurrency(slip.net_pay)}</strong></span>
                      </div>

                       <span className="text-xs text-ink/50 mt-1">สร้างเมื่อ: {new Date(slip.created_at).toLocaleString('th-TH')}</span>
                       {Number(slip.net_pay) <= 0 && <span className="text-xs text-ink/55 mt-1">อนุมัติได้ แต่จะไม่สร้างค่าใช้จ่าย</span>}
                       {slip.admin_comment && <span className="text-xs text-river mt-1">หมายเหตุ: {slip.admin_comment}</span>}
                      {slip.approver?.name && <span className="text-xs text-leaf mt-1">ผู้ทำรายการ: {slip.approver.name}</span>}
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded-md ${slip.status === 'APPROVED' ? 'bg-leaf/20 text-leaf' : 'bg-ink/10 text-ink'}`}>
                        {slip.status}
                      </span>

                      <button
                        onClick={() => window.open(`/slip/${slip.id}`, '_blank')}
                        className="bg-river/10 text-river px-3 py-1.5 rounded-md text-sm font-bold hover:bg-river/20"
                      >
                        ดูสลิป
                      </button>

                       {slip.status === 'PENDING' && canApprove && (
                        <button onClick={() => onApprove(slip)} disabled={!online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="bg-leaf text-white px-3 py-1.5 rounded-md text-sm font-bold hover:bg-leaf/80 disabled:cursor-not-allowed disabled:opacity-50">อนุมัติ</button>
                       )}

                      {canDelete && (
                        <button onClick={() => deleteSlip(slip.id, slip.month)} disabled={saving || !online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="text-clay/70 hover:text-clay text-sm underline disabled:cursor-not-allowed disabled:opacity-40">
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
    </div>
  )
}
