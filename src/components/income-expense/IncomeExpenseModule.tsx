import { Edit3, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { formatCurrency } from "@/lib/format";
import { useIncomeExpense } from "@/hooks/useIncomeExpense";
import { useCustomers } from "@/hooks/useCustomers";

import type { IncomeExpense, Location, Profile } from "@/types";
import { IconButton } from "@/components/shared/IconButton";
import { SyncStatusBadge } from "@/components/shared/SyncStatusBadge";
import { IncomeSaleItemsModal } from "@/components/IncomeSaleItemsModal";
import { getIncomeExpenseDisplayNo } from "./income-expense-display";
import { IncomeExpenseModal } from "./IncomeExpenseModal";

export function IncomeExpenseModule({
  selectedLocation,
  profile
}: {
  selectedLocation: Location;
  profile: Profile;
}) {
  const { transactions, addTransaction, updateTransaction, deleteTransaction } = useIncomeExpense(selectedLocation.id);
  const { customers, addCustomer, updateCustomer } = useCustomers();
  const nextNumber = String(transactions.length + 1);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"income" | "expense">("income");
  const [editingTransaction, setEditingTransaction] = useState<IncomeExpense | null>(null);
  const [saleItemsModalOpen, setSaleItemsModalOpen] = useState(false);

  function openAdd(type: "income" | "expense") {
    setModalType(type);
    setEditingTransaction(null);
    setModalOpen(true);
  }

  function openEdit(transaction: IncomeExpense) {
    setModalType(transaction.type);
    setEditingTransaction(transaction);
    setModalOpen(true);
  }

  function confirmDelete(transaction: IncomeExpense) {
    if (window.confirm(`ลบรายการ ${transaction.number} ใช่ไหม?`)) {
      deleteTransaction(transaction.id);
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
            <button
              type="button"
              onClick={() => setSaleItemsModalOpen(true)}
              className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 font-semibold text-white"
            >
              <Plus size={18} />
              เพิ่มรายการบิลขาย
            </button>
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
              {transactions.map((transaction) => (
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
                  <td>{transaction.title}</td>
                  <td>{transaction.billOption}</td>
                  <td className={transaction.type === "income" ? "font-semibold text-leaf" : "font-semibold text-clay"}>
                    {transaction.type === "income" ? "+" : "-"}{formatCurrency(transaction.cost)}
                  </td>
                  <td>{transaction.createdByName} · {transaction.createdByPhone}</td>
                  <td><SyncStatusBadge status={transaction.syncStatus} /></td>
                  <td>
                    <div className="flex justify-center gap-2">
                      <IconButton label="แก้ไข" onClick={() => openEdit(transaction)} tone="amber">
                        <Edit3 size={16} />
                      </IconButton>
                      <IconButton label="ลบ" onClick={() => confirmDelete(transaction)} tone="clay">
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
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
          onSave={(savedTransactions) => {
            if (editingTransaction) {
              updateTransaction(savedTransactions[0]);
              savedTransactions.slice(1).forEach(tx => addTransaction(tx));
            } else {
              savedTransactions.forEach(tx => addTransaction(tx));
            }
            setModalOpen(false);
          }}
          onAddCustomer={addCustomer.mutate}
          onUpdateCustomer={updateCustomer.mutate}
        />
      )}

      {saleItemsModalOpen && (
        <IncomeSaleItemsModal onClose={() => setSaleItemsModalOpen(false)} />
      )}
    </section>
  );
}
