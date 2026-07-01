"use client";

import { toast } from "sonner";
import {
  ArrowDownUp,
  Banknote,
  Building2,
  CheckCircle2,
  ClipboardList,
  Edit3,
  FileImage,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Users,
  LogOut,
  Clock
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuthContext } from "@/components/AuthProvider";

import {
  formatCurrency,
  formatNumber,
  makeClientRecordedAt,
  makeClientTempId,
  makeIdempotencyKey,
  makeLocalBillNo,
  todayInputValue
} from "@/lib/format";
import { isSupabaseConfigured } from "@/lib/supabase-browser";

import type { IncomeExpense, Location, PaymentResponsibility, Profile, RubberBill, Customer } from "@/types";
import { CustomersModule } from "./CustomersModule";
import { TransportModule } from "./TransportModule";
import { OcrTicketUpload } from "./OcrTicketUpload";
import type { UploadItem } from "./OcrTicketUpload";
import { useCustomers } from "@/hooks/useCustomers";
import { useRubberBills } from "@/hooks/useRubberBills";
import { MoneyTransferModule } from "./MoneyTransferModule";
import { AdminModule } from "./AdminModule";
import { TimeTrackingModule } from "./TimeTrackingModule";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import { useIncomeExpense } from "@/hooks/useIncomeExpense";


type Tab = "dashboard" | "rubber" | "cash" | "customers" | "transport" | "money-transfer" | "ocr" | "admin" | "time-tracking";
type RubberWeighItem = NonNullable<RubberBill["weighItems"]>[number];
type RubberAcidItem = NonNullable<RubberBill["acidItems"]>[number];
type RubberDebtItem = NonNullable<RubberBill["debtItems"]>[number];

const tabs: Array<{ id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "dashboard", label: "ภาพรวม", icon: ClipboardList },
  { id: "rubber", label: "บิลยาง", icon: Plus },
  { id: "cash", label: "รับ-จ่าย", icon: Banknote },
  { id: "customers", label: "ลูกค้า", icon: Users },
  { id: "transport", label: "ขนส่งและพนักงาน", icon: ArrowDownUp },
  { id: "money-transfer", label: "โอนเงิน", icon: ArrowDownUp },
  { id: "ocr", label: "อ่านใบชั่ง", icon: FileImage },
  { id: "time-tracking", label: "เวลาและเงินเดือน", icon: Clock },
  { id: "admin", label: "Admin", icon: ShieldCheck }
];

export function LanFlowApp() {
  const auth = useAuthContext();
  
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [locations, setLocations] = useState<Location[]>([]);
  const [profile, setProfile] = useState<Profile>(auth.profile as Profile);
  const [selectedLocationId, setSelectedLocationId] = useState(
    auth.profile?.locationIds[0] ?? ""
  );
  const [ocrUploadItems, setOcrUploadItems] = useState<UploadItem[]>([]);
  const [online, setOnline] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function loadDatabaseData() {
      if (!navigator.onLine) {
        setIsLoaded(true);
        return;
      }

      try {
        const response = await authFetch("/api/lanflow", { cache: "no-store" });
        await assertApiResponse(response);
        const data = await response.json() as { locations: Location[], profile: Profile };
        if (ignore) return;

        setLocations(data.locations);
        setProfile(data.profile);
        setSelectedLocationId(data.profile.locationIds[0] ?? data.locations[0]?.id ?? "");

      } catch (error) {
        console.error("LanFlow database load failed", error);
      } finally {
        if (!ignore) setIsLoaded(true);
      }
    }

    void loadDatabaseData();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const syncOnlineState = () => setOnline(navigator.onLine);
    syncOnlineState();
    window.addEventListener("online", syncOnlineState);
    window.addEventListener("offline", syncOnlineState);
    return () => {
      window.removeEventListener("online", syncOnlineState);
      window.removeEventListener("offline", syncOnlineState);
    };
  }, []);

  const { bills: allBills } = useRubberBills(selectedLocationId);
  const { transactions: allTransactions } = useIncomeExpense(selectedLocationId);

  const selectedLocation = locations.find((location) => location.id === selectedLocationId) ?? locations[0];

  const scopedBills = allBills.filter((bill) => bill.recordStatus !== "deleted");
  const scopedTransactions = allTransactions.filter((tx) => tx.recordStatus !== "deleted");

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

  if (!isLoaded || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sand">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-leaf border-t-transparent"></div>
          <p className="text-sm font-semibold text-ink">กำลังโหลดข้อมูล...</p>
        </div>
      </div>
    );
  }

  if (locations.length === 0 || !selectedLocationId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-sand p-4 text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-white shadow-sm">
          <ShieldCheck size={32} className="text-leaf" />
        </div>
        <h1 className="text-xl font-bold text-ink">ไม่มีสิทธิ์เข้าถึงสาขา</h1>
        <p className="mt-2 text-sm text-ink/70">
          บัญชีของคุณยังไม่ได้รับการกำหนดสาขา<br />
          กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดสาขาให้คุณ
        </p>
        <button
          onClick={auth.logout}
          className="focus-ring mt-6 flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm hover:bg-red-50 hover:text-red-600"
        >
          <LogOut size={16} />
          ออกจากระบบ
        </button>
      </div>
    );
  }

  async function addLocation(name: string) {
    try {
      const response = await authFetch("/api/lanflow/admin/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      const data = await response.json();
      if (!response.ok) {
        console.error("Failed to add location:", data.error);
        return;
      }
      const newLoc = data.location;
      setLocations((current) => [...current, newLoc]);
      setProfile((current) => ({ ...current, locationIds: [...current.locationIds, newLoc.id] }));
    } catch (error) {
      console.error("Add location error:", error);
    }
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



            <button
              type="button"
              onClick={auth.logout}
              className="focus-ring flex items-center gap-1.5 rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-ink/70 transition-colors hover:bg-red-50 hover:text-red-600"
              title="ออกจากระบบ"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">ออกจากระบบ</span>
            </button>
          </div>
        </div>

        <nav className="mx-auto flex w-full max-w-7xl flex-wrap gap-2 px-4 pb-3 sm:flex-nowrap sm:overflow-x-auto">
          {tabs.filter(tab => tab.id !== "admin" || ["super_admin", "admin"].includes(profile.role)).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            const ocrProcessing = ocrUploadItems.filter((i) => i.status === "processing").length;
            const ocrPending = ocrUploadItems.filter((i) => i.status === "pending").length;
            const ocrSuccess = ocrUploadItems.filter((i) => i.status === "success").length;
            const ocrError = ocrUploadItems.filter((i) => i.status === "error").length;
            const showOcrBadge = tab.id === "ocr" && ocrUploadItems.length > 0;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`focus-ring relative flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold ${
                  active ? "bg-leaf text-white" : "bg-white text-ink hover:bg-mint"
                }`}
              >
                <Icon size={17} />
                {tab.label}
                {showOcrBadge && ocrProcessing > 0 && (
                  <span className="ml-1 flex items-center gap-0.5 rounded-full bg-river px-1.5 py-0.5 text-[10px] font-bold text-white">
                    <Loader2 size={10} className="animate-spin" />
                    {ocrProcessing}
                  </span>
                )}
                {showOcrBadge && ocrProcessing === 0 && ocrPending > 0 && (
                  <span className="ml-1 rounded-full bg-amber px-1.5 py-0.5 text-[10px] font-bold text-ink">
                    {ocrPending}
                  </span>
                )}
                {showOcrBadge && ocrProcessing === 0 && ocrPending === 0 && ocrSuccess > 0 && ocrError === 0 && (
                  <span className="ml-1 flex items-center gap-0.5 rounded-full bg-leaf/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    <CheckCircle2 size={10} />
                    {ocrSuccess}
                  </span>
                )}
                {showOcrBadge && ocrError > 0 && ocrProcessing === 0 && (
                  <span className="ml-1 rounded-full bg-clay px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {ocrError}
                  </span>
                )}
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
          />
        )}
        {activeTab === "customers" && (
          <CustomersModule />
        )}
        {activeTab === "transport" && (
          <TransportModule />
        )}
        {activeTab === "money-transfer" && (
          <MoneyTransferModule
            locationId={selectedLocationId}
            online={online}
            profile={profile}
          />
        )}
        {activeTab === "ocr" && (
          <OcrTicketUpload
            locationId={selectedLocationId}
            online={online}
            uploadItems={ocrUploadItems}
            setUploadItems={setOcrUploadItems}
          />
        )}
        {activeTab === "cash" && (
          <IncomeExpenseModule
            selectedLocation={selectedLocation}
            profile={profile}
          />
        )}
        {activeTab === "time-tracking" && (
          <TimeTrackingModule profile={profile} />
        )}
        {activeTab === "admin" && (
          <AdminModule
            locations={locations}
            profile={profile}
            onAddLocation={addLocation}
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
  profile
}: {
  selectedLocation: Location;
  profile: Profile;
}) {
  const { bills, addBill, updateBill, deleteBill } = useRubberBills(selectedLocation.id);
  const { customers, addCustomer, updateCustomer } = useCustomers();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<RubberBill | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const filteredBills = (bills || []).filter((bill: RubberBill) => {
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
      deleteBill(bill.id);
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
          customers={customers}
          nextLocalSequence={bills.length + 1}
          onClose={() => setModalOpen(false)}
          onSave={(bill) => {
            const promise = editingBill ? updateBill(bill) : addBill(bill);
            promise.then(() => setModalOpen(false)).catch((err: any) => alert(err.message || "เกิดข้อผิดพลาดในการบันทึกบิล"));
          }}
          onAddCustomer={addCustomer.mutate}
          onUpdateCustomer={updateCustomer.mutate}
        />
      )}
    </section>
  );
}

function RubberBillModal({
  selectedLocation,
  profile,
  bill,
  customers,
  nextLocalSequence,
  onClose,
  onSave,
  onAddCustomer,
  onUpdateCustomer
}: {
  selectedLocation: Location;
  profile: Profile;
  bill: RubberBill | null;
  customers: Customer[];
  nextLocalSequence: number;
  onClose: () => void;
  onSave: (bill: RubberBill) => void;
  onAddCustomer: (customer: Customer) => void;
  onUpdateCustomer: (customer: Customer) => void;
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

  // Autocomplete customer lookup states
  const [customerSearch, setCustomerSearch] = useState(bill?.customerName ?? "");
  const [showDropdown, setShowDropdown] = useState(false);
  const [memberStatus, setMemberStatus] = useState(() => {
    if (!bill?.customerName) return "ไม่เป็นสมาชิก";
    const found = customers.some(c => c.mainName === bill.customerName);
    return found ? "สมาชิก" : "ไม่เป็นสมาชิก";
  });

  const matchingCustomers = useMemo(() => {
    if (!customerSearch.trim()) return [];
    return customers.filter(c => {
      const nameMatch = c.mainName.toLowerCase().includes(customerSearch.toLowerCase());
      const idMatch = c.legacyMemberId?.toLowerCase().includes(customerSearch.toLowerCase());
      return nameMatch || idMatch;
    }).slice(0, 5);
  }, [customers, customerSearch]);

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

    // ตรวจสอบ: มีรายการหักสินค้า/หักเงิน แต่ยอดสุทธิ <= 0
    const hasDeductionItems = acidItems.length > 0 || debtItems.length > 0;
    if (hasDeductionItems && net <= 0) {
      alert(
        `ไม่สามารถบันทึกบิลได้\n\nมีรายการหักสินค้า/หักเงิน แต่ยอดสุทธิที่ต้องจ่าย = ${net.toLocaleString("th-TH")} บาท\n\nกรุณาตรวจสอบน้ำหนักยาง ราคา และรายการหักให้ถูกต้อง`
      );
      return;
    }

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
      customerName: customerSearch,
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
      createdByUserId: bill?.createdByUserId ?? profile.id,
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
                <InlineRadio
                  name="memberStatus"
                  value="สมาชิก"
                  label="สมาชิก"
                  checked={memberStatus === "สมาชิก"}
                  onChange={() => setMemberStatus("สมาชิก")}
                />
                <InlineRadio
                  name="memberStatus"
                  value="ไม่เป็นสมาชิก"
                  label="ไม่เป็นสมาชิก"
                  checked={memberStatus === "ไม่เป็นสมาชิก"}
                  onChange={() => setMemberStatus("ไม่เป็นสมาชิก")}
                />
              </div>
            </div>

            <div className="relative">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-ink/70">ชื่อลูกค้า *</span>
                <input
                  name="customerName"
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => {
                    setTimeout(() => setShowDropdown(false), 200);
                  }}
                  required
                  placeholder="ค้นหาชื่อ หรือ รหัสสมาชิก..."
                  className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3"
                  autoComplete="off"
                />
              </label>

              {showDropdown && matchingCustomers.length > 0 && (
                <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-black/10 bg-white shadow-lg">
                  {matchingCustomers.map(cust => (
                    <button
                      key={cust.id}
                      type="button"
                      onClick={() => {
                        setCustomerSearch(cust.mainName);
                        setMemberStatus("สมาชิก");
                        setPaymentResponsibility(cust.class);
                        setShowDropdown(false);
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-100 border-b border-black/5 last:border-0 flex justify-between items-center"
                    >
                      <div>
                        <span className="font-semibold text-ink">{cust.mainName}</span>
                        {cust.farms?.[0]?.address && <span className="text-xs text-ink/50 ml-2">({cust.farms[0].address})</span>}
                      </div>
                      <span className="text-xs font-bold text-leaf bg-leaf/10 px-2 py-0.5 rounded">
                        {cust.legacyMemberId || "FSC"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-center gap-2 md:col-span-2">
              <button
                type="button"
                onClick={() => {
                  const newCust: Customer = {
                    id: makeClientTempId("cust"),
                    clientTempId: makeClientTempId("cust"),
                    class: "สาขานี้จ่าย",
                    mainName: customerSearch.trim() || "",
                    syncStatus: "pending",
                    idempotencyKey: makeIdempotencyKey("create", makeClientTempId("cust")),
                    revisionNo: 0,
                    recordStatus: "active"
                  };
                  const name = window.prompt("กรอกชื่อสมาชิกใหม่:", customerSearch.trim());
                  if (name && name.trim()) {
                    newCust.mainName = name.trim();
                    newCust.id = makeClientTempId("cust");
                    newCust.clientTempId = newCust.id;
                    newCust.idempotencyKey = makeIdempotencyKey("create", newCust.id);
                    onAddCustomer(newCust);
                    setCustomerSearch(name.trim());
                    setMemberStatus("สมาชิก");
                    setPaymentResponsibility(newCust.class);
                  }
                }}
                className="rounded-md bg-sky-500 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-600 transition-colors"
              >
                เพิ่มข้อมูลสมาชิกใหม่
              </button>
              <button
                type="button"
                onClick={() => {
                  const found = customers.find(c => c.mainName === customerSearch);
                  if (!found) {
                    toast.error("กรุณาเลือกลูกค้าจากรายการก่อน แล้วจึงกดแก้ไข");
                    return;
                  }
                  const newName = window.prompt("แก้ไขชื่อสมาชิก:", found.mainName);
                  if (newName && newName.trim() && newName.trim() !== found.mainName) {
                    onUpdateCustomer({ ...found, mainName: newName.trim() });
                    setCustomerSearch(newName.trim());
                  }
                }}
                className="rounded-md bg-amber px-3 py-2 text-sm font-semibold text-ink hover:bg-amber/80 transition-colors"
              >
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
                  label="สาขาใหญ่จ่าย 40,000บาทขึ้นไป"
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
        </div>
      </div>

      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-ink/60">
                <th className="py-2">เลขที่</th>
                <th>เลขบิลชั่วคราว</th>
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
                  <td className="py-3 font-semibold">{transaction.serverBillNo ?? transaction.number}</td>
                  <td className="text-xs text-ink/55">
                    <div className="flex flex-col gap-0.5">
                      <span>{transaction.localBillNo}</span>
                      {!transaction.serverBillNo && <span className="text-[10px] text-amber-600 font-semibold">Local</span>}
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
    </section>
  );
}

function IncomeExpenseModal({
  selectedLocation,
  profile,
  type,
  transaction,
  nextNumber,
  nextLocalSequence,
  customers,
  onClose,
  onSave,
  onAddCustomer,
  onUpdateCustomer
}: {
  selectedLocation: Location;
  profile: Profile;
  type: "income" | "expense";
  transaction: IncomeExpense | null;
  nextNumber: string;
  nextLocalSequence: number;
  customers: Customer[];
  onClose: () => void;
  onSave: (transactions: IncomeExpense[]) => void;
  onAddCustomer: (customer: Customer) => void;
  onUpdateCustomer: (customer: Customer) => void;
}) {
  type CashLine = {
    id: string;
    title: string;
    unit: number;
    price: number;
    cost: number;
  };
  const initialLocalBillNo = transaction?.localBillNo ?? makeLocalBillNo(selectedLocation.code, type === "income" ? "I" : "E", nextLocalSequence);

  // Customer autocomplete states
  const [customerSearch, setCustomerSearch] = useState(transaction?.title ?? "");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedCustomerName, setSelectedCustomerName] = useState(transaction?.title ?? "");

  const matchingCustomers = useMemo(() => {
    if (!customerSearch.trim()) return [];
    return customers.filter(c => {
      const nameMatch = c.mainName.toLowerCase().includes(customerSearch.toLowerCase());
      const idMatch = c.legacyMemberId?.toLowerCase().includes(customerSearch.toLowerCase());
      return nameMatch || idMatch;
    }).slice(0, 5);
  }, [customers, customerSearch]);

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
      toast.error("กรุณาเพิ่มรายการอย่างน้อย 1 รายการ");
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
      size="wide"
    >
      <form onSubmit={handleSubmit} className="space-y-0">
        {/* Section: Customer data + bill info (like บิลเครื่องชั่งเล็ก) */}
        <section className="bg-slate-50 p-3 sm:p-4">
          <h3 className="mb-4 font-bold text-ink">ข้อมูลลูกค้า</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="เลขบิลชั่วคราว" name="localBillNo" defaultValue={transaction?.localBillNo ?? initialLocalBillNo} required readOnly />
            <Field label="เลขที่" name="number" defaultValue={transaction?.number ?? nextNumber} required readOnly />
            <Field label="วันที่" name="txDate" type="date" defaultValue={transaction?.txDate ?? todayInputValue()} required />

            {/* Customer autocomplete lookup */}
            <div className="relative">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-ink/70">ชื่อลูกค้า / ผู้รับเงิน</span>
                <input
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setShowCustomerDropdown(true);
                  }}
                  onFocus={() => setShowCustomerDropdown(true)}
                  onBlur={() => {
                    setTimeout(() => setShowCustomerDropdown(false), 200);
                  }}
                  placeholder="ค้นหาชื่อ หรือ รหัสสมาชิก..."
                  className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3"
                  autoComplete="off"
                />
              </label>

              {showCustomerDropdown && matchingCustomers.length > 0 && (
                <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-black/10 bg-white shadow-lg">
                  {matchingCustomers.map(cust => (
                    <button
                      key={cust.id}
                      type="button"
                      onClick={() => {
                        setCustomerSearch(cust.mainName);
                        setSelectedCustomerName(cust.mainName);
                        setShowCustomerDropdown(false);
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-100 border-b border-black/5 last:border-0 flex justify-between items-center"
                    >
                      <div>
                        <span className="font-semibold text-ink">{cust.mainName}</span>
                        {cust.farms?.[0]?.address && <span className="text-xs text-ink/50 ml-2">({cust.farms[0].address})</span>}
                      </div>
                      <span className="text-xs font-bold text-leaf bg-leaf/10 px-2 py-0.5 rounded">
                        {cust.legacyMemberId || "สมาชิก"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Add new / Edit customer buttons */}
            <div className="flex flex-wrap items-end gap-2 md:col-span-2">
              <button
                type="button"
                onClick={() => {
                  const newCust: Customer = {
                    id: makeClientTempId("cust"),
                    clientTempId: makeClientTempId("cust"),
                    class: "สาขานี้จ่าย",
                    mainName: customerSearch.trim() || "",
                    syncStatus: "pending",
                    idempotencyKey: makeIdempotencyKey("create", makeClientTempId("cust")),
                    revisionNo: 0,
                    recordStatus: "active"
                  };
                  const name = window.prompt("กรอกชื่อสมาชิกใหม่ (รหัสสมาชิก 6 หลัก จะสร้างอัตโนมัติ):", customerSearch.trim());
                  if (name && name.trim()) {
                    newCust.mainName = name.trim();
                    newCust.id = makeClientTempId("cust");
                    newCust.clientTempId = newCust.id;
                    newCust.idempotencyKey = makeIdempotencyKey("create", newCust.id);
                    onAddCustomer(newCust);
                    setCustomerSearch(name.trim());
                    setSelectedCustomerName(name.trim());
                  }
                }}
                className="rounded-md bg-sky-500 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-600 transition-colors"
              >
                เพิ่มข้อมูลสมาชิกใหม่
              </button>
              <button
                type="button"
                onClick={() => {
                  const found = customers.find(c => c.mainName === customerSearch);
                  if (!found) {
                    toast.error("กรุณาเลือกลูกค้าจากรายการก่อน แล้วจึงกดแก้ไข");
                    return;
                  }
                  const newName = window.prompt("แก้ไขชื่อสมาชิก:", found.mainName);
                  if (newName && newName.trim() && newName.trim() !== found.mainName) {
                    onUpdateCustomer({ ...found, mainName: newName.trim() });
                    setCustomerSearch(newName.trim());
                    setSelectedCustomerName(newName.trim());
                  }
                }}
                className="rounded-md bg-amber px-3 py-2 text-sm font-semibold text-ink hover:bg-amber/80 transition-colors"
              >
                แก้ไขข้อมูลสมาชิกนี้
              </button>
              {selectedCustomerName && (
                <span className="rounded-full bg-leaf/10 px-3 py-1 text-xs font-bold text-leaf">
                  ลูกค้า: {selectedCustomerName}
                </span>
              )}
            </div>
          </div>
        </section>

        <section className="p-3 sm:p-4">
          <p className="mb-3 font-bold text-ink">ช่องทางการรับจ่ายเงิน</p>
          <div className="flex flex-wrap gap-3 text-sm font-semibold text-ink">
            <InlineRadio name="transactionOption" value="ภายในสาขานี้" label="ภายในสาขานี้" defaultChecked={transaction?.transactionOption !== "สำนักงานใหญ่"} />
            <InlineRadio name="transactionOption" value="สำนักงานใหญ่" label="สำนักงานใหญ่" defaultChecked={transaction?.transactionOption === "สำนักงานใหญ่"} />
          </div>
        </section>

        <section className="p-3 sm:p-4">
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

        <section className="bg-emerald-50 p-3 sm:p-4">
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

        {/* Sync status indicator */}
        {transaction && (
          <section className="p-3 sm:p-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-ink/70">สถานะ Sync:</span>
              <SyncStatusBadge status={transaction.syncStatus} />
              <span className="text-xs text-ink/50">{transaction.localBillNo}</span>
            </div>
          </section>
        )}

        <div className="flex justify-end border-t border-black/10 p-4">
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
    toast.error("กรุณาระบุ ราคา ให้มีจุดทศนิยม");
    inputElement.focus();
    inputElement.select();
    return;
  }

  const formattedValue = parseFloat(value).toFixed(2);
  inputElement.value = formattedValue;
  onChange?.(Number(formattedValue));
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
