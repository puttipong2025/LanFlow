import { Edit3, Plus, Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

import { formatCurrency } from "@/lib/format";
import { useIncomeExpense } from "@/hooks/useIncomeExpense";
import { useIncomeExpenseApprovals } from "@/hooks/useIncomeExpenseApprovals";
import { useCustomers } from "@/hooks/useCustomers";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getOfflineSyncedActionBlockReason } from "@/lib/record-action-locks";

import type { IncomeExpense, Location, Profile } from "@/types";
import { IconButton } from "@/components/shared/IconButton";
import { SyncStatusBadge } from "@/components/shared/SyncStatusBadge";
import { IncomeSaleItemsModal } from "@/components/IncomeSaleItemsModal";
import { getIncomeExpenseDisplayNo } from "./income-expense-display";
import { IncomeExpenseApprovalModal } from "./IncomeExpenseApprovalModal";
import { IncomeExpenseModal } from "./IncomeExpenseModal";

export function IncomeExpenseModule({
  selectedLocation,
  profile
}: {
  selectedLocation: Location;
  profile: Profile;
}) {
  const { transactions, addTransaction, updateTransaction, deleteTransaction } = useIncomeExpense(selectedLocation.id);
  const { submitForApprovalIfNeeded } = useIncomeExpenseApprovals();
  const { customers, addCustomer, updateCustomer } = useCustomers();
  const isOnline = useOnlineStatus();
  const nextNumber = String(transactions.length + 1);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"income" | "expense">("income");
  const [editingTransaction, setEditingTransaction] = useState<IncomeExpense | null>(null);
  const [saleItemsModalOpen, setSaleItemsModalOpen] = useState(false);
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);

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

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-md border border-black/10 bg-white p-4 shadow-panel lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-bold text-ink">CRUD รายรับ-รายจ่าย · {selectedLocation.name}</h2>
          <p className="text-sm text-ink/60">เพิ่มผ่าน modal และจัดการรายการจากตาราง</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
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
          {profile.role === "super_admin" && (
            <>
              <button
                type="button"
                onClick={() => setApprovalModalOpen(true)}
                className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 font-semibold text-white"
              >
                <Settings size={18} />
                ตั้งค่าอนุมัติ
              </button>
              <button
                type="button"
                onClick={() => setSaleItemsModalOpen(true)}
                className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 font-semibold text-white"
              >
                <Plus size={18} />
                เพิ่มรายการบิลขาย
              </button>
            </>
          )}
        </div>
      </div>

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
              {transactions.map((transaction) => {
                const actionBlockReason = getActionBlockReason(transaction);
                const actionsDisabled = Boolean(actionBlockReason);

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
                    </div>
                  </td>
                </tr>
                );
              })}
              {transactions.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-ink/50">
                    ยังไม่มีรายการรับ-จ่ายในสาขานี้
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

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

      {saleItemsModalOpen && (
        <IncomeSaleItemsModal onClose={() => setSaleItemsModalOpen(false)} />
      )}

      {approvalModalOpen && (
        <IncomeExpenseApprovalModal onClose={() => setApprovalModalOpen(false)} />
      )}
    </section>
  );
}
