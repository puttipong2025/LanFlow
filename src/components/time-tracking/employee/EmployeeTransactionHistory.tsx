import { XCircle } from "lucide-react";
import { formatBangkokDateTime } from "@/lib/bangkok-date";
import { formatCurrency } from "@/lib/format";
import type { Location } from "@/types";
import type { ApprovalType } from "../contracts";
import { paymentScopeReason, paymentSourceLabel, reportLockReason, TIME_TRACKING_OFFLINE_MESSAGE } from "../policy";

type PreviewSource = { type: "withdrawal" | "payroll"; id: string };
type Decision = (type: ApprovalType, item: any, refreshOwner: () => Promise<void>) => Promise<boolean>;

export function EmployeeTransactionHistory({
  data, transactions, adjustmentSummaryByWithdrawal, adjustmentsByWithdrawal, online, saving,
  canDecideItems, canManageTime, isSelf, globalManager, expenseLocations, onApprove, onReject,
  loadData, runApprovalAction, onPreview, onChangePayment, onAdjust, onDelete, onWithdrawAdjustment,
}: {
  data: any; transactions: any[]; adjustmentSummaryByWithdrawal: Map<any, any>; adjustmentsByWithdrawal: Map<string, any[]>;
  online: boolean; saving: boolean; canDecideItems: boolean; canManageTime: boolean; isSelf: boolean;
  globalManager: boolean; expenseLocations: Location[]; onApprove?: Decision; onReject?: Decision;
  loadData: () => Promise<void>; runApprovalAction: (action: () => Promise<boolean>) => Promise<void>;
  onPreview: (source: PreviewSource) => void; onChangePayment: (item: any) => Promise<void>;
  onAdjust: (item: any) => void; onDelete: (item: any) => Promise<void>; onWithdrawAdjustment: (id: string) => Promise<void>;
}) {
  return (
      <div className="bg-white p-4 rounded-xl border border-clay/30 shadow-sm mt-4">
        <h3 className="font-semibold text-clay mb-4">ประวัติสร้างหนี้สิน/เบิกเงิน</h3>
        {transactions.length === 0 ? (
          <p className="text-sm text-ink/50">ไม่มีประวัติหนี้สิน/เบิกเงิน</p>
        ) : (
          <ul className="divide-y divide-black/5">
             {transactions.map((t: any) => {
               const cancelled = !!t.cancelled_at;
               const summary: any = adjustmentSummaryByWithdrawal.get(t.id);
               const currentAmount = t.type === 'WITHDRAWAL' ? Number(summary?.latestTarget ?? t.amount) : Number(t.amount);
               const adjustmentHistory = adjustmentsByWithdrawal.get(t.id) || [];
               return (
                <li key={t.id} className={`py-3 flex flex-col gap-3 border-b border-black/5 last:border-0 ${t.type === 'DEBT' ? 'bg-clay/5 -mx-4 px-4' : t.type === 'WITHDRAWAL' ? 'bg-amber/5 -mx-4 px-4' : ''}`}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-col">
                    <span className={t.type === 'DEBT' ? 'text-clay font-bold' : t.type === 'WITHDRAWAL' ? 'text-amber font-bold' : 'text-river font-bold'}>
                      {t.type === 'DEBT' ? 'สร้างหนี้สิน' : t.type === 'WITHDRAWAL' ? 'เบิกเงิน' : 'หักหนี้อัตโนมัติ'}{' '}
                      {formatCurrency(currentAmount)}
                    </span>
                    {t.description && <span className="text-sm text-ink/70 mt-1">{t.description}</span>}
                    {t.effective_date && <span className="text-xs text-clay mt-1 font-semibold">วันที่รายการ: {new Date(`${t.effective_date}T00:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}</span>}
                    {!cancelled && t.status === 'APPROVED' && Number(t.remaining_amount || 0) > 0 && (
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
                      <span className="text-xs text-ink/50">วันที่อนุมัติ: {t.approved_at ? formatBangkokDateTime(t.approved_at) : (t.updated_at ? formatBangkokDateTime(t.updated_at) : (t.created_at ? formatBangkokDateTime(t.created_at) : '-'))}</span>
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
                  <div className="flex flex-wrap items-center gap-2 self-start sm:justify-end">
                    <span className={`text-xs font-bold px-2 py-1 rounded-md ${!cancelled && t.status === 'APPROVED' ? 'bg-success/15 text-success' : 'bg-ink/10 text-ink'}`}>{cancelled ? 'ยกเลิก' : t.status}</span>
                    {!cancelled && t.type === 'WITHDRAWAL' && (t.status === 'PENDING' || t.status === 'APPROVED') && (
                      <button
                        type="button"
                        onClick={() => onPreview({ type: "withdrawal", id: t.id })}
                        disabled={!online}
                        title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE}
                        className="focus-ring rounded-md bg-river px-3 py-1.5 text-sm font-semibold text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        ดูสลิป
                      </button>
                    )}
                    {!cancelled && canDecideItems && t.status === 'PENDING' && onApprove && (
                      <button onClick={() => void runApprovalAction(() => onApprove('TRANSACTION', t, loadData))} disabled={saving || !online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="rounded bg-success px-3 py-1 font-bold text-white hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-50">อนุมัติ</button>
                    )}
                    {!cancelled && canDecideItems && t.status === 'PENDING' && onReject && (
                      <button onClick={() => void runApprovalAction(() => onReject('TRANSACTION', t, loadData))} disabled={saving || !online} title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE} className="rounded bg-danger px-3 py-1 font-bold text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50">ปฏิเสธ</button>
                    )}
                    {t.type === 'WITHDRAWAL' && t.status === 'APPROVED' && (
                      <div className="flex min-w-0 flex-col items-start gap-1">
                        <span className="text-pretty text-xs font-semibold text-ink/70">{paymentSourceLabel(t)}</span>
                        {!cancelled && canManageTime && <button onClick={() => onChangePayment(t)} disabled={saving || !online || Boolean(t.report_lock_no) || Boolean(paymentScopeReason(t, globalManager, expenseLocations))} title={reportLockReason(t) ?? paymentScopeReason(t, globalManager, expenseLocations) ?? undefined} className="rounded-md bg-river px-3 py-1 text-sm font-semibold text-white hover:bg-river/90 disabled:opacity-40">เปลี่ยนวิธีจ่าย</button>}
                      </div>
                    )}
                    {!cancelled && t.type === 'WITHDRAWAL' && t.status === 'APPROVED' && t.report_lock_no && (
                      <button
                        type="button"
                        onClick={() => onAdjust(t)}
                        disabled={saving || !online || Boolean(summary?.pendingAdjustmentId)}
                        title={summary?.pendingAdjustmentId ? "มีคำขอปรับยอดรออนุมัติอยู่แล้ว" : (online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE)}
                        className="focus-ring rounded-md bg-commit px-3 py-1.5 text-sm font-semibold text-white hover:bg-commit/90 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        ปรับยอดเบิก
                      </button>
                    )}
                    {!cancelled && (canManageTime || (isSelf && t.type === 'WITHDRAWAL' && t.status === 'PENDING')) && (
                      <button onClick={() => onDelete(t)} disabled={saving || !online || Boolean(t.report_lock_no) || Boolean(paymentScopeReason(t, globalManager, expenseLocations))} title={reportLockReason(t) ?? paymentScopeReason(t, globalManager, expenseLocations) ?? (online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE)} className="inline-flex h-10 items-center gap-1 rounded-md bg-danger px-2 text-sm font-semibold text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-40">
                        <XCircle size={18} />
                        ลบ
                      </button>
                    )}
                  </div>
                  </div>
                  {adjustmentHistory.length > 0 && (
                    <div className="rounded-lg border border-black/10 bg-white/75 p-3">
                      <p className="text-pretty text-xs font-bold text-ink/65">ประวัติปรับยอดเบิก</p>
                      <ul className="mt-2 space-y-2">
                        {adjustmentHistory.map((adjustment: any) => {
                          const base = Number(adjustment.adjustment_base_amount) || 0;
                          const target = Number(adjustment.amount) || 0;
                          const delta = target - base;
                          return (
                            <li key={adjustment.id} className="rounded-md border border-black/5 bg-white px-3 py-2 text-sm">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                  <p className="text-pretty font-semibold text-ink">
                                    {formatCurrency(base)} → {formatCurrency(target)} · {delta > 0 ? "เพิ่ม" : "คืน"} {formatCurrency(Math.abs(delta))}
                                  </p>
                                  <p className="mt-1 text-pretty text-xs text-ink/55">
                                    วันที่รายการ: {adjustment.approved_at
                                      ? formatBangkokDateTime(adjustment.approved_at)
                                      : adjustment.created_at ? formatBangkokDateTime(adjustment.created_at) : "-"} · {adjustment.status}
                                  </p>
                                  {adjustment.description && <p className="mt-1 text-pretty text-xs text-ink/70">{adjustment.description}</p>}
                                </div>
                                <div className="flex shrink-0 gap-2">
                                  {!cancelled && canDecideItems && adjustment.status === 'PENDING' && onApprove && (
                                    <button type="button" onClick={() => void runApprovalAction(() => onApprove('TRANSACTION', { ...adjustment, type: 'ADJUSTMENT', source_expense_location_id: t.expense_location_id ?? null }, loadData))} disabled={saving || !online} className="rounded-md bg-success px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">อนุมัติ</button>
                                  )}
                                  {!cancelled && canDecideItems && adjustment.status === 'PENDING' && onReject && (
                                    <button type="button" onClick={() => void runApprovalAction(() => onReject('TRANSACTION', { ...adjustment, type: 'ADJUSTMENT' }, loadData))} disabled={saving || !online} className="rounded-md bg-danger px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">ปฏิเสธ</button>
                                  )}
                                  {!cancelled && !canManageTime && isSelf && adjustment.status === 'PENDING' && (
                                    <button type="button" onClick={() => void onWithdrawAdjustment(adjustment.id)} disabled={saving || !online} className="rounded-md bg-actionSecondary px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">ถอนคำขอ</button>
                                  )}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </li>
               );
             })}
          </ul>
        )}
      </div>
  );
}

