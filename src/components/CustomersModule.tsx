"use client";

import { toast } from "sonner";
import appSwal from "@/lib/swal";
import { useState, useMemo, FormEvent } from "react";
import { 
  Plus, Search, Edit3, Trash2, Smartphone, CreditCard, 
  Home, ShieldCheck, Check, X, Users, Copy, Star
} from "lucide-react";
import type { Customer, CustomerContact, CustomerBankAccount, CustomerFarm } from "@/types";
import { makeClientTempId, makeIdempotencyKey } from "@/lib/format";
import { useCustomers } from "@/hooks/useCustomers";
import { Loader2 } from "lucide-react";

export function CustomersModule() {
  const { customers, isLoading, addCustomer, updateCustomer, deleteCustomer } = useCustomers();

  const [search, setSearch] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedFsc, setSelectedFsc] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  // Available branches from customer data dynamically
  const branches = useMemo(() => {
    const set = new Set<string>();
    customers.forEach(c => {
      c.farms?.forEach(f => {
        if (f.address) set.add(f.address.trim());
      });
      if (c.defaultLocationId) set.add(c.defaultLocationId);
    });
    return Array.from(set).filter(Boolean);
  }, [customers]);

  // Filter & Search logic
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const haystack = [
        c.mainName,
        c.legacyMemberId,
        c.legacyRecId,
        c.class,
        c.fscStatus,
        c.contacts?.map(contact => contact.phone).join(" "),
        c.farms?.map(farm => `${farm.ownerName} ${farm.address} ${farm.cardNumber}`).join(" "),
        c.bankAccounts?.map(bank => `${bank.bankName} ${bank.accountNumber} ${bank.accountName}`).join(" ")
      ].join(" ").toLowerCase();

      const matchesSearch = haystack.includes(search.toLowerCase());
      
      const matchesBranch = !selectedBranch || c.farms?.some(f => f.address?.trim() === selectedBranch.trim());
      
      const matchesFsc = !selectedFsc || c.fscStatus === selectedFsc;

      return matchesSearch && matchesBranch && matchesFsc;
    });
  }, [customers, search, selectedBranch, selectedFsc]);

  // Pagination
  const totalPages = Math.max(Math.ceil(filteredCustomers.length / pageSize), 1);
  const currentPage = Math.min(page, totalPages);
  const visibleCustomers = filteredCustomers.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const firstVisible = filteredCustomers.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastVisible = Math.min(currentPage * pageSize, filteredCustomers.length);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  function openAdd() {
    setEditingCustomer(null);
    setModalOpen(true);
  }

  function openEdit(customer: Customer) {
    setEditingCustomer(customer);
    setModalOpen(true);
  }

  async function confirmDelete(customer: Customer) {
    const result = await appSwal.fire({
      title: 'ยืนยันการลบ',
      text: `คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลลูกค้า "${customer.mainName}"?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'ลบข้อมูล',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#ef4444'
    });
    if (result.isConfirmed) {
      deleteCustomer.mutate(customer.id);
      toast.success("ลบลูกค้าสำเร็จ");
    }
  }

  return (
    <div className="space-y-4">
      {/* Header section with Premium design */}
      <div className="flex flex-col gap-4 rounded-xl border border-black/10 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink flex items-center gap-2">
            <Users className="text-leaf" size={24} />
            จัดการรายชื่อลูกค้า (สมาชิก FSC)
          </h2>
          <p className="text-sm text-ink/65">จัดการและสืบค้นข้อมูลรายชื่อสมาชิกชาวสวนและผู้ค้าขายยางพารา</p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="focus-ring flex h-11 items-center justify-center gap-2 rounded-lg bg-leaf px-4 font-semibold text-white shadow-md hover:bg-leaf/90 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
        >
          <Plus size={18} />
          เพิ่มลูกค้าใหม่
        </button>
      </div>

      {/* Filter and Search controls */}
      <section className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            {/* Page Size select */}
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="focus-ring h-10 rounded-lg border border-black/15 bg-white px-3 text-sm font-medium"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>แสดง {size} แถว</option>
              ))}
            </select>

            {/* Branch filter */}
            <select
              value={selectedBranch}
              onChange={(e) => {
                setSelectedBranch(e.target.value);
                setPage(1);
              }}
              className="focus-ring h-10 rounded-lg border border-black/15 bg-white px-3 text-sm font-medium"
            >
              <option value="">ทุกสาขา</option>
              {branches.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>

            {/* FSC filter */}
            <select
              value={selectedFsc}
              onChange={(e) => {
                setSelectedFsc(e.target.value);
                setPage(1);
              }}
              className="focus-ring h-10 rounded-lg border border-black/15 bg-white px-3 text-sm font-medium"
            >
              <option value="">ทุกสถานะ FSC</option>
              <option value="yes">FSC: Yes</option>
              <option value="no">FSC: No</option>
            </select>
          </div>

          {/* Search bar */}
          <div className="relative w-full lg:w-72">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-ink/40">
              <Search size={18} />
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="ค้นหาชื่อ, รหัส, เบอร์โทร, บัตร..."
              className="focus-ring h-10 w-full rounded-lg border border-black/15 bg-white pl-10 pr-3 text-sm placeholder:text-ink/40"
            />
          </div>
        </div>

        {/* Data Table */}
        <div className="mt-4 overflow-x-auto rounded-lg border border-black/5">
          <table className="w-full min-w-[1000px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 bg-slate-50 text-left text-ink/75 font-semibold">
                <th className="px-4 py-3">รหัสสมาชิก</th>
                <th className="px-4 py-3">ชื่อหลัก</th>
                <th className="px-4 py-3">ประเภทชำระเงิน</th>
                <th className="px-4 py-3">ข้อมูลฟาร์ม / สาขา</th>
                <th className="px-4 py-3">บัญชีธนาคาร</th>
                <th className="px-4 py-3">เบอร์โทรศัพท์</th>
                <th className="px-4 py-3 text-center">FSC</th>
                <th className="px-4 py-3 text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {visibleCustomers.map((cust) => (
                <tr key={cust.id} className="border-b border-black/5 hover:bg-slate-50/50 transition-colors">
                  {/* รหัสสมาชิก */}
                  <td className="px-4 py-3 font-semibold text-leaf">
                    {cust.legacyMemberId || cust.clientTempId?.slice(-6) || "ทั่วไป"}
                  </td>
                  
                  {/* ชื่อหลัก */}
                  <td className="px-4 py-3 font-medium text-ink">
                    {cust.mainName}
                  </td>
                  
                  {/* ประเภท (Class) */}
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      cust.class === "สาขานี้จ่าย" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"
                    }`}>
                      {cust.class === "สาขานี้จ่าย" ? "ชาวสวน (สาขาจ่าย)" : "ผู้ค้าขาย(สาขาใหญ่จ่าย)"}
                    </span>
                  </td>
                  
                  {/* ข้อมูลฟาร์ม */}
                  <td className="px-4 py-3">
                    {cust.farms && cust.farms.length > 0 ? (
                      <div className="space-y-1">
                        {cust.farms.map((f, idx) => (
                          <div key={f.id || idx} className="text-xs text-ink/70">
                            <span className="font-medium text-ink">{f.ownerName}</span>
                            {f.address && ` (${f.address})`}
                            {f.cardNumber && <span className="block text-ink/50 text-[10px]">บัตร: {f.cardNumber}</span>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-ink/30">—</span>
                    )}
                  </td>

                  {/* บัญชีธนาคาร */}
                  <td className="px-4 py-3">
                    {cust.bankAccounts && cust.bankAccounts.length > 0 ? (
                      <div className="space-y-1 max-w-[240px]">
                        {[...cust.bankAccounts].sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0)).map((bank, idx) => (
                          <div key={bank.id || idx} className={`rounded p-1.5 text-[11px] ${
                            bank.isPrimary
                              ? "bg-amber-50 border border-amber-300/60 ring-1 ring-amber-200/50"
                              : "bg-sky-50/60"
                          }`}>
                            <div className="flex items-center gap-1">
                              {bank.isPrimary && <Star size={10} className="text-amber-500 fill-amber-400 flex-shrink-0" />}
                              <span className={`font-bold ${bank.isPrimary ? 'text-amber-800' : 'text-sky-800'}`}>{bank.bankName}</span>
                              {bank.isPrimary && <span className="text-[9px] bg-amber-200/70 text-amber-900 px-1 rounded font-bold">หลัก</span>}
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="font-mono text-ink/80 text-[11px]">{bank.accountNumber}</span>
                              <button
                                type="button"
                                onClick={() => { navigator.clipboard.writeText(bank.accountNumber); }}
                                title="คัดลอกเลขบัญชี"
                                className="inline-flex items-center justify-center h-4 w-4 rounded hover:bg-black/10 text-ink/40 hover:text-ink/70 transition-colors flex-shrink-0"
                              >
                                <Copy size={9} />
                              </button>
                            </div>
                            <span className="block text-ink/50 text-[10px] truncate">{bank.accountName}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-ink/30">—</span>
                    )}
                  </td>

                  {/* เบอร์โทร */}
                  <td className="px-4 py-3">
                    {cust.contacts && cust.contacts.length > 0 ? (
                      <div className="space-y-1">
                        {cust.contacts.map((contact, idx) => (
                          <div key={contact.id || idx} className="text-xs font-medium text-ink/80 flex items-center gap-1">
                            <Smartphone size={12} className="text-leaf/65" />
                            {contact.phone}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-ink/30">—</span>
                    )}
                  </td>

                  {/* FSC */}
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      cust.fscStatus === "yes" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400"
                    }`}>
                      {cust.fscStatus === "yes" ? <Check size={14} /> : <X size={14} />}
                    </span>
                  </td>

                  {/* Action buttons */}
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(cust)}
                        title="แก้ไขข้อมูลลูกค้า"
                        className="grid h-8 w-8 place-items-center rounded-md bg-field text-ink hover:bg-slate-200 transition-colors"
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmDelete(cust)}
                        title="ลบข้อมูลลูกค้า"
                        className="grid h-8 w-8 place-items-center rounded-md bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleCustomers.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-ink/40">
                    ไม่พบข้อมูลสมาชิกหรือลูกค้าในตารางคิวรี
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination details */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-ink/75">
          <p>แสดง {firstVisible} ถึง {lastVisible} จากทั้งหมด {filteredCustomers.length} แถว</p>
          
          <div className="flex gap-1 items-center">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
              className="h-9 px-2.5 rounded-lg border border-black/10 bg-white text-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              ◀ ก่อนหน้า
            </button>
            {(() => {
              const maxButtons = 5;
              let start = Math.max(1, currentPage - Math.floor(maxButtons / 2));
              const end = Math.min(totalPages, start + maxButtons - 1);
              start = Math.max(1, end - maxButtons + 1);
              const pages: number[] = [];
              for (let i = start; i <= end; i++) pages.push(i);
              return pages.map((pageNo) => (
                <button
                  key={pageNo}
                  type="button"
                  onClick={() => setPage(pageNo)}
                  className={`h-9 w-9 rounded-lg border text-sm font-semibold transition-all ${
                    currentPage === pageNo
                      ? "border-leaf bg-leaf text-white"
                      : "border-black/10 bg-white text-ink hover:bg-slate-50"
                  }`}
                >
                  {pageNo}
                </button>
              ));
            })()}
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(currentPage + 1)}
              className="h-9 px-2.5 rounded-lg border border-black/10 bg-white text-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              ถัดไป ▶
            </button>
          </div>
        </div>
      </section>

      {/* Customer Add/Edit Modal */}
      {modalOpen && (
        <CustomerModal
          customer={editingCustomer}
          allCustomers={customers}
          onClose={() => setModalOpen(false)}
          onSave={(cust) => {
            if (editingCustomer) updateCustomer.mutate(cust);
            else addCustomer.mutate(cust);
            setModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

// Sub-component Modal for Adding/Editing Customer details
type CustomerModalProps = {
  customer: Customer | null;
  allCustomers: Customer[];
  onClose: () => void;
  onSave: (customer: Customer) => void;
};

function CustomerModal({
  customer,
  allCustomers,
  onClose,
  onSave
}: CustomerModalProps) {
  const [mainName, setMainName] = useState(customer?.mainName ?? "");

  const initialLegacyMemberId = useMemo(() => {
    if (customer?.legacyMemberId) return customer.legacyMemberId;
    
    // Auto-generate for new customer
    const beYear = new Date().getFullYear() + 543;
    const prefix = beYear.toString().slice(-2); // e.g. "69" for 2569
    
    let maxNum = 0;
    allCustomers.forEach(c => {
      if (c.legacyMemberId && c.legacyMemberId.startsWith(prefix) && c.legacyMemberId.length === 6) {
        const numPart = parseInt(c.legacyMemberId.slice(2), 10);
        if (!isNaN(numPart) && numPart > maxNum) {
          maxNum = numPart;
        }
      }
    });
    
    const nextNum = maxNum + 1;
    const nextNumStr = nextNum.toString().padStart(4, "0");
    return `${prefix}${nextNumStr}`;
  }, [customer, allCustomers]);

  const legacyMemberId = initialLegacyMemberId;
  const [fscStatus, setFscStatus] = useState(customer?.fscStatus ?? "no");
  const [customerClass, setCustomerClass] = useState<Customer["class"]>(customer?.class ?? "สาขานี้จ่าย");
  
  // Child dynamic tables states
  const [contacts, setContacts] = useState<CustomerContact[]>(customer?.contacts ?? []);
  const [bankAccounts, setBankAccounts] = useState<CustomerBankAccount[]>(customer?.bankAccounts ?? []);
  const [farms, setFarms] = useState<CustomerFarm[]>(customer?.farms ?? []);

  // 1. Phone Contacts handlers
  function addContactRow() {
    setContacts(prev => [...prev, { id: makeClientTempId("contact"), phone: "" }]);
  }
  function removeContactRow(id: string) {
    setContacts(prev => prev.filter(c => c.id !== id));
  }
  function updateContactRow(id: string, phone: string) {
    setContacts(prev => prev.map(c => c.id === id ? { ...c, phone } : c));
  }

  // 2. Bank Accounts handlers
  function addBankRow() {
    const isFirst = bankAccounts.length === 0;
    setBankAccounts(prev => [...prev, { id: makeClientTempId("bank"), bankName: "ธ.ก.ส.", accountNumber: "", accountName: "", isPrimary: isFirst }]);
  }
  function removeBankRow(id: string) {
    setBankAccounts(prev => {
      const updated = prev.filter(b => b.id !== id);
      // If we removed the primary, auto-promote the first remaining
      if (updated.length > 0 && !updated.some(b => b.isPrimary)) {
        updated[0] = { ...updated[0], isPrimary: true };
      }
      return updated;
    });
  }
  function updateBankRow(id: string, patch: Partial<Omit<CustomerBankAccount, "id">>) {
    setBankAccounts(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  }
  function setPrimaryBank(id: string) {
    setBankAccounts(prev => prev.map(b => ({ ...b, isPrimary: b.id === id })));
  }
  const [copiedBankId, setCopiedBankId] = useState<string | null>(null);
  function copyAccountNumber(id: string, num: string) {
    navigator.clipboard.writeText(num);
    setCopiedBankId(id);
    setTimeout(() => setCopiedBankId(null), 1500);
  }

  // 3. Farm Details handlers
  function addFarmRow() {
    setFarms(prev => [...prev, { id: makeClientTempId("farm"), ownerName: "", address: "", cardNumber: "" }]);
  }
  function removeFarmRow(id: string) {
    setFarms(prev => prev.filter(f => f.id !== id));
  }
  function updateFarmRow(id: string, patch: Partial<Omit<CustomerFarm, "id">>) {
    setFarms(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  }

  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const errors: string[] = [];

    if (!mainName.trim()) {
      errors.push("กรุณากรอกชื่อหลัก");
    }

    const filledContacts = contacts.filter(c => c.phone.trim() !== "");
    filledContacts.forEach((c, idx) => {
      const digits = c.phone.replace(/\D/g, "");
      if (digits.length < 9 || digits.length > 10) {
        errors.push(`เบอร์โทรรายการที่ ${idx + 1} ("${c.phone}") ต้องเป็นตัวเลข 9-10 หลัก`);
      }
    });

    const filledFarms = farms.filter(f => f.ownerName.trim() !== "" || f.address.trim() !== "");
    filledFarms.forEach((f, idx) => {
      if (f.cardNumber.trim() !== "") {
        const digits = f.cardNumber.replace(/\D/g, "");
        if (digits.length !== 13) {
          errors.push(`เลขบัตรประชาชนฟาร์มรายการที่ ${idx + 1} ("${f.cardNumber}") ต้องเป็นตัวเลข 13 หลัก (ปัจจุบัน ${digits.length} หลัก)`);
        }
      }
    });

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);

    const clientTempId = customer?.clientTempId ?? makeClientTempId("cust");
    const timestampId = customer?.legacyRecId ?? new Date().getTime().toString();
    const cleanMemberId = legacyMemberId.trim();

    onSave({
      id: customer?.id ?? clientTempId,
      clientTempId,
      legacyRecId: timestampId,
      legacyMemberId: cleanMemberId || undefined,
      class: customerClass,
      mainName: mainName.trim(),
      fscStatus,
      startingPointsDate: customer?.startingPointsDate ?? new Date().toISOString().split("T")[0],
      defaultLocationId: customer?.defaultLocationId ?? undefined,
      syncStatus: customer?.syncStatus ?? "pending",
      idempotencyKey: customer?.idempotencyKey ?? makeIdempotencyKey("create", clientTempId),
      revisionNo: (customer?.revisionNo ?? 0) + (customer ? 1 : 0),
      recordStatus: customer?.recordStatus ?? "active",
      
      contacts: filledContacts,
      bankAccounts: bankAccounts.filter(b => b.accountNumber.trim() !== ""),
      farms: filledFarms
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 sm:p-6 animate-fade-in">
      <div className="mt-4 w-full max-w-5xl rounded-xl bg-white shadow-2xl overflow-hidden border border-black/5 animate-scale-up">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-4 bg-gradient-to-r from-emerald-500/5 to-teal-500/5">
          <div>
            <h2 className="text-lg font-bold text-ink">
              {customer ? "แก้ไขข้อมูลลูกค้า / สมาชิก" : "เพิ่มข้อมูลลูกค้า / สมาชิกใหม่"}
            </h2>
            <p className="text-xs text-ink/65">รหัสชั่วคราว: {customer?.clientTempId ?? "สร้างอัตโนมัติ"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-field text-ink hover:bg-slate-200 transition-colors text-lg"
          >
            ×
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-6">

          {/* Validation errors banner */}
          {validationErrors.length > 0 && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 p-4">
              <p className="text-sm font-bold text-rose-800 mb-1">⚠️ กรุณาแก้ไขข้อมูลก่อนบันทึก:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {validationErrors.map((err, i) => (
                  <li key={i} className="text-xs text-rose-700">{err}</li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Section 1: Main customer details */}
          <div className="bg-slate-50 rounded-xl p-4 border border-black/5">
            <h3 className="text-sm font-bold text-ink mb-3">ข้อมูลสมาชิกหลัก</h3>
            
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-xs font-bold text-ink/75 mb-1">รหัสสมาชิก (6 หลัก)</label>
                <input
                  type="text"
                  maxLength={6}
                  value={legacyMemberId}
                  readOnly
                  placeholder="เช่น 681001"
                  className="focus-ring h-10 w-full rounded-lg border border-black/15 bg-slate-100 text-ink/60 px-3 text-sm font-semibold cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink/75 mb-1">ชื่อหลักของสมาชิก *</label>
                <input
                  type="text"
                  value={mainName}
                  onChange={(e) => setMainName(e.target.value)}
                  placeholder="เช่น นางอรนิตย์ สุภากรณ์"
                  required
                  className="focus-ring h-10 w-full rounded-lg border border-black/15 bg-white px-3 text-sm font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink/75 mb-1">สถานะ FSC</label>
                <div className="flex items-center gap-4 h-10 text-sm font-medium">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="fscStatus"
                      value="yes"
                      checked={fscStatus === "yes"}
                      onChange={() => setFscStatus("yes")}
                      className="text-leaf focus:ring-leaf h-4 w-4"
                    />
                    Yes (เป็น)
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="fscStatus"
                      value="no"
                      checked={fscStatus === "no"}
                      onChange={() => setFscStatus("no")}
                      className="text-leaf focus:ring-leaf h-4 w-4"
                    />
                    No (ไม่เป็น)
                  </label>
                </div>
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs font-bold text-ink/75 mb-1.5">Class / ประเภทการจ่ายเงิน</label>
                <div className="flex gap-6 text-sm font-medium">
                  <label className="flex items-center gap-2 cursor-pointer bg-white px-4 py-2 border rounded-lg hover:bg-slate-50 transition-colors">
                    <input
                      type="radio"
                      name="customerClass"
                      value="สาขานี้จ่าย"
                      checked={customerClass === "สาขานี้จ่าย"}
                      onChange={() => setCustomerClass("สาขานี้จ่าย")}
                      className="text-leaf focus:ring-leaf h-4 w-4"
                    />
                    <div>
                      <span className="block font-bold text-emerald-800 text-xs">ชาวสวน (สาขานี้จ่าย)</span>
                      <span className="text-[10px] text-ink/50">จ่ายค่าสินค้าหน้าลานข้าวพาราโดยตรง</span>
                    </div>
                  </label>
                  
                  <label className="flex items-center gap-2 cursor-pointer bg-white px-4 py-2 border rounded-lg hover:bg-slate-50 transition-colors">
                    <input
                      type="radio"
                      name="customerClass"
                      value="สาขาใหญ่จ่าย"
                      checked={customerClass === "สาขาใหญ่จ่าย"}
                      onChange={() => setCustomerClass("สาขาใหญ่จ่าย")}
                      className="text-leaf focus:ring-leaf h-4 w-4"
                    />
                    <div>
                      <span className="block font-bold text-sky-800 text-xs">ผู้ค้าขาย (สาขาใหญ่จ่าย)</span>
                      <span className="text-[10px] text-ink/50">โอนชำระเงินก้อนใหญ่ผ่านสำนักงานใหญ่</span>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Contacts & Bank details */}
          <div className="grid gap-5 md:grid-cols-2">
            
            {/* Phone contact table card */}
            <div className="card border rounded-xl overflow-hidden shadow-sm bg-white">
              <div className="bg-amber-500/10 border-b px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-bold text-amber-900 flex items-center gap-1">
                  <Smartphone size={14} />
                  รายการเบอร์โทรศัพท์
                </span>
                <button
                  type="button"
                  onClick={addContactRow}
                  className="rounded bg-amber-500 text-white px-2 py-0.5 text-xs font-bold hover:bg-amber-600 active:scale-95 transition-all"
                >
                  ➕ เพิ่ม
                </button>
              </div>
              <div className="p-3 max-h-[220px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-ink/65 border-b">
                      <th className="pb-1.5">เบอร์โทรศัพท์</th>
                      <th className="pb-1.5 text-center w-12">ลบ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map((c, idx) => (
                      <tr key={c.id || idx} className="border-b last:border-b-0">
                        <td className="py-1.5">
                          <input
                            type="text"
                            value={c.phone}
                            onChange={(e) => updateContactRow(c.id, e.target.value.replace(/\D/g, ""))}
                            placeholder="กรอกเบอร์โทรศัพท์"
                            className="h-8 w-full rounded border px-2 focus:ring-1 focus:ring-amber-500 focus:outline-none"
                          />
                        </td>
                        <td className="py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => removeContactRow(c.id)}
                            className="h-6 px-1.5 rounded bg-rose-100 text-rose-700 hover:bg-rose-200 transition-colors"
                          >
                            ลบ
                          </button>
                        </td>
                      </tr>
                    ))}
                    {contacts.length === 0 && (
                      <tr>
                        <td colSpan={2} className="py-4 text-center text-ink/30 italic">
                          ยังไม่มีรายการเบอร์โทรศัพท์
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bank account table card */}
            <div className="card border rounded-xl overflow-hidden shadow-sm bg-white md:col-span-2">
              <div className="bg-sky-500/10 border-b px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-bold text-sky-950 flex items-center gap-1">
                  <CreditCard size={14} />
                  บัญชีธนาคารผู้ขาย
                  <span className="text-[10px] font-normal text-ink/50 ml-1">(กำหนดบัญชีหลักได้ 1 บัญชี)</span>
                </span>
                <button
                  type="button"
                  onClick={addBankRow}
                  className="rounded bg-sky-600 text-white px-2 py-0.5 text-xs font-bold hover:bg-sky-700 active:scale-95 transition-all"
                >
                  ➕ เพิ่ม
                </button>
              </div>
              <div className="p-3 max-h-[300px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-ink/65 border-b">
                      <th className="pb-1.5 text-center w-14">บัญชีหลัก</th>
                      <th className="pb-1.5 w-1/5">ธนาคาร</th>
                      <th className="pb-1.5 w-1/4">เลขบัญชี</th>
                      <th className="pb-1.5">ชื่อบัญชี</th>
                      <th className="pb-1.5 text-center w-16">คัดลอก</th>
                      <th className="pb-1.5 text-center w-10">ลบ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankAccounts.map((b, idx) => (
                      <tr key={b.id || idx} className={`border-b last:border-b-0 transition-colors ${
                        b.isPrimary ? 'bg-amber-50/60' : ''
                      }`}>
                        <td className="py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => setPrimaryBank(b.id)}
                            title={b.isPrimary ? 'บัญชีหลักปัจจุบัน' : 'กำหนดเป็นบัญชีหลัก'}
                            className={`inline-flex items-center justify-center h-7 w-7 rounded-full transition-all ${
                              b.isPrimary
                                ? 'bg-slate-100 text-slate-400 hover:bg-amber-100 hover:text-amber-500'
                                : 'bg-amber-400 text-white shadow-sm scale-110'
                            }`}
                          >
                            <Star size={13} className={b.isPrimary ? '' : 'fill-white'} />
                          </button>
                        </td>
                        <td className="py-1.5 pr-1">
                          <select
                            value={b.bankName}
                            onChange={(e) => updateBankRow(b.id, { bankName: e.target.value })}
                            className="h-8 w-full rounded border px-1 focus:ring-1 focus:ring-sky-500 focus:outline-none"
                          >
                            <option value="ธ.ก.ส.">ธ.ก.ส.</option>
                            <option value="กสิกรไทย">กสิกรไทย</option>
                            <option value="กสิกรไทย (KBank)">กสิกรไทย (KBank)</option>
                            <option value="ไทยพาณิชย์">ไทยพาณิชย์</option>
                            <option value="ไทยพาณิชย์ (SCB)">ไทยพาณิชย์ (SCB)</option>
                            <option value="กรุงเทพ">กรุงเทพ</option>
                            <option value="กรุงเทพ (BBL)">กรุงเทพ (BBL)</option>
                            <option value="กรุงไทย">กรุงไทย</option>
                            <option value="กรุงไทย (KTB)">กรุงไทย (KTB)</option>
                            <option value="กรุงศรีอยุธยา (Krungsri)">กรุงศรีอยุธยา</option>
                            <option value="ออมสิน">ออมสิน</option>
                            <option value="ออมสิน (GSB)">ออมสิน (GSB)</option>
                            <option value="ทหารไทยธนชาต (ttb)">ทหารไทยธนชาต (ttb)</option>
                            <option value="พร้อมเพย์">พร้อมเพย์ (PromptPay)</option>
                          </select>
                        </td>
                        <td className="py-1.5 pr-1">
                          <input
                            type="text"
                            value={b.accountNumber}
                            onChange={(e) => updateBankRow(b.id, { accountNumber: e.target.value.replace(/\D/g, "") })}
                            placeholder="เลขบัญชี"
                            className="h-8 w-full rounded border px-2 font-mono focus:ring-1 focus:ring-sky-500 focus:outline-none"
                          />
                        </td>
                        <td className="py-1.5 pr-1">
                          <input
                            type="text"
                            value={b.accountName}
                            onChange={(e) => updateBankRow(b.id, { accountName: e.target.value })}
                            placeholder="ชื่อบัญชี"
                            className="h-8 w-full rounded border px-2 focus:ring-1 focus:ring-sky-500 focus:outline-none"
                          />
                        </td>
                        <td className="py-1.5 text-center">
                          {b.accountNumber.trim() && (
                            <button
                              type="button"
                              onClick={() => copyAccountNumber(b.id, b.accountNumber)}
                              title="คัดลอกเลขบัญชี"
                              className={`inline-flex items-center justify-center h-7 w-7 rounded-md transition-all ${
                                copiedBankId === b.id
                                  ? 'bg-emerald-100 text-emerald-600'
                                  : 'bg-slate-100 text-slate-500 hover:bg-sky-100 hover:text-sky-600'
                              }`}
                            >
                              {copiedBankId === b.id ? <Check size={13} /> : <Copy size={13} />}
                            </button>
                          )}
                        </td>
                        <td className="py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => removeBankRow(b.id)}
                            className="h-6 px-1.5 rounded bg-rose-100 text-rose-700 hover:bg-rose-200 transition-colors"
                          >
                            ลบ
                          </button>
                        </td>
                      </tr>
                    ))}
                    {bankAccounts.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-4 text-center text-ink/30 italic">
                          ยังไม่มีข้อมูลบัญชีธนาคาร
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>

          {/* Section 3: Farm details */}
          <div className="card border rounded-xl overflow-hidden shadow-sm bg-white">
            <div className="bg-emerald-500/10 border-b px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-950 flex items-center gap-1">
                <Home size={14} />
                ข้อมูลฟาร์ม / ที่อยู่ฟาร์ม / บัตรสมาชิก
              </span>
              <button
                type="button"
                onClick={addFarmRow}
                className="rounded bg-emerald-600 text-white px-2 py-0.5 text-xs font-bold hover:bg-emerald-700 active:scale-95 transition-all"
              >
                ➕ เพิ่มข้อมูลฟาร์ม
              </button>
            </div>
            <div className="p-3 max-h-[220px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-ink/65 border-b">
                    <th className="pb-1.5 w-1/3">ชื่อเจ้าของฟาร์ม</th>
                    <th className="pb-1.5 w-1/3">ที่อยู่ฟาร์ม / ลานสาขา</th>
                    <th className="pb-1.5">หมายเลขบัตรประชาชน (Card)</th>
                    <th className="pb-1.5 text-center w-12">ลบ</th>
                  </tr>
                </thead>
                <tbody>
                  {farms.map((f, idx) => (
                    <tr key={f.id || idx} className="border-b last:border-b-0">
                      <td className="py-1.5 pr-1.5">
                        <input
                          type="text"
                          value={f.ownerName}
                          onChange={(e) => updateFarmRow(f.id, { ownerName: e.target.value })}
                          placeholder="ชื่อเจ้าของฟาร์ม"
                          className="h-8 w-full rounded border px-2 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-1.5 pr-1.5">
                        <input
                          type="text"
                          value={f.address}
                          onChange={(e) => updateFarmRow(f.id, { address: e.target.value })}
                          placeholder="ที่อยู่/สาขา"
                          className="h-8 w-full rounded border px-2 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-1.5 pr-1.5">
                        <input
                          type="text"
                          maxLength={13}
                          value={f.cardNumber}
                          onChange={(e) => updateFarmRow(f.id, { cardNumber: e.target.value.replace(/\D/g, "") })}
                          placeholder="เลขบัตรประชาชน 13 หลัก"
                          className="h-8 w-full rounded border px-2 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => removeFarmRow(f.id)}
                          className="h-6 px-1.5 rounded bg-rose-100 text-rose-700 hover:bg-rose-200 transition-colors"
                        >
                          ลบ
                        </button>
                      </td>
                    </tr>
                  ))}
                  {farms.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-ink/30 italic">
                        ยังไม่มีข้อมูลฟาร์มยางพารา
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-black/10 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-lg bg-field px-4 text-sm font-semibold text-ink hover:bg-slate-200 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="h-10 rounded-lg bg-leaf px-5 text-sm font-semibold text-white shadow hover:bg-leaf/90 transition-colors flex items-center gap-1.5"
            >
              <ShieldCheck size={18} />
              บันทึกข้อมูลลูกค้า
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
