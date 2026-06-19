"use client";

import {
  ArrowDownUp,
  Banknote,
  Building2,
  CheckCircle2,
  ClipboardList,
  CloudOff,
  Database,
  Edit3,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
  Users
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { demoLocations, demoProfile, initialBills, initialTransactions } from "@/lib/demo-data";
import {
  formatCurrency,
  formatNumber,
  makeClientRecordedAt,
  makeClientTempId,
  makeIdempotencyKey,
  makeLocalBillNo,
  makeSimulatedServerBillNo,
  todayInputValue
} from "@/lib/format";
import { isSupabaseConfigured } from "@/lib/supabase-browser";
import { useOfflineQueue } from "@/hooks/use-offline-queue";
import type { IncomeExpense, Location, PaymentResponsibility, Profile, RubberBill } from "@/types";

type Tab = "dashboard" | "rubber" | "cash" | "admin" | "sync";
type RubberWeighItem = NonNullable<RubberBill["weighItems"]>[number];
type RubberAcidItem = NonNullable<RubberBill["acidItems"]>[number];
type RubberDebtItem = NonNullable<RubberBill["debtItems"]>[number];
type LanFlowApiData = {
  locations: Location[];
  profile: Profile;
  bills: RubberBill[];
  transactions: IncomeExpense[];
};

const tabs: Array<{ id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "dashboard", label: "ภาพรวม", icon: ClipboardList },
  { id: "rubber", label: "บิลยาง", icon: Plus },
  { id: "cash", label: "รับ-จ่าย", icon: Banknote },
  { id: "admin", label: "Admin", icon: ShieldCheck },
  { id: "sync", label: "Sync", icon: RefreshCw }
];

export function LanFlowApp() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [locations, setLocations] = useState<Location[]>(demoLocations);
  const [profile, setProfile] = useState<Profile>(demoProfile);
  const [selectedLocationId, setSelectedLocationId] = useState(demoLocations[0].id);
  const [bills, setBills] = useState<RubberBill[]>(initialBills);
  const [transactions, setTransactions] = useState<IncomeExpense[]>(initialTransactions);
  const queue = useOfflineQueue();

  useEffect(() => {
    let ignore = false;

    async function loadDatabaseData() {
      try {
        const response = await fetch("/api/lanflow", { cache: "no-store" });
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json() as LanFlowApiData;
        if (ignore) return;

        setLocations(data.locations.length > 0 ? data.locations : demoLocations);
        setProfile(data.profile);
        setBills(data.bills);
        setTransactions(data.transactions);
        setSelectedLocationId(data.profile.locationIds[0] ?? data.locations[0]?.id ?? demoLocations[0].id);
      } catch (error) {
        console.error("LanFlow database load failed", error);
      }
    }

    loadDatabaseData();
    return () => {
      ignore = true;
    };
  }, []);

  const selectedLocation = locations.find((location) => location.id === selectedLocationId) ?? locations[0];
  const scopedBills = bills.filter((bill) => bill.locationId === selectedLocationId && bill.recordStatus !== "deleted");
  const scopedTransactions = transactions.filter((tx) => tx.locationId === selectedLocationId && tx.recordStatus !== "deleted");

  const summary = useMemo(() => {
    const rubberPay = scopedBills.reduce((sum, bill) => sum + bill.netTotal, 0);
    const income = scopedTransactions
      .filter((tx) => tx.type === "income")
      .reduce((sum, tx) => sum + tx.cost, 0);
    const expense = scopedTransactions
      .filter((tx) => tx.type === "expense")
      .reduce((sum, tx) => sum + tx.cost, 0);
    const cashPaid = scopedBills.reduce((sum, bill) => sum + bill.cashPayment, 0);
    const transferPaid = scopedBills.reduce((sum, bill) => sum + bill.transferPayment, 0);
    return {
      billCount: scopedBills.length,
      rubberWeight: scopedBills.reduce((sum, bill) => sum + bill.weight, 0),
      rubberPay,
      income,
      expense,
      balance: income - expense - rubberPay,
      cashPaid,
      transferPaid
    };
  }, [scopedBills, scopedTransactions]);

  function addBill(bill: RubberBill) {
    setBills((current) => [bill, ...current]);
    queue.enqueue({
      clientTempId: bill.clientTempId,
      idempotencyKey: bill.idempotencyKey,
      entityType: "rubber_bill",
      operationType: "create",
      payload: bill
    });
    void persistRubberBill(bill);
  }

  function updateBill(updatedBill: RubberBill) {
    const nextRevision = updatedBill.revisionNo + 1;
    const revisedBill: RubberBill = {
      ...updatedBill,
      revisionNo: nextRevision,
      syncStatus: "pending",
      idempotencyKey: makeIdempotencyKey("update", `${updatedBill.clientTempId}:${nextRevision}`)
    };
    setBills((current) => current.map((bill) => (bill.id === revisedBill.id ? revisedBill : bill)));
    queue.enqueue({
      clientTempId: revisedBill.clientTempId,
      idempotencyKey: revisedBill.idempotencyKey,
      entityType: "rubber_bill",
      operationType: "update",
      payload: revisedBill
    });
    void persistRubberBill(revisedBill);
  }

  function deleteBill(id: string) {
    const bill = bills.find((item) => item.id === id);
    if (!bill) return;
    const deletedAt = makeClientRecordedAt();
    const nextRevision = bill.revisionNo + 1;
    const deletedBill: RubberBill = {
      ...bill,
      recordStatus: "deleted",
      syncStatus: "pending",
      revisionNo: nextRevision,
      idempotencyKey: makeIdempotencyKey("delete", `${bill.clientTempId}:${nextRevision}`),
      deletedAt,
      deletedByName: profile.name,
      deletedByPhone: profile.phone
    };
    setBills((current) => current.map((item) => (item.id === id ? deletedBill : item)));
    queue.enqueue({
      clientTempId: deletedBill.clientTempId,
      idempotencyKey: deletedBill.idempotencyKey,
      entityType: "rubber_bill",
      operationType: "delete",
      payload: deletedBill
    });
    void persistRubberBill(deletedBill);
  }

  function addTransaction(transaction: IncomeExpense) {
    setTransactions((current) => [transaction, ...current]);
    queue.enqueue({
      clientTempId: transaction.clientTempId,
      idempotencyKey: transaction.idempotencyKey,
      entityType: "income_expense",
      operationType: "create",
      payload: transaction
    });
    void persistIncomeExpense(transaction);
  }

  function updateTransaction(updatedTransaction: IncomeExpense) {
    const nextRevision = updatedTransaction.revisionNo + 1;
    const revisedTransaction: IncomeExpense = {
      ...updatedTransaction,
      revisionNo: nextRevision,
      syncStatus: "pending",
      idempotencyKey: makeIdempotencyKey("update", `${updatedTransaction.clientTempId}:${nextRevision}`)
    };
    setTransactions((current) =>
      current.map((transaction) =>
        transaction.id === revisedTransaction.id ? revisedTransaction : transaction
      )
    );
    queue.enqueue({
      clientTempId: revisedTransaction.clientTempId,
      idempotencyKey: revisedTransaction.idempotencyKey,
      entityType: "income_expense",
      operationType: "update",
      payload: revisedTransaction
    });
    void persistIncomeExpense(revisedTransaction);
  }

  function deleteTransaction(id: string) {
    const transaction = transactions.find((item) => item.id === id);
    if (!transaction) return;
    const deletedAt = makeClientRecordedAt();
    const nextRevision = transaction.revisionNo + 1;
    const deletedTransaction: IncomeExpense = {
      ...transaction,
      recordStatus: "deleted",
      syncStatus: "pending",
      revisionNo: nextRevision,
      idempotencyKey: makeIdempotencyKey("delete", `${transaction.clientTempId}:${nextRevision}`),
      deletedAt,
      deletedByName: profile.name,
      deletedByPhone: profile.phone
    };
    setTransactions((current) => current.map((item) => (item.id === id ? deletedTransaction : item)));
    queue.enqueue({
      clientTempId: deletedTransaction.clientTempId,
      idempotencyKey: deletedTransaction.idempotencyKey,
      entityType: "income_expense",
      operationType: "delete",
      payload: deletedTransaction
    });
    void persistIncomeExpense(deletedTransaction);
  }

  async function persistRubberBill(bill: RubberBill) {
    try {
      const response = await fetch("/api/lanflow/rubber-bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bill)
      });
      if (!response.ok) throw new Error(await response.text());
      const savedBill = await response.json() as RubberBill;
      setBills((current) => {
        const exists = current.some((item) => item.id === bill.id || item.clientTempId === bill.clientTempId);
        if (!exists) return [savedBill, ...current];
        return current.map((item) => (item.id === bill.id || item.clientTempId === bill.clientTempId ? savedBill : item));
      });
      queue.markSynced(bill.idempotencyKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "บันทึกบิลยางลงฐานข้อมูลไม่สำเร็จ";
      console.error("LanFlow rubber bill save failed", error);
      setBills((current) =>
        current.map((item) => (item.clientTempId === bill.clientTempId ? { ...item, syncStatus: "failed" } : item))
      );
      queue.markFailed(bill.idempotencyKey, message);
    }
  }

  async function persistIncomeExpense(transaction: IncomeExpense) {
    try {
      const response = await fetch("/api/lanflow/income-expense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(transaction)
      });
      if (!response.ok) throw new Error(await response.text());
      const savedTransaction = await response.json() as IncomeExpense;
      setTransactions((current) => {
        const exists = current.some((item) => item.id === transaction.id || item.clientTempId === transaction.clientTempId);
        if (!exists) return [savedTransaction, ...current];
        return current.map((item) =>
          item.id === transaction.id || item.clientTempId === transaction.clientTempId ? savedTransaction : item
        );
      });
      queue.markSynced(transaction.idempotencyKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "บันทึกรายรับ-รายจ่ายลงฐานข้อมูลไม่สำเร็จ";
      console.error("LanFlow income expense save failed", error);
      setTransactions((current) =>
        current.map((item) => (item.clientTempId === transaction.clientTempId ? { ...item, syncStatus: "failed" } : item))
      );
      queue.markFailed(transaction.idempotencyKey, message);
    }
  }

  function simulateSync() {
    const serverReceivedAt = makeClientRecordedAt();
    setBills((current) =>
      current.map((bill, index) =>
        bill.syncStatus === "pending" || bill.syncStatus === "failed"
          ? {
              ...bill,
              syncStatus: "synced",
              serverBillNo: bill.serverBillNo ?? makeSimulatedServerBillNo(index + 1),
              billNo: bill.serverBillNo ?? makeSimulatedServerBillNo(index + 1),
              serverReceivedAt,
              serverCreatedAt: bill.serverCreatedAt ?? serverReceivedAt
            }
          : bill
      )
    );
    setTransactions((current) =>
      current.map((transaction, index) =>
        transaction.syncStatus === "pending" || transaction.syncStatus === "failed"
          ? {
              ...transaction,
              syncStatus: "synced",
              serverBillNo: transaction.serverBillNo ?? String(index + 1),
              number: transaction.serverBillNo ?? String(index + 1),
              serverReceivedAt,
              serverCreatedAt: transaction.serverCreatedAt ?? serverReceivedAt
            }
          : transaction
      )
    );
    queue.markAllSynced();
  }

  function addLocation(name: string) {
    const id = makeClientTempId("loc");
    setLocations((current) => [
      ...current,
      {
        id,
        name,
        code: name.slice(0, 3).toUpperCase(),
        active: true
      }
    ]);
    setProfile((current) => ({ ...current, locationIds: [...current.locationIds, id] }));
  }

  return (
    <main className="min-h-screen">
      <section className="border-b border-black/10 bg-white/85">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-md bg-leaf text-lg font-bold text-white">
                LF
              </div>
              <div>
                <h1 className="text-2xl font-bold text-ink">LanFlow</h1>
                <p className="text-sm text-ink/65">{profile.name} · {profile.phone}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex min-w-0 items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-2">
              <Building2 size={18} className="shrink-0 text-leaf" />
              <select
                className="focus-ring w-full bg-transparent text-sm font-semibold text-ink"
                value={selectedLocationId}
                onChange={(event) => setSelectedLocationId(event.target.value)}
                aria-label="เลือกสาขา"
              >
                {locations
                  .filter((location) => profile.locationIds.includes(location.id))
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
              </select>
            </label>

            <div className="flex items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-2 text-sm">
              {queue.online ? (
                <CheckCircle2 size={18} className="text-leaf" />
              ) : (
                <CloudOff size={18} className="text-clay" />
              )}
              <span>{queue.online ? "Online" : "Offline"}</span>
              <span className="rounded bg-amber/25 px-2 py-0.5 font-semibold">{queue.pendingCount}</span>
            </div>
          </div>
        </div>

        <nav className="mx-auto flex w-full max-w-7xl flex-wrap gap-2 px-4 pb-3 sm:flex-nowrap sm:overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`focus-ring flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold ${
                  active ? "bg-leaf text-white" : "bg-white text-ink hover:bg-mint"
                }`}
              >
                <Icon size={17} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </section>

      <section className={`mx-auto w-full px-4 py-5 ${activeTab === "rubber" ? "max-w-[1800px]" : "max-w-7xl"}`}>
        {activeTab === "dashboard" && (
          <Dashboard
            selectedLocation={selectedLocation}
            summary={summary}
            bills={scopedBills}
            transactions={scopedTransactions}
            supabaseReady={isSupabaseConfigured()}
          />
        )}
        {activeTab === "rubber" && (
          <RubberBillsModule
            selectedLocation={selectedLocation}
            profile={profile}
            bills={scopedBills}
            onAdd={addBill}
            onUpdate={updateBill}
            onDelete={deleteBill}
          />
        )}
        {activeTab === "cash" && (
          <IncomeExpenseModule
            selectedLocation={selectedLocation}
            profile={profile}
            transactions={scopedTransactions}
            nextNumber={String(scopedTransactions.length + 1)}
            onAdd={addTransaction}
            onUpdate={updateTransaction}
            onDelete={deleteTransaction}
          />
        )}
        {activeTab === "admin" && (
          <AdminPanel
            locations={locations}
            profile={profile}
            onAddLocation={addLocation}
          />
        )}
        {activeTab === "sync" && (
          <SyncPanel
            queueItems={queue.items}
            online={queue.online}
            onMarkSynced={simulateSync}
            onClearSynced={queue.clearSynced}
          />
        )}
      </section>
    </main>
  );
}

function Dashboard({
  selectedLocation,
  summary,
  bills,
  transactions,
  supabaseReady
}: {
  selectedLocation: Location;
  summary: {
    billCount: number;
    rubberWeight: number;
    rubberPay: number;
    income: number;
    expense: number;
    balance: number;
    cashPaid: number;
    transferPaid: number;
  };
  bills: RubberBill[];
  transactions: IncomeExpense[];
  supabaseReady: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="บิลวันนี้" value={`${summary.billCount}`} detail={`${formatNumber(summary.rubberWeight)} กก.`} />
        <Metric label="จ่ายค่ายาง" value={formatCurrency(summary.rubberPay)} detail={`สด ${formatCurrency(summary.cashPaid)}`} />
        <Metric label="รายรับ" value={formatCurrency(summary.income)} detail={`รายจ่าย ${formatCurrency(summary.expense)}`} />
        <Metric label="คงเหลือ" value={formatCurrency(summary.balance)} detail={`โอน ${formatCurrency(summary.transferPaid)}`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-ink">บิลยาง · {selectedLocation.name}</h2>
            <span className="rounded bg-field px-2 py-1 text-xs font-semibold text-ink/70">
              {supabaseReady ? "Supabase" : "Demo local"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-ink/60">
                  <th className="py-2">เลขบิล</th>
                  <th>ลูกค้า</th>
                  <th>น้ำหนัก</th>
                  <th>ราคา</th>
                  <th>สุทธิ</th>
                  <th>ผู้บันทึก</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => (
                  <tr key={bill.id} className="border-b border-black/5">
                    <td className="py-3 font-semibold">{getDisplayBillNo(bill)}</td>
                    <td>{bill.customerName}</td>
                    <td>{formatNumber(bill.weight)} กก.</td>
                    <td>{formatCurrency(bill.price)}</td>
                    <td className="font-semibold">{formatCurrency(bill.netTotal)}</td>
                    <td>{bill.createdByName} · {bill.createdByPhone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
          <h2 className="mb-3 text-lg font-bold text-ink">รายการเงินล่าสุด</h2>
          <div className="space-y-3">
            {transactions.map((tx) => (
              <div key={tx.id} className="rounded-md border border-black/10 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{tx.title}</span>
                  <span className={tx.type === "income" ? "text-leaf" : "text-clay"}>
                    {tx.type === "income" ? "+" : "-"}{formatCurrency(tx.cost)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink/60">{tx.billOption} · {tx.createdByName}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
      <p className="text-sm font-semibold text-ink/60">{label}</p>
      <p className="mt-2 text-2xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-sm text-ink/60">{detail}</p>
    </section>
  );
}

function formatBillTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString("th-TH")} ${date.toLocaleTimeString("th-TH", { hour12: false })}`;
}

function getDisplayBillNo(bill: RubberBill) {
  return bill.serverBillNo ?? bill.localBillNo ?? bill.billNo;
}

function SyncStatusBadge({ status }: { status: RubberBill["syncStatus"] }) {
  const tone = {
    pending: "bg-amber/25 text-ink",
    syncing: "bg-blue-100 text-blue-800",
    synced: "bg-leaf/15 text-leaf",
    failed: "bg-rose-100 text-rose-700",
    conflict: "bg-clay/15 text-clay"
  }[status];
  const label = {
    pending: "รอซิงก์",
    syncing: "กำลังซิงก์",
    synced: "ซิงก์แล้ว",
    failed: "ซิงก์ไม่สำเร็จ",
    conflict: "ข้อมูลชนกัน"
  }[status];

  return <span className={`rounded px-2 py-1 text-xs font-semibold ${tone}`}>{label}</span>;
}

function RubberBillsModule({
  selectedLocation,
  profile,
  bills,
  onAdd,
  onUpdate,
  onDelete
}: {
  selectedLocation: Location;
  profile: Profile;
  bills: RubberBill[];
  onAdd: (bill: RubberBill) => void;
  onUpdate: (bill: RubberBill) => void;
  onDelete: (id: string) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<RubberBill | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const filteredBills = bills.filter((bill) => {
    const haystack = [
      bill.billNo,
      bill.localBillNo,
      bill.serverBillNo,
      bill.billDate,
      bill.customerName,
      bill.customerType,
      bill.billType,
      bill.createdByName,
      bill.createdByPhone
    ].join(" ");
    return haystack.toLowerCase().includes(search.toLowerCase());
  });
  const totalPages = Math.max(Math.ceil(filteredBills.length / pageSize), 1);
  const currentPage = Math.min(page, totalPages);
  const visibleBills = filteredBills.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstVisible = filteredBills.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastVisible = Math.min(currentPage * pageSize, filteredBills.length);

  function openAdd() {
    setEditingBill(null);
    setModalOpen(true);
  }

  function openEdit(bill: RubberBill) {
    setEditingBill(bill);
    setModalOpen(true);
  }

  function confirmDelete(bill: RubberBill) {
    if (window.confirm(`ลบบิล ${getDisplayBillNo(bill)} ใช่ไหม? ระบบจะยกเลิกเลขนี้และส่งรายการลบตอนซิงก์`)) {
      onDelete(bill.id);
    }
  }

  function handleSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function handlePageSize(value: string) {
    setPageSize(Number(value));
    setPage(1);
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-md border border-black/10 bg-white p-4 shadow-panel sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-ink">CRUD บิลยาง · {selectedLocation.name}</h2>
          <p className="text-sm text-ink/60">เพิ่ม แก้ไข ลบ และตรวจรายการบิลของสาขาที่เลือก</p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-leaf px-4 font-semibold text-white"
        >
          <Plus size={18} />
          เพิ่มบิลยาง
        </button>
      </div>

      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="rounded-md bg-amber px-4 py-2 text-sm font-bold text-ink">
              จับเวลา เท็กรับน้ำ
            </button>
            <button type="button" onClick={openAdd} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white">
              เพิ่มข้อมูล
            </button>
            <select
              value={pageSize}
              onChange={(event) => handlePageSize(event.target.value)}
              className="focus-ring h-10 rounded-md border border-black/20 bg-white px-3"
            >
              {[10, 25, 50].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            ค้นหา:
            <input
              value={search}
              onChange={(event) => handleSearch(event.target.value)}
              className="focus-ring h-10 w-full rounded-md border border-black/20 bg-white px-3 sm:w-64"
            />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1320px] border-collapse text-sm">
            <thead>
              <tr className="whitespace-nowrap border-b border-black/20 text-left text-ink">
                <th className="py-2">Delete/Edit/View</th>
                <th>เลขที่บิล</th>
                <th>วันที่ออกบิล</th>
                <th>TimestampBill</th>
                <th>ชื่อลูกค้า</th>
                <th>ผู้รับผิดชอบการจ่าย</th>
                <th>ประเภทบิล</th>
                <th>น้ำหนักที่หัก</th>
                <th>น้ำหนักรวม</th>
                <th>รวมมูลค่ายาง(บาท)</th>
                <th>ราคาเฉลี่ย</th>
                <th>ยอดรวมที่ถูกหัก</th>
                <th>Sync</th>
              </tr>
            </thead>
            <tbody>
              {visibleBills.map((bill) => (
                <tr key={bill.id} className="whitespace-nowrap border-b border-black/10 hover:bg-field/50">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        title="ดู"
                        onClick={() => openEdit(bill)}
                        className="grid h-7 w-7 place-items-center rounded-full bg-leaf text-sm font-bold text-white"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmDelete(bill)}
                        className="rounded-md bg-rose-500 px-3 py-1 text-sm font-bold text-white"
                      >
                        ลบ
                      </button>
                      <button
                        type="button"
                        title="แก้ไข"
                        onClick={() => openEdit(bill)}
                        className="grid h-8 w-8 place-items-center rounded-md bg-field text-ink"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        type="button"
                        title="พิมพ์"
                        className="grid h-8 w-8 place-items-center rounded-md bg-violet-100 text-violet-800"
                      >
                        <ClipboardList size={16} />
                      </button>
                      <button
                        type="button"
                        title="จ่ายเงิน"
                        className="grid h-8 w-10 place-items-center rounded-md bg-amber text-ink"
                      >
                        <Banknote size={18} />
                      </button>
                    </div>
                  </td>
                  <td className="font-semibold">
                    <div className="flex flex-col gap-1">
                      <span>{getDisplayBillNo(bill)}</span>
                      {!bill.serverBillNo && <span className="text-xs font-normal text-ink/55">{bill.localBillNo}</span>}
                    </div>
                  </td>
                  <td>{bill.billDate}</td>
                  <td>{formatBillTimestamp(bill.clientCreatedAt)}</td>
                  <td>{bill.customerName}</td>
                  <td>{bill.customerType}</td>
                  <td>{bill.billType}</td>
                  <td>{formatNumber(bill.deductionTotal)}</td>
                  <td>{formatNumber(bill.weight)}</td>
                  <td>{formatNumber(bill.netTotal + bill.deductionTotal)}</td>
                  <td>{formatNumber(bill.price)}</td>
                  <td>{formatNumber(bill.deductionTotal)}</td>
                  <td><SyncStatusBadge status={bill.syncStatus} /></td>
                </tr>
              ))}
              {visibleBills.length === 0 && (
                <tr>
                  <td colSpan={13} className="py-8 text-center text-ink/50">
                    ยังไม่มีบิลในสาขานี้
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2 text-sm text-ink">
            <p>แสดง {firstVisible} ถึง {lastVisible} จาก {filteredBills.length} แถว</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-md bg-leaf px-3 py-2 text-sm font-bold text-white">
                ข้อมูลทั้งหมด
              </button>
              <button type="button" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white">
                เปิดกรองข้อมูล
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: totalPages }, (_, index) => index + 1).slice(0, 7).map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => setPage(pageNumber)}
                className={`h-10 min-w-10 rounded-md border px-3 text-sm font-semibold ${
                  currentPage === pageNumber ? "border-black/20 bg-field text-ink" : "border-transparent bg-white text-ink"
                }`}
              >
                {pageNumber}
              </button>
            ))}
          </div>
        </div>
      </section>

      {modalOpen && (
        <RubberBillModal
          selectedLocation={selectedLocation}
          profile={profile}
          bill={editingBill}
          nextLocalSequence={bills.length + 1}
          onClose={() => setModalOpen(false)}
          onSave={(bill) => {
            if (editingBill) onUpdate(bill);
            else onAdd(bill);
            setModalOpen(false);
          }}
        />
      )}
    </section>
  );
}

function RubberBillModal({
  selectedLocation,
  profile,
  bill,
  nextLocalSequence,
  onClose,
  onSave
}: {
  selectedLocation: Location;
  profile: Profile;
  bill: RubberBill | null;
  nextLocalSequence: number;
  onClose: () => void;
  onSave: (bill: RubberBill) => void;
}) {
  const initialLocalBillNo = bill?.localBillNo ?? makeLocalBillNo(selectedLocation.code, "R", nextLocalSequence);
  const initialPaymentResponsibility = bill?.customerType ?? "สาขานี้จ่าย";
  const [weighItems, setWeighItems] = useState<RubberWeighItem[]>(() => {
    if (bill?.weighItems?.length) return bill.weighItems;
    return [
      {
        id: makeClientTempId("weigh"),
        label: "ชั่ง1",
        inWeight: 0,
        outWeight: 0,
        netWeight: bill?.weight ?? 0,
        price: bill?.price ?? 0
      }
    ];
  });
  const [acidItems, setAcidItems] = useState<RubberAcidItem[]>(() => bill?.acidItems ?? []);
  const [debtItems, setDebtItems] = useState<RubberDebtItem[]>(() => bill?.debtItems ?? (bill?.debtItem ? [bill.debtItem] : []));
  const [paymentResponsibility, setPaymentResponsibility] = useState<PaymentResponsibility>(initialPaymentResponsibility);
  const [weightDeduct, setWeightDeduct] = useState(0);
  const totalWeight = weighItems.reduce((sum, item) => sum + item.netWeight, 0);
  const gross = weighItems.reduce((sum, item) => sum + Math.floor(item.netWeight * item.price), 0);
  const averagePrice = totalWeight > 0 ? gross / totalWeight : 0;
  const acidDeduction = acidItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const debtDeduction = debtItems.reduce((sum, item) => sum + item.amount, 0);
  const weightDeductValue = weightDeduct * averagePrice;
  const deduct = acidDeduction + debtDeduction + weightDeductValue;
  const net = Math.max(gross - deduct, 0);
  const branchPayment = paymentResponsibility === "สาขานี้จ่าย" ? net : 0;
  const headOfficePayment = paymentResponsibility === "สาขาใหญ่จ่าย" ? net : 0;

  function updateWeighItem(id: string, patch: Partial<Omit<RubberWeighItem, "id">>) {
    setWeighItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const nextItem = { ...item, ...patch };
        if (!("inWeight" in patch) && !("outWeight" in patch)) {
          return nextItem;
        }
        return {
          ...nextItem,
          netWeight: Math.max(nextItem.inWeight - nextItem.outWeight, 0)
        };
      })
    );
  }

  function addWeighItem() {
    setWeighItems((current) => [
      ...current,
      {
        id: makeClientTempId("weigh"),
        label: `ชั่ง${current.length + 1}`,
        inWeight: 0,
        outWeight: 0,
        netWeight: 0,
        price: current.at(-1)?.price ?? 0
      }
    ]);
  }

  function removeWeighItem(id: string) {
    setWeighItems((current) => (current.length === 1 ? current : current.filter((item) => item.id !== id)));
  }

  function updateAcidItem(id: string, patch: Partial<Omit<RubberAcidItem, "id">>) {
    setAcidItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function addAcidItem() {
    const names = ["น้ำกรดตราเสือไฟท์", "น้ำกรดตรามังกรไฟท์"];
    setAcidItems((current) => {
      if (current.length >= 2) return current;
      return [
        ...current,
        {
          id: makeClientTempId("acid"),
          name: names[current.length],
          quantity: 1,
          unit: "แพ็ค",
          unitPrice: 0
        }
      ];
    });
  }

  function removeAcidItem(id: string) {
    setAcidItems((current) => current.filter((item) => item.id !== id));
  }

  function updateDebtItem(id: string, patch: Partial<Omit<RubberDebtItem, "id">>) {
    setDebtItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function addDebtItem() {
    setDebtItems((current) => [
      ...current,
      { id: makeClientTempId("debt"), title: `หักชำระหนี้ ${current.length + 1}`, amount: 0 }
    ]);
  }

  function removeDebtItem(id: string) {
    setDebtItems((current) => current.filter((item) => item.id !== id));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const clientTempId = bill?.clientTempId ?? makeClientTempId("rubber");
    const clientRecordedAt = bill?.clientRecordedAt ?? makeClientRecordedAt();
    const localBillNo = String(form.get("billNo") || initialLocalBillNo);
    onSave({
      id: bill?.id ?? clientTempId,
      clientTempId,
      localBillNo,
      serverBillNo: bill?.serverBillNo,
      syncStatus: bill?.syncStatus ?? "pending",
      idempotencyKey: bill?.idempotencyKey ?? makeIdempotencyKey("create", clientTempId),
      locationId: selectedLocation.id,
      billNo: bill?.serverBillNo ?? localBillNo,
      billDate: String(form.get("billDate") || todayInputValue()),
      customerName: String(form.get("customerName") || ""),
      customerType: paymentResponsibility,
      billType: String(form.get("billType") || "บิลเครื่องชั่งเล็ก"),
      weight: totalWeight,
      price: averagePrice,
      deductionTotal: deduct,
      netTotal: net,
      cashPayment: branchPayment,
      transferPayment: headOfficePayment,
      acidPackCount: acidItems.reduce((sum, item) => sum + item.quantity, 0),
      weighItems,
      acidItems,
      debtItem: debtItems[0],
      debtItems,
      createdByName: bill?.createdByName ?? profile.name,
      createdByPhone: bill?.createdByPhone ?? profile.phone,
      clientCreatedAt: bill?.clientCreatedAt ?? clientRecordedAt,
      serverCreatedAt: bill?.serverCreatedAt,
      clientRecordedAt,
      serverReceivedAt: bill?.serverReceivedAt,
      revisionNo: bill?.revisionNo ?? 0,
      recordStatus: bill?.recordStatus ?? "active"
    });
  }

  return (
    <ModalShell
      title={bill ? "แก้ไขบิลเครื่องชั่งเล็ก" : "บิลเครื่องชั่งเล็ก"}
      subtitle={selectedLocation.name}
      onClose={onClose}
      size="wide"
    >
      <form onSubmit={handleSubmit} className="space-y-0">
        <section className="bg-slate-50 p-3 sm:p-4">
          <h3 className="mb-4 font-bold text-ink">ข้อมูลลูกค้า</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="เลขบิลชั่วคราว" name="billNo" defaultValue={bill?.localBillNo ?? initialLocalBillNo} required readOnly />
            <Field label="วันที่" name="billDate" type="date" defaultValue={bill?.billDate ?? todayInputValue()} required />

            <div className="text-center md:col-span-1">
              <p className="mb-2 text-sm font-bold text-ink">สถานะสมาชิก</p>
              <div className="flex justify-center gap-4 text-sm font-semibold">
                <InlineRadio name="memberStatus" value="สมาชิก" label="สมาชิก" />
                <InlineRadio name="memberStatus" value="ไม่เป็นสมาชิก" label="ไม่เป็นสมาชิก" defaultChecked />
              </div>
            </div>
            <Field label="ชื่อลูกค้า" name="customerName" defaultValue={bill?.customerName} required placeholder="กรอกชื่อลูกค้าทั่วไป" />

            <div className="flex justify-center gap-2 md:col-span-2">
              <button type="button" className="rounded-md bg-sky-500 px-3 py-2 text-sm font-semibold text-white">
                เพิ่มข้อมูลสมาชิกใหม่
              </button>
              <button type="button" className="rounded-md bg-amber px-3 py-2 text-sm font-semibold text-ink">
                แก้ไขข้อมูลสมาชิกนี้
              </button>
            </div>

            <div className="text-center md:col-span-2">
              <p className="mb-2 text-sm font-bold text-ink">ผู้รับผิดชอบการจ่าย</p>
              <div className="flex justify-center gap-4 text-sm font-semibold">
                <InlineRadio
                  name="customerType"
                  value="สาขานี้จ่าย"
                  label="สาขานี้จ่าย"
                  checked={paymentResponsibility === "สาขานี้จ่าย"}
                  onChange={() => setPaymentResponsibility("สาขานี้จ่าย")}
                />
                <InlineRadio
                  name="customerType"
                  value="สาขาใหญ่จ่าย"
                  label="สาขาใหญ่จ่าย"
                  checked={paymentResponsibility === "สาขาใหญ่จ่าย"}
                  onChange={() => setPaymentResponsibility("สาขาใหญ่จ่าย")}
                />
              </div>
            </div>
            <input type="hidden" name="billType" value="บิลเครื่องชั่งเล็ก" />
          </div>
        </section>

        <section className="bg-emerald-50 p-3 sm:p-4">
          <h3 className="mb-3 font-bold text-ink">ชั่งสินค้า</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left">
                  <th className="py-2">รายการชั่ง</th>
                  <th>น้ำหนักเข้า</th>
                  <th>น้ำหนักออก</th>
                  <th>น้ำหนักสุทธิ</th>
                  <th>ราคาสินค้า</th>
                  <th>ยอดเงิน</th>
                  <th>ลบ</th>
                </tr>
              </thead>
              <tbody>
                {weighItems.map((item) => (
                  <tr key={item.id} className="border-b border-black/10">
                    <td className="py-2">
                      <input
                        value={item.label}
                        onChange={(event) => updateWeighItem(item.id, { label: event.target.value })}
                        className="focus-ring h-10 w-20 rounded-md border border-black/10 bg-white px-2"
                      />
                    </td>
                    <td><InlineNumber value={item.inWeight} onChange={(value) => updateWeighItem(item.id, { inWeight: value })} /></td>
                    <td><InlineNumber value={item.outWeight} onChange={(value) => updateWeighItem(item.id, { outWeight: value })} /></td>
                    <td><InlineNumber value={item.netWeight} readOnly /></td>
                    <td>
                      <InlineNumber
                        value={item.price}
                        onChange={(value) => updateWeighItem(item.id, { price: value })}
                        decimalOnBlur
                      />
                    </td>
                    <td><InlineNumber value={Math.floor(item.netWeight * item.price)} readOnly /></td>
                    <td>
                      <button
                        type="button"
                        onClick={() => removeWeighItem(item.id)}
                        disabled={weighItems.length === 1}
                        className="rounded bg-rose-500 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <button type="button" onClick={addWeighItem} className="rounded-md bg-leaf px-4 py-2 text-sm font-bold text-white">
              เพิ่มรายการชั่ง
            </button>
            <div className="w-32">
              <NumberField label="หักน้ำหนักยาง (กก.)" value={weightDeduct} onChange={setWeightDeduct} />
            </div>
            <div className="w-36">
              <NumberField label="มูลค่าหักน้ำหนัก (บาท)" value={weightDeductValue} readOnly />
            </div>
          </div>
        </section>

        <section className="bg-amber-50 p-3 sm:p-4">
          <h3 className="mb-3 font-bold text-ink">หักสินค้า</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left">
                  <th className="py-2">รายการหัก</th>
                  <th>จำนวน</th>
                  <th>หน่วย</th>
                  <th>ราคาต่อหน่วย</th>
                  <th>ยอดเงิน</th>
                  <th>ลบ</th>
                </tr>
              </thead>
              <tbody>
                {acidItems.map((item) => (
                  <tr key={item.id} className="border-b border-black/10">
                    <td className="py-2">
                      <input
                        value={item.name}
                        onChange={(event) => updateAcidItem(item.id, { name: event.target.value })}
                        className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3"
                      />
                    </td>
                    <td><InlineNumber value={item.quantity} onChange={(value) => updateAcidItem(item.id, { quantity: value })} /></td>
                    <td>
                      <input
                        value={item.unit}
                        onChange={(event) => updateAcidItem(item.id, { unit: event.target.value })}
                        className="focus-ring h-10 w-20 rounded-md border border-black/10 bg-white px-2"
                      />
                    </td>
                    <td><InlineNumber value={item.unitPrice} onChange={(value) => updateAcidItem(item.id, { unitPrice: value })} /></td>
                    <td><InlineNumber value={item.quantity * item.unitPrice} readOnly /></td>
                    <td>
                      <button type="button" onClick={() => removeAcidItem(item.id)} className="rounded bg-rose-500 px-3 py-2 text-sm font-bold text-white">
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={addAcidItem}
            disabled={acidItems.length >= 2}
            className="mt-3 rounded-md bg-amber px-4 py-2 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-ink/50"
          >
            เพิ่มน้ำกรด
          </button>
        </section>

        <section className="bg-rose-50 p-3 sm:p-4">
          <h3 className="mb-3 font-bold text-ink">หักเงิน</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left">
                  <th className="py-2">รายการหนี้</th>
                  <th className="text-center">—</th>
                  <th className="text-center">—</th>
                  <th>ยอดเงิน</th>
                  <th>ลบ</th>
                </tr>
              </thead>
              <tbody>
                {debtItems.map((item) => (
                  <tr key={item.id} className="border-b border-black/10">
                    <td className="py-2">
                      <input
                        value={item.title}
                        onChange={(event) => updateDebtItem(item.id, { title: event.target.value })}
                        className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3"
                      />
                    </td>
                    <td className="text-center">—</td>
                    <td className="text-center">—</td>
                    <td><InlineNumber value={item.amount} onChange={(value) => updateDebtItem(item.id, { amount: value })} /></td>
                    <td>
                      <button type="button" onClick={() => removeDebtItem(item.id)} className="rounded bg-rose-500 px-3 py-2 text-sm font-bold text-white">
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={addDebtItem}
            className="mt-3 rounded-md bg-slate-500 px-4 py-2 text-sm font-bold text-white"
          >
            หักหนี้
          </button>
        </section>

        <section className="grid gap-3 p-3 sm:w-48 sm:p-4">
          <NumberField label="ราคาเฉลี่ยยาง (บาท/กก.)" value={averagePrice} readOnly />
          <NumberField label="รวมมูลค่ายาง (บาท)" value={gross} readOnly />
          <NumberField label="ยอดรวมที่ถูกหัก (บาท)" value={deduct} readOnly />
          <NumberField label="ยอดสุทธิที่ต้องจ่ายลูกค้า (บาท)" value={net} readOnly />
          <NumberField label="สาขานี้จ่าย" value={branchPayment} readOnly />
          <NumberField label="สาขาใหญ่จ่าย" value={headOfficePayment} readOnly />
          <input type="hidden" name="cashPayment" value={branchPayment} />
          <input type="hidden" name="transferPayment" value={headOfficePayment} />
        </section>

        <div className="flex justify-center border-t border-black/10 p-4">
          <button className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-blue-600 px-5 font-semibold text-white">
            <Save size={18} />
            Submit
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function IncomeExpenseModule({
  selectedLocation,
  profile,
  transactions,
  nextNumber,
  onAdd,
  onUpdate,
  onDelete
}: {
  selectedLocation: Location;
  profile: Profile;
  transactions: IncomeExpense[];
  nextNumber: string;
  onAdd: (transaction: IncomeExpense) => void;
  onUpdate: (transaction: IncomeExpense) => void;
  onDelete: (id: string) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"income" | "expense">("income");
  const [editingTransaction, setEditingTransaction] = useState<IncomeExpense | null>(null);

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
      onDelete(transaction.id);
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
        </div>
      </div>

      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-ink/60">
                <th className="py-2">เลขที่</th>
                <th>วันที่</th>
                <th>ประเภท</th>
                <th>รายการ</th>
                <th>หมวด</th>
                <th>จำนวนเงิน</th>
                <th>ผู้บันทึก</th>
                <th className="text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id} className="border-b border-black/5 hover:bg-field/50">
                  <td className="py-3 font-semibold">{transaction.number}</td>
                  <td>{transaction.txDate}</td>
                  <td>{transaction.type === "income" ? "รายรับ" : "รายจ่าย"}</td>
                  <td>{transaction.title}</td>
                  <td>{transaction.billOption}</td>
                  <td className={transaction.type === "income" ? "font-semibold text-leaf" : "font-semibold text-clay"}>
                    {transaction.type === "income" ? "+" : "-"}{formatCurrency(transaction.cost)}
                  </td>
                  <td>{transaction.createdByName} · {transaction.createdByPhone}</td>
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
                  <td colSpan={8} className="py-8 text-center text-ink/50">
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
          onClose={() => setModalOpen(false)}
          onSave={(savedTransactions) => {
            if (editingTransaction) {
              onUpdate(savedTransactions[0]);
              savedTransactions.slice(1).forEach(onAdd);
            } else {
              savedTransactions.forEach(onAdd);
            }
            setModalOpen(false);
          }}
        />
      )}
    </section>
  );
}

function IncomeExpenseModal({
  selectedLocation,
  profile,
  type,
  transaction,
  nextNumber,
  onClose,
  onSave
}: {
  selectedLocation: Location;
  profile: Profile;
  type: "income" | "expense";
  transaction: IncomeExpense | null;
  nextNumber: string;
  onClose: () => void;
  onSave: (transactions: IncomeExpense[]) => void;
}) {
  type CashLine = {
    id: string;
    title: string;
    unit: number;
    price: number;
    cost: number;
  };
  const [lines, setLines] = useState<CashLine[]>([
    {
      id: transaction?.clientTempId ?? makeClientTempId("cash_line"),
      title: transaction?.title ?? "",
      unit: Number(transaction?.unit || 0),
      price: transaction?.price ?? 0,
      cost: transaction?.cost ?? 0
    }
  ]);
  const label = type === "income" ? "รายรับ" : "ค่าใช้จ่าย";

  function updateLine(id: string, patch: Partial<Omit<CashLine, "id">>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [
      ...current,
      { id: makeClientTempId("cash_line"), title: "", unit: 0, price: 0, cost: 0 }
    ]);
  }

  function removeLine(id: string) {
    setLines((current) => (current.length === 1 ? current : current.filter((line) => line.id !== id)));
  }

  function getLineCost(line: CashLine) {
    return line.unit > 0 && line.price > 0 ? line.unit * line.price : line.cost;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const filledLines = lines.filter((line) => line.title.trim() || line.unit > 0 || line.price > 0 || line.cost > 0);

    if (filledLines.length === 0) {
      window.alert("กรุณาเพิ่มรายการอย่างน้อย 1 รายการ");
      return;
    }

    onSave(
      filledLines.map((line, index) => {
        const clientTempId = index === 0 && transaction ? transaction.clientTempId : makeClientTempId("cash");
        const clientRecordedAt = index === 0 && transaction ? transaction.clientRecordedAt : makeClientRecordedAt();
        const localBillNo = index === 0 && transaction
          ? transaction.localBillNo
          : makeLocalBillNo(selectedLocation.code, type === "income" ? "I" : "E", Number(nextNumber) + index);
        return {
          id: index === 0 && transaction ? transaction.id : clientTempId,
          clientTempId,
          localBillNo,
          serverBillNo: index === 0 && transaction ? transaction.serverBillNo : undefined,
          syncStatus: index === 0 && transaction ? transaction.syncStatus : "pending",
          idempotencyKey: index === 0 && transaction ? transaction.idempotencyKey : makeIdempotencyKey("create", clientTempId),
          locationId: selectedLocation.id,
          type,
          number: String(form.get("number") || nextNumber),
          txDate: String(form.get("txDate") || todayInputValue()),
          title: line.title.trim() || `${label} ${index + 1}`,
          cost: getLineCost(line),
          billOption: String(form.get("billOption") || label),
          transactionOption: String(form.get("transactionOption") || "ภายในสาขานี้"),
          unit: line.unit ? String(line.unit) : undefined,
          price: line.price || undefined,
          createdByName: index === 0 && transaction ? transaction.createdByName : profile.name,
          createdByPhone: index === 0 && transaction ? transaction.createdByPhone : profile.phone,
          clientCreatedAt: index === 0 && transaction ? transaction.clientCreatedAt : clientRecordedAt,
          serverCreatedAt: index === 0 && transaction ? transaction.serverCreatedAt : undefined,
          clientRecordedAt,
          serverReceivedAt: index === 0 && transaction ? transaction.serverReceivedAt : undefined,
          revisionNo: index === 0 && transaction ? transaction.revisionNo : 0,
          recordStatus: index === 0 && transaction ? transaction.recordStatus : "active"
        };
      })
    );
  }

  return (
    <ModalShell
      title="เพิ่ม/แก้ไข บิลเงินสด"
      subtitle={selectedLocation.name}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <section>
          <p className="mb-3 font-bold text-ink">ช่องทางการรับจ่ายเงิน</p>
          <div className="flex flex-wrap gap-3 text-sm font-semibold text-ink">
            <InlineRadio name="transactionOption" value="ภายในสาขานี้" label="ภายในสาขานี้" defaultChecked={transaction?.transactionOption !== "สำนักงานใหญ่"} />
            <InlineRadio name="transactionOption" value="สำนักงานใหญ่" label="สำนักงานใหญ่" defaultChecked={transaction?.transactionOption === "สำนักงานใหญ่"} />
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="เลขที่" name="number" defaultValue={transaction?.number ?? nextNumber} required readOnly />
          <Field label="วันที่" name="txDate" type="date" defaultValue={transaction?.txDate ?? todayInputValue()} required />
        </div>

        <section>
          <p className="mb-3 font-bold text-ink">รูปแบบ</p>
          <div className="flex flex-wrap gap-3 text-sm font-semibold text-ink">
            {(type === "income" ? ["รายรับ", "บิลทั่วไป", "บิลน้ำกรด"] : ["ค่าใช้จ่าย", "บิลค่าแรง", "สูญหาย"]).map((option) => (
              <InlineRadio
                key={option}
                name="billOption"
                value={option}
                label={option}
                defaultChecked={(transaction?.billOption ?? label) === option}
              />
            ))}
          </div>
        </section>

        <section>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/80 text-left text-base font-bold text-ink">
                  <th className="px-2 py-2">รายการ</th>
                  <th className="px-2 py-2">จำนวน</th>
                  <th className="px-2 py-2">ราคา</th>
                  <th className="px-2 py-2">{label}</th>
                  <th className="px-2 py-2 text-center">ลบ</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-black/10">
                    <td className="px-2 py-2">
                      <input
                        value={line.title}
                        onChange={(event) => updateLine(line.id, { title: event.target.value })}
                        className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <InlineNumber value={line.unit} onChange={(value) => updateLine(line.id, { unit: value })} />
                    </td>
                    <td className="px-2 py-2">
                      <InlineNumber value={line.price} onChange={(value) => updateLine(line.id, { price: value })} />
                    </td>
                    <td className="px-2 py-2">
                      <InlineNumber value={line.cost} onChange={(value) => updateLine(line.id, { cost: value })} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        disabled={lines.length === 1}
                        className="rounded-md bg-rose-500 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={addLine} className="rounded-md bg-leaf px-4 py-2 text-sm font-bold text-white">
              เพิ่มรายการ
            </button>
            <button className="focus-ring rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white">
              บันทึกบิล
            </button>
          </div>
        </section>

        <div className="flex justify-end border-t border-black/10 pt-4">
          <button type="button" onClick={onClose} className="focus-ring h-11 rounded-md bg-field px-4 font-semibold text-ink">
            ยกเลิก
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({
  title,
  subtitle,
  onClose,
  size = "normal",
  children
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  size?: "normal" | "wide";
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 sm:p-6">
      <div className={`mt-4 w-full rounded-md bg-white shadow-2xl ${size === "wide" ? "max-w-6xl" : "max-w-4xl"}`}>
        <div className="flex items-start justify-between gap-3 border-b border-black/10 px-4 py-3">
          <div>
            <h2 className="text-lg font-bold text-ink">{title}</h2>
            {subtitle && <p className="text-sm text-ink/60">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="ปิด"
            onClick={onClose}
            className="focus-ring grid h-9 w-9 place-items-center rounded-md bg-field text-ink"
          >
            ×
          </button>
        </div>
        <div className="max-h-[calc(100vh-120px)] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function IconButton({
  label,
  tone,
  onClick,
  children
}: {
  label: string;
  tone: "amber" | "clay";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`focus-ring grid h-9 w-9 place-items-center rounded-md text-white ${
        tone === "amber" ? "bg-amber" : "bg-clay"
      }`}
    >
      {children}
    </button>
  );
}

function clearIfZero(event: React.FocusEvent<HTMLInputElement>) {
  if (parseFloat(event.currentTarget.value) === 0) {
    event.currentTarget.value = "";
  }
}

function restoreZeroIfBlank(event: React.FocusEvent<HTMLInputElement>) {
  if (event.currentTarget.value.trim() === "") {
    event.currentTarget.value = "0";
  }
}

function enforceDecimalInput(
  event: React.FocusEvent<HTMLInputElement>,
  onChange?: (value: number) => void
) {
  const inputElement = event.currentTarget;
  const value = inputElement.value.trim();

  if (value === "" || parseFloat(value) === 0) {
    inputElement.value = "0.00";
    onChange?.(0);
    return;
  }

  if (value.includes(".")) {
    const formattedValue = parseFloat(value).toFixed(2);
    inputElement.value = formattedValue;
    onChange?.(Number(formattedValue));
    return;
  }

  const isThreeOrMoreDigits = /^\d{3,}$/.test(value);
  if (isThreeOrMoreDigits) {
    window.alert("กรุณาระบุ ราคา ให้มีจุดทศนิยม");
    inputElement.focus();
    inputElement.select();
    return;
  }

  const formattedValue = parseFloat(value).toFixed(2);
  inputElement.value = formattedValue;
  onChange?.(Number(formattedValue));
}

function RadioCard({
  name,
  value,
  label,
  defaultChecked
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-2 text-sm font-semibold">
      <input type="radio" name={name} value={value} defaultChecked={defaultChecked} className="h-4 w-4 accent-leaf" />
      {label}
    </label>
  );
}

function InlineRadio({
  name,
  value,
  label,
  defaultChecked,
  checked,
  onChange
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: () => void;
}) {
  const checkedProps = checked === undefined ? { defaultChecked } : { checked, onChange };

  return (
    <label className="inline-flex cursor-pointer items-center gap-1">
      <input
        type="radio"
        name={name}
        value={value}
        className="h-4 w-4 accent-blue-600"
        {...checkedProps}
      />
      <span>{label}</span>
    </label>
  );
}

function InlineNumber({
  value,
  onChange,
  readOnly = false,
  decimalOnBlur = false
}: {
  value: number;
  onChange?: (value: number) => void;
  readOnly?: boolean;
  decimalOnBlur?: boolean;
}) {
  const isReadOnly = readOnly || !onChange;

  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      readOnly={isReadOnly}
      onFocus={(event) => {
        if (!isReadOnly) clearIfZero(event);
      }}
      onBlur={(event) => {
        if (isReadOnly) return;
        if (decimalOnBlur) {
          enforceDecimalInput(event, onChange);
          return;
        }
        restoreZeroIfBlank(event);
        onChange?.(Number(event.currentTarget.value || 0));
      }}
      onChange={(event) => onChange?.(Number(event.target.value || 0))}
      className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-2 read-only:bg-slate-100 read-only:text-ink/70"
    />
  );
}

function RubberBillEntry({
  selectedLocation,
  profile,
  onAdd
}: {
  selectedLocation: Location;
  profile: Profile;
  onAdd: (bill: RubberBill) => void;
}) {
  const [weight, setWeight] = useState(0);
  const [price, setPrice] = useState(0);
  const [deduct, setDeduct] = useState(0);
  const gross = weight * price;
  const net = Math.max(gross - deduct, 0);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const clientTempId = makeClientTempId("rubber");
    const clientRecordedAt = makeClientRecordedAt();
    const localBillNo = String(form.get("billNo") || makeLocalBillNo(selectedLocation.code, "R", 1));
    const bill: RubberBill = {
      id: clientTempId,
      clientTempId,
      localBillNo,
      syncStatus: "pending",
      idempotencyKey: makeIdempotencyKey("create", clientTempId),
      locationId: selectedLocation.id,
      billNo: localBillNo,
      billDate: String(form.get("billDate") || todayInputValue()),
      customerName: String(form.get("customerName") || ""),
      customerType: String(form.get("customerType")) as PaymentResponsibility,
      billType: String(form.get("billType") || "บิลเครื่องชั่งเล็ก"),
      weight,
      price,
      deductionTotal: deduct,
      netTotal: net,
      cashPayment: Number(form.get("cashPayment") || 0),
      transferPayment: Number(form.get("transferPayment") || 0),
      acidPackCount: Number(form.get("acidPackCount") || 0),
      createdByName: profile.name,
      createdByPhone: profile.phone,
      clientCreatedAt: clientRecordedAt,
      clientRecordedAt,
      revisionNo: 0,
      recordStatus: "active"
    };
    onAdd(bill);
    event.currentTarget.reset();
    setWeight(0);
    setPrice(0);
    setDeduct(0);
  }

  return (
    <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
      <div className="mb-4 flex items-center gap-2">
        <LockKeyhole size={18} className="text-leaf" />
        <h2 className="text-lg font-bold text-ink">บิลยาง · {selectedLocation.name}</h2>
      </div>
      <form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-4">
        <Field label="เลขบิล" name="billNo" required />
        <Field label="วันที่" name="billDate" type="date" defaultValue={todayInputValue()} required />
        <Field label="ชื่อลูกค้า" name="customerName" required />
        <Select label="ผู้รับผิดชอบการจ่าย" name="customerType" options={["สาขานี้จ่าย", "สาขาใหญ่จ่าย"]} />
        <Select label="ประเภทบิล" name="billType" options={["บิลเครื่องชั่งเล็ก", "บิลเครื่องชั่งใหญ่"]} />
        <NumberField label="น้ำหนัก กก." value={weight} onChange={setWeight} />
        <NumberField label="ราคา/กก." value={price} onChange={setPrice} />
        <NumberField label="รวมหัก" value={deduct} onChange={setDeduct} />
        <Field label="แพ็คน้ำกรด" name="acidPackCount" type="number" defaultValue="0" />
        <Field label="จ่ายสด" name="cashPayment" type="number" defaultValue={String(net)} />
        <Field label="จ่ายโอน" name="transferPayment" type="number" defaultValue="0" />
        <div className="rounded-md bg-field p-3">
          <p className="text-sm font-semibold text-ink/60">ยอดสุทธิ</p>
          <p className="text-2xl font-bold text-leaf">{formatCurrency(net)}</p>
        </div>
        <button className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-leaf px-4 font-semibold text-white lg:col-span-4">
          <Plus size={18} />
          บันทึกบิล
        </button>
      </form>
    </section>
  );
}

function IncomeExpenseEntry({
  selectedLocation,
  profile,
  nextNumber,
  onAdd
}: {
  selectedLocation: Location;
  profile: Profile;
  nextNumber: string;
  onAdd: (transaction: IncomeExpense) => void;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const clientTempId = makeClientTempId("cash");
    const clientRecordedAt = makeClientRecordedAt();
    const localBillNo = makeLocalBillNo(selectedLocation.code, String(form.get("type")) === "income" ? "I" : "E", Number(nextNumber));
    onAdd({
      id: clientTempId,
      clientTempId,
      localBillNo,
      syncStatus: "pending",
      idempotencyKey: makeIdempotencyKey("create", clientTempId),
      locationId: selectedLocation.id,
      type: String(form.get("type")) as "income" | "expense",
      number: String(form.get("number") || nextNumber),
      txDate: String(form.get("txDate") || todayInputValue()),
      title: String(form.get("title") || ""),
      cost: Number(form.get("cost") || 0),
      billOption: String(form.get("billOption") || ""),
      transactionOption: String(form.get("transactionOption") || ""),
      createdByName: profile.name,
      createdByPhone: profile.phone,
      clientCreatedAt: clientRecordedAt,
      clientRecordedAt,
      revisionNo: 0,
      recordStatus: "active"
    });
    event.currentTarget.reset();
  }

  return (
    <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
      <div className="mb-4 flex items-center gap-2">
        <ArrowDownUp size={18} className="text-river" />
        <h2 className="text-lg font-bold text-ink">รายรับ-รายจ่าย · {selectedLocation.name}</h2>
      </div>
      <form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-4">
        <Select label="ประเภท" name="type" options={["income", "expense"]} labels={["รายรับ", "รายจ่าย"]} />
        <Field label="เลขที่" name="number" defaultValue={nextNumber} required />
        <Field label="วันที่" name="txDate" type="date" defaultValue={todayInputValue()} required />
        <Field label="รายการ" name="title" required />
        <Field label="จำนวนเงิน" name="cost" type="number" defaultValue="0" required />
        <Select label="หมวดบิล" name="billOption" options={["รายรับ", "ค่าใช้จ่าย", "บิลน้ำกรด", "บิลค่าแรง", "สูญหาย"]} />
        <Select label="ธุรกรรม" name="transactionOption" options={["ภายในสาขานี้", "สำนักงานใหญ่"]} />
        <button className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-river px-4 font-semibold text-white lg:col-span-4">
          <Banknote size={18} />
          บันทึกรายการ
        </button>
      </form>
    </section>
  );
}

function AdminPanel({
  locations,
  profile,
  onAddLocation
}: {
  locations: Location[];
  profile: Profile;
  onAddLocation: (name: string) => void;
}) {
  const [name, setName] = useState("");

  return (
    <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck size={18} className="text-leaf" />
          <h2 className="text-lg font-bold text-ink">สิทธิ์ผู้ดูแล</h2>
        </div>
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2"><Users size={17} /> {profile.name} · {profile.role}</p>
          <p className="flex items-center gap-2"><Smartphone size={17} /> Login phone unique: {profile.phone}</p>
          <p className="flex items-center gap-2"><Database size={17} /> สาขาที่ดูแล {profile.locationIds.length} แห่ง</p>
        </div>
      </section>

      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <h2 className="mb-4 text-lg font-bold text-ink">สาขา</h2>
        <form
          className="mb-4 flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) onAddLocation(name.trim());
            setName("");
          }}
        >
          <input
            className="focus-ring h-11 flex-1 rounded-md border border-black/10 px-3"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="ชื่อสาขาใหม่"
          />
          <button className="focus-ring h-11 rounded-md bg-leaf px-4 font-semibold text-white">
            เพิ่มสาขา
          </button>
        </form>
        <div className="grid gap-3 md:grid-cols-2">
          {locations.map((location) => (
            <div key={location.id} className="rounded-md border border-black/10 p-3">
              <p className="font-semibold">{location.name}</p>
              <p className="text-sm text-ink/60">{location.code} · {location.active ? "ใช้งาน" : "ปิด"}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SyncPanel({
  queueItems,
  online,
  onMarkSynced,
  onClearSynced
}: {
  queueItems: ReturnType<typeof useOfflineQueue>["items"];
  online: boolean;
  onMarkSynced: () => void;
  onClearSynced: () => void;
}) {
  return (
    <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-bold text-ink">Offline Queue</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onMarkSynced}
            disabled={!online}
            className="focus-ring h-10 rounded-md bg-leaf px-3 text-sm font-semibold text-white disabled:bg-ink/25"
          >
            จำลอง Sync
          </button>
          <button
            type="button"
            onClick={onClearSynced}
            className="focus-ring h-10 rounded-md bg-field px-3 text-sm font-semibold text-ink"
          >
            ล้างที่สำเร็จ
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {queueItems.length === 0 && <p className="text-sm text-ink/60">ไม่มีรายการค้างซิงก์</p>}
        {queueItems.map((item) => (
          <div key={item.clientTempId} className="rounded-md border border-black/10 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-semibold">{item.entityType} · {item.operationType}</span>
              <span className="rounded bg-field px-2 py-1 text-xs font-semibold">{item.status}</span>
            </div>
            <p className="mt-1 break-all text-sm text-ink/60">{item.clientTempId}</p>
            <p className="mt-1 break-all text-xs text-ink/50">idempotency: {item.idempotencyKey}</p>
            {item.serverReceivedAt && (
              <p className="mt-1 text-xs text-leaf">server_received_at: {formatBillTimestamp(item.serverReceivedAt)}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  readOnly = false,
  placeholder
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  readOnly?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink/70">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={type === "number" ? defaultValue ?? "0" : defaultValue}
        required={required}
        readOnly={readOnly}
        placeholder={placeholder}
        onFocus={(event) => {
          if (type === "number" && !readOnly) clearIfZero(event);
        }}
        onBlur={(event) => {
          if (type === "number" && !readOnly) restoreZeroIfBlank(event);
        }}
        className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3 read-only:bg-slate-100 read-only:text-ink/75"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  readOnly = false
}: {
  label: string;
  value: number;
  onChange?: (value: number) => void;
  readOnly?: boolean;
}) {
  const isReadOnly = readOnly || !onChange;

  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink/70">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        readOnly={isReadOnly}
        onFocus={(event) => {
          if (!isReadOnly) clearIfZero(event);
        }}
        onBlur={(event) => {
          if (isReadOnly) return;
          restoreZeroIfBlank(event);
          onChange?.(Number(event.currentTarget.value || 0));
        }}
        onChange={(event) => onChange?.(Number(event.target.value || 0))}
        className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3 read-only:bg-slate-100 read-only:text-ink/70"
      />
    </label>
  );
}

function Select({
  label,
  name,
  options,
  labels,
  defaultValue
}: {
  label: string;
  name: string;
  options: string[];
  labels?: string[];
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink/70">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3"
      >
        {options.map((option, index) => (
          <option key={option} value={option}>
            {labels?.[index] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}
