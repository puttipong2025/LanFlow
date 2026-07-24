"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownUp,
  CheckCircle2,
  Edit3,
  Plus,
  Trash2,
  WifiOff,
} from "lucide-react";
import type { MoneyTransfer, Profile } from "@/types";
import { formatCurrency } from "@/lib/format";

import { useMoneyTransfers } from "@/hooks/useMoneyTransfers";
import { useRubberBills } from "@/hooks/useRubberBills";
import { useOcrTickets } from "@/hooks/useOcrTickets";
import { useCustomers } from "@/hooks/useCustomers";
import { useRubberBillApprovals } from "@/hooks/useRubberBillApprovals";

import { CustomerTransferForm } from "./money-transfer/CustomerTransferForm";
import { TransportTransferForm } from "./money-transfer/TransportTransferForm";
import { BranchTransferForm } from "./money-transfer/BranchTransferForm";

type Props = {
  locationId: string;
  online: boolean;
  profile: Profile;
  initialEditTransferId?: string | null;
  onInitialEditTransferHandled?: () => void;
};

export function MoneyTransferModule({
  locationId,
  online,
  profile,
  initialEditTransferId,
  onInitialEditTransferHandled,
}: Props) {
  const { transfers, addTransfer, updateTransfer, deleteTransfer } = useMoneyTransfers(locationId);
  const { bills } = useRubberBills(locationId, profile.id);
  const { markers: rubberBillApprovalMarkers } = useRubberBillApprovals({ locationId });
  const { ocrTickets } = useOcrTickets(locationId);
  const { customers } = useCustomers();
  const billsWithApprovalState = useMemo(() => {
    const pendingBillIds = new Set(
      rubberBillApprovalMarkers
        .map((marker) => marker.billId)
        .filter((id): id is string => Boolean(id))
    );
    return bills.map((bill) => (
      pendingBillIds.has(bill.id) ? { ...bill, approvalPending: true } : bill
    ));
  }, [bills, rubberBillApprovalMarkers]);

  const usedSourceIds = useMemo(() => {
    const set = new Set<string>();
    transfers.forEach(t => {
      t.items?.forEach(i => set.add(i.sourceId));
    });
    return set;
  }, [transfers]);

  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [activeFormType, setActiveFormType] = useState<'customer' | 'transport' | 'branch' | null>(null);
  const [editTransfer, setEditTransfer] = useState<MoneyTransfer | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const offlineMessage = "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น";
  const branchTransferFormMode =
    editTransfer?.transferType === "branch" && editTransfer.targetLocationId && editTransfer.locationId !== editTransfer.targetLocationId
      ? "branch-to-branch"
      : "head-office-to-branch";

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const handleSave = useCallback(
    (transfer: MoneyTransfer) => {
      if (!online) {
        setToastMsg(offlineMessage);
        return;
      }
      if (editTransfer) {
        updateTransfer.mutate(transfer, {
          onSuccess: () => {
            setActiveFormType(null);
            setEditTransfer(null);
            setToastMsg("บันทึกรายการโอนเงินสำเร็จ");
          },
          onError: (err) => {
            console.error("Failed to update transfer:", err);
            setToastMsg("เกิดข้อผิดพลาดในการบันทึก");
          }
        });
      } else {
        addTransfer.mutate(transfer, {
          onSuccess: () => {
            setActiveFormType(null);
            setEditTransfer(null);
            setToastMsg("บันทึกรายการโอนเงินสำเร็จ");
          },
          onError: (err) => {
            console.error("Failed to add transfer:", err);
            setToastMsg("เกิดข้อผิดพลาดในการบันทึก");
          }
        });
      }
    },
    [editTransfer, addTransfer, updateTransfer, online, offlineMessage]
  );

  const handleDeleteConfirm = useCallback(() => {
    if (!online) {
      setToastMsg(offlineMessage);
      return;
    }
    if (deleteConfirmId) {
      deleteTransfer.mutate(deleteConfirmId, {
        onSuccess: () => {
          setDeleteConfirmId(null);
          setToastMsg("ลบรายการโอนเงินสำเร็จ");
        },
        onError: (err) => {
          console.error("Failed to delete transfer:", err);
          setToastMsg("เกิดข้อผิดพลาดในการลบ");
        }
      });
    }
  }, [deleteConfirmId, deleteTransfer, online, offlineMessage]);

  const handleEdit = useCallback((t: MoneyTransfer) => {
    if (!online) {
      setToastMsg(offlineMessage);
      return;
    }
    setEditTransfer(t);
    setActiveFormType(t.transferType === 'transport' ? 'transport' : t.transferType === 'branch' ? 'branch' : 'customer');
  }, [online, offlineMessage]);

  useEffect(() => {
    if (!initialEditTransferId) return;
    const transfer = transfers.find(t => t.id === initialEditTransferId);
    if (!transfer) return;
    handleEdit(transfer);
    onInitialEditTransferHandled?.();
  }, [initialEditTransferId, transfers, handleEdit, onInitialEditTransferHandled]);

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 animate-pulse rounded-lg bg-leaf px-4 py-2 text-sm font-semibold text-white shadow-lg">
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">
            <ArrowDownUp size={22} className="mr-2 inline-block text-river" />
            ระบบโอนเงิน
          </h2>
          <p className="mt-1 text-sm text-ink/60">
            สร้างรายการโอนเงินจากบิลยางและใบชั่ง พร้อมอัปโหลดสลิป
          </p>
        </div>
        {!activeFormType && (
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                if (!online) {
                  setToastMsg(offlineMessage);
                  return;
                }
                setShowTypeSelector(!showTypeSelector);
              }}
              disabled={!online}
              title={online ? undefined : offlineMessage}
              className="focus-ring flex items-center gap-1.5 rounded-md bg-river px-4 py-2.5 text-sm font-semibold text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {online ? <Plus size={16} /> : <WifiOff size={16} />} สร้างรายการโอน
            </button>
            {showTypeSelector && (
              <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-lg border border-black/10 bg-white py-1 shadow-xl">
                <button type="button" onClick={() => { setActiveFormType('customer'); setShowTypeSelector(false); setEditTransfer(null); }} className="w-full px-4 py-2.5 text-left text-sm font-semibold text-ink hover:bg-river/10">💰 โอนให้ลูกค้า</button>
                <button type="button" onClick={() => { setActiveFormType('transport'); setShowTypeSelector(false); setEditTransfer(null); }} className="w-full px-4 py-2.5 text-left text-sm font-semibold text-ink hover:bg-amber/10">🚛 จ่ายค่าขนส่ง</button>
                <button type="button" onClick={() => { setActiveFormType('branch'); setShowTypeSelector(false); setEditTransfer(null); }} className="w-full px-4 py-2.5 text-left text-sm font-semibold text-ink hover:bg-leaf/10">🏢 โอนให้สาขา</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Forms */}
      {activeFormType === 'customer' && (
        <CustomerTransferForm
          locationId={locationId}
          online={online}
          profile={profile}
          bills={billsWithApprovalState}
          ocrTickets={ocrTickets}
          customers={customers}
          usedSourceIds={usedSourceIds}
          editTransfer={editTransfer}
          onSave={handleSave}
          onCancel={() => {
            setActiveFormType(null);
            setEditTransfer(null);
          }}
        />
      )}
      {activeFormType === 'transport' && (
        <TransportTransferForm
          locationId={locationId}
          online={online}
          editTransfer={editTransfer}
          onSave={handleSave}
          onCancel={() => {
            setActiveFormType(null);
            setEditTransfer(null);
          }}
        />
      )}
      {activeFormType === 'branch' && (
        <BranchTransferForm
          locationId={locationId}
          mode={branchTransferFormMode}
          editTransfer={editTransfer}
          onSave={handleSave}
          onCancel={() => {
            setActiveFormType(null);
            setEditTransfer(null);
          }}
        />
      )}

      {/* Transfer List */}
      {transfers.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-panel">
          <div className="flex items-center justify-between border-b border-black/5 bg-field/60 px-5 py-3">
            <h3 className="font-bold text-ink">
              <CheckCircle2 size={16} className="mr-1.5 inline-block text-river" />
              รายการโอนเงิน ({transfers.length} รายการ)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/5 bg-field/30 text-left text-xs font-bold uppercase tracking-wider text-ink/50">
                  <th className="px-3 py-3">#</th>
                  <th className="px-3 py-3">ประเภท</th>
                  <th className="px-3 py-3">ปลายทาง</th>
                  <th className="px-3 py-3">เลขบัญชี</th>
                  <th className="px-3 py-3 text-right">ยอดจ่าย</th>
                  <th className="px-3 py-3 text-center">สลิป</th>
                  <th className="px-3 py-3 text-center">รายการ</th>
                  <th className="px-3 py-3">สถานะ</th>
                  <th className="px-3 py-3">สร้างโดย</th>
                  <th className="px-3 py-3">วันที่สร้าง</th>
                  <th className="px-3 py-3 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t, idx) => (
                  <tr key={t.id} className="border-b border-black/5 transition-colors hover:bg-mint/20">
                    <td className="px-3 py-2.5 font-mono text-ink/40">{idx + 1}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${
                        t.transferType === "customer" 
                          ? "bg-blue-100 text-blue-700" 
                          : t.transferType === "transport"
                          ? "bg-orange-100 text-orange-700"
                          : t.transferType === "branch"
                          ? "bg-purple-100 text-purple-700"
                          : "bg-gray-100 text-gray-700"
                      }`}>
                        {t.transferType === "customer"
                          ? "ลูกค้า"
                          : t.transferType === "transport"
                          ? "รถขนส่ง"
                          : t.transferType === "branch"
                          ? "ให้สาขา"
                          : "ไม่ระบุ"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-ink">{t.customerName ?? t.transportStaffName ?? t.targetLocationName ?? "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-ink/70">{t.accountNumber ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-river">
                      {formatCurrency(t.netAmountToPay)}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="rounded-full bg-river/10 px-2 py-0.5 text-xs font-bold text-river">
                        {t.slips?.length ?? 0}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="rounded-full bg-leaf/10 px-2 py-0.5 text-xs font-bold text-leaf">
                        {t.items?.length ?? 0}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          t.transferStatus === "paid"
                            ? "bg-leaf/10 text-leaf"
                            : t.transferStatus === "branch_and_transfer"
                            ? "bg-leaf/10 text-leaf"
                            : t.transferStatus === "overpaid"
                            ? "bg-clay/10 text-clay"
                            : t.transferStatus === "partial"
                            ? "bg-amber/20 text-amber"
                            : t.transferStatus === "advance_payment"
                            ? "bg-purple-500/20 text-purple-600"
                            : t.transferStatus === "cancelled"
                            ? "bg-clay/10 text-clay"
                            : "bg-amber/20 text-amber"
                        }`}
                      >
                        {t.transferStatus === "paid" ? "จ่ายครบ"
                          : t.transferStatus === "branch_and_transfer" ? "โอน+สาขาจ่าย"
                          : t.transferStatus === "overpaid" ? "ชำระเกิน"
                          : t.transferStatus === "partial" ? "ค้างจ่าย"
                          : t.transferStatus === "advance_payment" ? "จ่ายล่วงหน้า"
                          : t.transferStatus === "cancelled" ? "ยกเลิก"
                          : "รอโอน"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-ink/60">{t.createdByName ?? "—"}</td>
                    <td className="px-3 py-2.5 text-sm text-ink/60">
                      {t.createdAt ? new Date(t.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleEdit(t)}
                          disabled={!online || Boolean(t.reportLockNo)}
                          className="grid h-7 w-7 place-items-center rounded-md text-ink/50 hover:bg-mint hover:text-leaf disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink/50"
                          title={t.reportLockNo ? `ล็อกโดยรายงาน ${t.reportLockNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน` : online ? "แก้ไข" : offlineMessage}
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (t.reportLockNo) {
                              setToastMsg(`ล็อกโดยรายงาน ${t.reportLockNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน`);
                              return;
                            }
                            if (!online) {
                              setToastMsg(offlineMessage);
                              return;
                            }
                            setDeleteConfirmId(t.id);
                          }}
                          disabled={!online || Boolean(t.reportLockNo)}
                          className="grid h-7 w-7 place-items-center rounded-md text-ink/50 hover:bg-clay/10 hover:text-clay disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink/50"
                          title={t.reportLockNo ? `ล็อกโดยรายงาน ${t.reportLockNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน` : online ? "ลบ" : offlineMessage}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {transfers.length === 0 && !activeFormType && (
        <div className="rounded-xl border border-dashed border-black/10 bg-white/60 px-8 py-12 text-center">
          <ArrowDownUp size={48} className="mx-auto mb-3 text-ink/20" />
          <p className="text-lg font-semibold text-ink/40">ยังไม่มีรายการโอนเงิน</p>
          <p className="mt-1 text-sm text-ink/30">กดปุ่ม &quot;สร้างรายการโอน&quot; เพื่อเริ่มต้น</p>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDeleteConfirmId(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-ink">ยืนยันการลบ</h3>
            <p className="mt-2 text-sm text-ink/70">คุณแน่ใจหรือไม่ว่าต้องการลบรายการโอนเงินนี้? บิลยาง/ใบชั่งที่เลือกไว้จะสามารถเลือกใช้ใหม่ได้</p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteConfirmId(null)} className="focus-ring rounded-md border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-field">
                ยกเลิก
              </button>
              <button type="button" onClick={handleDeleteConfirm} disabled={!online} title={online ? undefined : offlineMessage} className="focus-ring rounded-md bg-clay px-4 py-2 text-sm font-semibold text-white hover:bg-clay/90 disabled:cursor-not-allowed disabled:opacity-50">
                ลบ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
