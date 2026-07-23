import { ArrowRightLeft, Edit3, ExternalLink, Plus, Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { formatCurrency } from "@/lib/format";
import { useIncomeExpense } from "@/hooks/useIncomeExpense";
import { useIncomeExpenseApprovals } from "@/hooks/useIncomeExpenseApprovals";
import { useCustomers } from "@/hooks/useCustomers";
import { useMoneyTransfers } from "@/hooks/useMoneyTransfers";
import { useCashBranchTransfers } from "@/hooks/useCashBranchTransfers";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePerRecordSyncRetry } from "@/hooks/usePerRecordSyncRetry";
import { getOfflineSyncedActionBlockReason } from "@/lib/record-action-locks";
import { canAccessSourceLocation, canManageSystemFeatures } from "@/lib/permissions";
import { INCOME_EXPENSE_FEED_QUERY_KEY } from "@/lib/income-expense/query-keys";

import type { IncomeExpense, Location, MoneyTransfer, Profile } from "@/types";
import { IconButton } from "@/components/shared/IconButton";
import { SyncStatusBadge } from "@/components/shared/SyncStatusBadge";
import { BranchTransferForm } from "@/components/money-transfer/BranchTransferForm";
import { CashBranchTransferCreateModal, CashBranchTransferDetails, CashBranchTransferReceiveModal } from "./CashBranchTransferModal";
import { getIncomeExpenseDisplayNo } from "./income-expense-display";
import { IncomeExpenseApprovalModal } from "./IncomeExpenseApprovalModal";
import { IncomeExpenseModal } from "./IncomeExpenseModal";

export function IncomeExpenseModule({
  selectedLocation,
  profile,
  canCreateMoneyTransfer = true,
  onOpenMoneyTransferSource,
  onOpenRubberBillSource,
  onOpenOcrTicketSource,
  onOpenTimeTrackingSource,
}: {
  selectedLocation: Location;
  profile: Profile;
  canCreateMoneyTransfer?: boolean;
  onOpenMoneyTransferSource?: (transferId: string, locationId: string) => void;
  onOpenRubberBillSource?: (locationId: string, billDate?: string) => void;
  onOpenOcrTicketSource?: (locationId: string, ticketDate?: string) => void;
  onOpenTimeTrackingSource?: (sourceId: string, sourceType: "time_tracking_withdrawal" | "payroll_slip") => void;
}) {
  const queryClient = useQueryClient();
  const {
    transactions,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    hasMore,
    isLoadingMore,
    loadMore,
  } = useIncomeExpense(selectedLocation.id, profile.id);
  const isOnline = useOnlineStatus();
  const canManageSystem = canManageSystemFeatures(profile);
  const {
    pendingCount: approvalRequestsPendingCount,
    submitForApprovalIfNeeded,
  } = useIncomeExpenseApprovals({ includePendingCount: canManageSystem && isOnline });
  const { customers, addCustomer, updateCustomer } = useCustomers();
  const { addTransfer } = useMoneyTransfers(selectedLocation.id, { enabled: canCreateMoneyTransfer });
  const cashTransfers = useCashBranchTransfers(selectedLocation.id);
  const pendingCashReceipts = cashTransfers.transfers.filter((transfer) => transfer.targetLocationId === selectedLocation.id && transfer.status === "pending_receipt");
  const { retrySyncEvent, isRetrying } = usePerRecordSyncRetry(selectedLocation.id, profile.id);
  const ledgerTransactions = transactions;
  const nextNumber = String(ledgerTransactions.length + 1);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"income" | "expense">("income");
  const [editingTransaction, setEditingTransaction] = useState<IncomeExpense | null>(null);
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [branchTransferModalOpen, setBranchTransferModalOpen] = useState(false);
  const [branchTransferMode, setBranchTransferMode] = useState<"cash" | "bank">("cash");
  const [cashReceiptId, setCashReceiptId] = useState<string | null>(null);
  const [cashDetailsId, setCashDetailsId] = useState<string | null>(null);
  const [cashEditingId, setCashEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const visibleTransactions = search.trim()
    ? ledgerTransactions.filter((transaction) =>
      `${transaction.number} ${transaction.title} ${transaction.createdByName}`
        .toLocaleLowerCase("th-TH")
        .includes(search.trim().toLocaleLowerCase("th-TH"))
    )
    : ledgerTransactions;

  function openAdd(type: "income" | "expense") {
    setModalType(type);
    setEditingTransaction(null);
    setModalOpen(true);
  }

  function openEdit(transaction: IncomeExpense) {
    const blockReason = getActionBlockReason(transaction);
    if (blockReason) {
      toast.error(blockReason);
      return;
    }
    setModalType(transaction.type);
    setEditingTransaction(transaction);
    setModalOpen(true);
  }

  function getActionBlockReason(transaction: IncomeExpense) {
    if (transaction.relationLockReason) return transaction.relationLockReason;
    return getOfflineSyncedActionBlockReason(transaction, isOnline);
  }

  function openBranchTransfer() {
    if (!isOnline) {
      toast.error("การโยกเงินไปสาขาอื่นต้องออนไลน์ก่อน");
      return;
    }
    setBranchTransferMode("cash");
    setBranchTransferModalOpen(true);
  }

  function handleBranchTransferSave(transfer: MoneyTransfer) {
    addTransfer.mutate(transfer, {
      onSuccess: () => {
        setBranchTransferModalOpen(false);
        queryClient.invalidateQueries({ queryKey: [INCOME_EXPENSE_FEED_QUERY_KEY] });
        toast.success("บันทึกรายการโยกเงินไปสาขาอื่นแล้ว");
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : "บันทึกรายการโยกเงินไม่สำเร็จ");
      },
    });
  }

  async function confirmDelete(transaction: IncomeExpense) {
    const blockReason = getActionBlockReason(transaction);
    if (blockReason) {
      toast.error(blockReason);
      return;
    }
    if (window.confirm(`ลบรายการ ${transaction.number} ใช่ไหม?`)) {
      try {
        await deleteTransaction({
          clientTempId: transaction.clientTempId,
          deletedByName: profile.name,
          deletedByPhone: profile.phone,
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "ลบรายการไม่สำเร็จ");
      }
    }
  }

  async function retryFailedSync(transaction: IncomeExpense) {
    try {
      await retrySyncEvent({ entity: "income_expense", id: transaction.clientTempId });
      toast.success("ซิงก์รายการสำเร็จ");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ซิงก์รายการไม่สำเร็จ");
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-md border border-black/10 bg-white p-4 shadow-panel lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-bold text-ink">CRUD รายรับ-รายจ่าย · {selectedLocation.name}</h2>
          <p className="text-sm text-ink/60">เพิ่มผ่าน modal และจัดการรายการจากตาราง</p>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ค้นหาในรายการที่โหลดแล้ว"
            className="mt-3 h-9 w-full max-w-xs rounded-md border border-black/15 px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            onClick={() => openAdd("income")}
            className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-leaf px-4 font-semibold text-white"
          >
            <Plus size={18} />
            เพิ่มรายรับ
          </button>
          <button
            type="button"
            onClick={() => openAdd("expense")}
            className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-clay px-4 font-semibold text-white"
          >
            <Plus size={18} />
            เพิ่มรายจ่าย
          </button>
          {canAccessSourceLocation(profile, selectedLocation.id) && (
            <button
              type="button"
              onClick={openBranchTransfer}
              disabled={!isOnline}
              title={isOnline ? "โยกเงินไปสาขาอื่น" : "โยกเงินต้องออนไลน์ก่อน"}
              className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-river px-4 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <ArrowRightLeft size={18} />
              {isOnline ? "โยกเงินไปสาขาอื่น" : "โยกเงินใช้ได้เมื่อออนไลน์"}
            </button>
          )}
          {pendingCashReceipts.length > 0 && (
            <button type="button" disabled={!isOnline} onClick={() => setCashReceiptId(pendingCashReceipts[0]?.id ?? null)} className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-amber px-4 font-semibold text-ink disabled:cursor-not-allowed disabled:bg-slate-300">
              <ArrowRightLeft size={18} /> รอรับเงิน ({pendingCashReceipts.length})
            </button>
          )}
          {canManageSystem && (
            <button
              type="button"
              onClick={() => {
                if (!isOnline) {
                  toast.error("ตั้งค่าและอนุมัติรับ-จ่ายใช้ได้เมื่อออนไลน์เท่านั้น");
                  return;
                }
                setApprovalModalOpen(true);
              }}
              disabled={!isOnline}
              title={isOnline ? "ตั้งค่าและอนุมัติรับ-จ่าย" : "ตั้งค่าและอนุมัติรับ-จ่ายใช้ได้เมื่อออนไลน์เท่านั้น"}
              className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Settings size={18} />
              ตั้งค่าและอนุมัติรับ-จ่าย
              {approvalRequestsPendingCount > 0 && (
                <span
                  aria-label={`รออนุมัติ ${approvalRequestsPendingCount} รายการ`}
                  className="ml-1 rounded-full bg-amber px-1.5 py-0.5 text-[10px] font-bold text-ink"
                >
                  {approvalRequestsPendingCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {pendingCashReceipts.length > 0 && (
        <section className="rounded-md border border-amber/40 bg-amber/10 p-3">
          <h3 className="font-bold text-ink">คิวรอตรวจรับเงินสด</h3>
          <div className="mt-2 space-y-2">
            {pendingCashReceipts.map((transfer) => <button key={transfer.id} type="button" disabled={!isOnline} onClick={() => setCashReceiptId(transfer.id)} className="flex w-full items-center justify-between rounded bg-white px-3 py-2 text-left text-sm disabled:opacity-60"><span>จาก {transfer.createdByName} · {formatCurrency(transfer.sentTotal)}</span><span className="font-semibold text-river">ตรวจรับ</span></button>)}
          </div>
        </section>
      )}

      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-ink/60">
                <th className="py-2">เลขที่</th>
                <th>เลขบิล</th>
                <th>วันที่</th>
                <th>ประเภท</th>
                <th>รายการ</th>
                <th>หมวด</th>
                <th>จำนวนเงิน</th>
                <th>ผู้บันทึก</th>
                <th>Sync</th>
                <th className="text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleTransactions.map((transaction) => {
                const actionBlockReason = getActionBlockReason(transaction);
                const actionsDisabled = Boolean(actionBlockReason);
                const sourceLocationId = transaction.relationSourceLocationId ?? transaction.locationId;
                const cashTransferId = transaction.relationSourceId?.startsWith("cash:") ? transaction.relationSourceId.slice(5) : null;
                const canOpenMoneyTransferSource = Boolean(
                  transaction.relationSourceType === "money_transfer" &&
                  transaction.relationSourceId &&
                  onOpenMoneyTransferSource &&
                  canAccessSourceLocation(profile, sourceLocationId)
                );
                const canOpenRubberBillSource = Boolean(
                  transaction.relationSourceType === "rubber_bill_daily" &&
                  onOpenRubberBillSource &&
                  canAccessSourceLocation(profile, sourceLocationId)
                );
                const canOpenOcrTicketSource = Boolean(
                  transaction.relationSourceType === "ocr_ticket_daily" &&
                  onOpenOcrTicketSource &&
                  canAccessSourceLocation(profile, sourceLocationId)
                );
                const canOpenTimeTrackingSource = Boolean(
                  (transaction.relationSourceType === "time_tracking_withdrawal" || transaction.relationSourceType === "payroll_slip") &&
                  transaction.relationSourceId &&
                  onOpenTimeTrackingSource &&
                  (profile.role === "admin" || profile.role === "super_admin")
                );
                const canOpenSource = Boolean(cashTransferId) || canOpenMoneyTransferSource || canOpenRubberBillSource || canOpenOcrTicketSource || canOpenTimeTrackingSource;

                function openRelationSource() {
                  if (cashTransferId) { setCashDetailsId(cashTransferId); return; }
                  if (canOpenMoneyTransferSource) {
                    onOpenMoneyTransferSource?.(transaction.relationSourceId!, sourceLocationId);
                    return;
                  }
                  if (canOpenRubberBillSource) {
                    onOpenRubberBillSource?.(sourceLocationId, transaction.relationSourceDate);
                    return;
                  }
                  if (canOpenOcrTicketSource) {
                    onOpenOcrTicketSource?.(sourceLocationId, transaction.relationSourceDate);
                    return;
                  }
                  if (canOpenTimeTrackingSource) {
                    onOpenTimeTrackingSource?.(
                      transaction.relationSourceId!,
                      transaction.relationSourceType as "time_tracking_withdrawal" | "payroll_slip",
                    );
                  }
                }

                return (
                <tr key={transaction.id} className="border-b border-black/5 hover:bg-field/50">
                  <td className="py-3 font-semibold">{getIncomeExpenseDisplayNo(transaction)}</td>
                  <td className="text-xs text-ink/55">
                    <div className="flex flex-col gap-0.5">
                      <span>{getIncomeExpenseDisplayNo(transaction)}</span>
                      {transaction.serverBillNo ? (
                        transaction.localBillNo !== transaction.serverBillNo && (
                          <span className="text-[10px] text-leaf font-semibold">ซิงก์จาก {transaction.localBillNo}</span>
                        )
                      ) : (
                        <span className="text-[10px] text-amber-600 font-semibold">Local</span>
                      )}
                    </div>
                  </td>
                  <td>{transaction.txDate}</td>
                  <td>{transaction.type === "income" ? "รายรับ" : "รายจ่าย"}</td>
                  <td>
                    <div className="flex flex-col gap-1">
                      <span>{transaction.title}</span>
                      {transaction.relationLabel && (
                        <span className="w-fit rounded-full bg-river/10 px-2 py-0.5 text-[10px] font-bold text-river">
                          {transaction.relationLabel}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>{transaction.billOption}</td>
                  <td className={transaction.type === "income" ? "font-semibold text-leaf" : "font-semibold text-clay"}>
                    {transaction.type === "income" ? "+" : "-"}{formatCurrency(transaction.cost)}
                  </td>
                  <td>{transaction.createdByName} · {transaction.createdByPhone}</td>
                  <td><SyncStatusBadge status={transaction.syncStatus} errorMessage={transaction.syncErrorMessage} /></td>
                  <td>
                    <div className="flex justify-center gap-2">
                      <IconButton label={actionBlockReason ?? "แก้ไข"} onClick={() => openEdit(transaction)} tone="amber" disabled={actionsDisabled}>
                        <Edit3 size={16} />
                      </IconButton>
                      <IconButton label={actionBlockReason ?? "ลบ"} onClick={() => void confirmDelete(transaction)} tone="clay" disabled={actionsDisabled}>
                        <Trash2 size={16} />
                      </IconButton>
                      {transaction.syncStatus === "failed" && (
                        <button
                          type="button"
                          onClick={() => void retryFailedSync(transaction)}
                          disabled={!isOnline || isRetrying}
                          className="rounded-md bg-blue-600 px-2 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          ลองซิงก์อีกครั้ง
                        </button>
                      )}
                      {canOpenSource && (
                        <button
                          type="button"
                          title="เปิดรายการต้นทาง"
                          aria-label="เปิดรายการต้นทาง"
                          onClick={openRelationSource}
                          className="focus-ring grid h-9 w-9 place-items-center rounded-md bg-river text-white"
                        >
                          <ExternalLink size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
              {visibleTransactions.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-ink/50">
                    {search ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีรายการรับ-จ่ายในสาขานี้"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={isLoadingMore}
            className="focus-ring rounded-md border border-black/15 bg-white px-4 py-2 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoadingMore ? "กำลังโหลด..." : "โหลดรายการเพิ่ม"}
          </button>
        </div>
      )}

      {modalOpen && (
        <IncomeExpenseModal
          selectedLocation={selectedLocation}
          profile={profile}
          type={modalType}
          transaction={editingTransaction}
          nextNumber={nextNumber}
          nextLocalSequence={transactions.length + 1}
          customers={customers}
          onClose={() => setModalOpen(false)}
          onSave={async (savedTransactions) => {
            try {
              let pendingApprovalCount = 0;
              let savedCount = 0;

              for (const [index, tx] of savedTransactions.entries()) {
                const isSyncedRecord = Boolean(tx.serverBillNo) || tx.id !== tx.clientTempId;
                const operation = editingTransaction && index === 0 && isSyncedRecord ? "update" : "create";
                const approvalResult = await submitForApprovalIfNeeded(tx, operation);

                if (approvalResult.requiresApproval) {
                  pendingApprovalCount += 1;
                  continue;
                }

                if (operation === "update") {
                  await updateTransaction(tx);
                } else {
                  await addTransaction(tx);
                }
                savedCount += 1;
              }

              setModalOpen(false);
              if (pendingApprovalCount > 0) {
                toast.info(`ส่งคำขออนุมัติ ${pendingApprovalCount} รายการแล้ว`);
              }
              if (savedCount > 0 && pendingApprovalCount > 0) {
                toast.success(`บันทึกรายการที่ไม่ต้องอนุมัติ ${savedCount} รายการแล้ว`);
              }
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "บันทึกรายการไม่สำเร็จ");
            }
          }}
          onAddCustomer={addCustomer.mutate}
          onUpdateCustomer={updateCustomer.mutate}
        />
      )}

      {branchTransferModalOpen && (
        <>
          {branchTransferMode === "cash" ? (
            <CashBranchTransferCreateModal location={selectedLocation} online={isOnline} onSave={cashTransfers.create.mutateAsync} onClose={() => setBranchTransferModalOpen(false)} />
          ) : (
            <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 sm:p-6"><div className="mt-4 w-full max-w-4xl"><BranchTransferForm locationId={selectedLocation.id} onSave={handleBranchTransferSave} onCancel={() => setBranchTransferModalOpen(false)} /></div></div>
          )}
          <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-white p-1 shadow-lg">
            <button onClick={() => setBranchTransferMode("cash")} className={branchTransferMode === "cash" ? "rounded-full bg-river px-3 py-1 text-white" : "px-3 py-1"}>เงินสด</button>
            <button onClick={() => { if (!canCreateMoneyTransfer) return toast.error("ไม่มีสิทธิ์ใช้โอนธนาคาร"); setBranchTransferMode("bank"); }} className={branchTransferMode === "bank" ? "rounded-full bg-river px-3 py-1 text-white" : "px-3 py-1"}>โอนธนาคาร</button>
          </div>
        </>
      )}
      {cashReceiptId && (() => { const transfer = cashTransfers.transfers.find((item) => item.id === cashReceiptId); return transfer ? <CashBranchTransferReceiveModal transfer={transfer} online={isOnline} onReceive={(received) => cashTransfers.receive.mutateAsync({ id: transfer.id, received })} onClose={() => setCashReceiptId(null)} /> : null; })()}
      {cashEditingId && (() => { const transfer = cashTransfers.transfers.find((item) => item.id === cashEditingId); return transfer ? <CashBranchTransferCreateModal location={selectedLocation} transfer={transfer} online={isOnline} onSave={(payload) => cashTransfers.update.mutateAsync({ id: transfer.id, payload })} onClose={() => setCashEditingId(null)} /> : null; })()}
      {cashDetailsId && (() => { const transfer = cashTransfers.transfers.find((item) => item.id === cashDetailsId); return transfer ? <CashBranchTransferDetails transfer={transfer} superAdmin={profile.role === "super_admin"} canEdit={transfer.status === "pending_receipt" && (profile.role === "super_admin" || transfer.createdByUserId === profile.id)} online={isOnline} onEdit={() => { setCashDetailsId(null); setCashEditingId(transfer.id); }} onAccept={(reason) => cashTransfers.acceptDifference.mutateAsync({ id: transfer.id, reason })} onDelete={() => cashTransfers.remove.mutateAsync(transfer.id)} onClose={() => setCashDetailsId(null)} /> : null; })()}

      {approvalModalOpen && (
        <IncomeExpenseApprovalModal onClose={() => setApprovalModalOpen(false)} />
      )}
    </section>
  );
}
