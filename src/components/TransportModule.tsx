"use client";

import { toast } from "sonner";
import appSwal from "@/lib/swal";
import { useState, useMemo, FormEvent } from "react";
import { 
  Plus, Search, Edit3, Trash2, Smartphone, CreditCard, 
  ShieldCheck, Check, Truck, Copy, Star
} from "lucide-react";
import type { TransportStaff, TransportStaffPlate, CustomerContact, CustomerBankAccount } from "@/types";
import { makeClientTempId, makeIdempotencyKey } from "@/lib/format";

import { useTransportStaffs } from "@/hooks/useTransportStaffs";

export function TransportModule() {
  const { staffs, isLoading, addStaff, updateStaff, deleteStaff } = useTransportStaffs();
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<TransportStaff | null>(null);

  // Filter & Search logic
  const filteredStaffs = useMemo(() => {
    return staffs.filter(v => {
      const haystack = [
        v.mainName,
        v.legacyMemberId,
        v.contacts?.map(c => c.phone).join(" "),
        v.plates?.map(p => p.plateNumber).join(" "),
        v.bankAccounts?.map(b => `${b.bankName} ${b.accountNumber} ${b.accountName}`).join(" ")
      ].join(" ").toLowerCase();
      return haystack.includes(search.toLowerCase());
    });
  }, [staffs, search]);

  // Pagination
  const totalPages = Math.max(Math.ceil(filteredStaffs.length / pageSize), 1);
  const currentPage = Math.min(page, totalPages);
  const visibleStaffs = filteredStaffs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const firstVisible = filteredStaffs.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastVisible = Math.min(currentPage * pageSize, filteredStaffs.length);

  function openAdd() {
    setEditingStaff(null);
    setModalOpen(true);
  }

  function openEdit(staff: TransportStaff) {
    setEditingStaff(staff);
    setModalOpen(true);
  }

  async function confirmDelete(staff: TransportStaff) {
    const result = await appSwal.fire({
      title: 'ยืนยันการลบ',
      text: `คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูล "${staff.mainName}"?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'ลบข้อมูล',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#ef4444'
    });
    if (result.isConfirmed) {
      deleteStaff.mutate(staff.id, {
        onSuccess: () => {
          toast.success("ลบข้อมูลสำเร็จ");
        },
        onError: (err) => {
          toast.error("ลบข้อมูลไม่สำเร็จ: " + err.message);
        }
      });
      toast.success("ลบข้อมูลสำเร็จ");
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-xl border border-black/10 bg-gradient-to-r from-indigo-500/10 to-violet-500/10 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink flex items-center gap-2">
            <Truck className="text-indigo-600" size={24} />
            จัดการขนส่งและพนักงาน
          </h2>
          <p className="text-sm text-ink/65">จัดการข้อมูลคนขนส่ง ทะเบียนรถ และบัญชีธนาคาร</p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="focus-ring flex h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 font-semibold text-white shadow-md hover:bg-indigo-700 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
        >
          <Plus size={18} />
          เพิ่มขนส่งและพนักงานใหม่
        </button>
      </div>

      {/* Filter and Search */}
      <section className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="focus-ring h-10 rounded-lg border border-black/15 bg-white px-3 text-sm font-medium"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>แสดง {size} แถว</option>
              ))}
            </select>
          </div>

          <div className="relative w-full lg:w-72">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-ink/40">
              <Search size={18} />
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="ค้นหาชื่อ, รหัส, ทะเบียน, เบอร์โทร..."
              className="focus-ring h-10 w-full rounded-lg border border-black/15 bg-white pl-10 pr-3 text-sm placeholder:text-ink/40"
            />
          </div>
        </div>

        {/* Data Table */}
        <div className="mt-4 overflow-x-auto rounded-lg border border-black/5">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 bg-slate-50 text-left text-ink/75 font-semibold">
                <th className="px-4 py-3">รหัสสมาชิก</th>
                <th className="px-4 py-3">ชื่อหลัก</th>
                <th className="px-4 py-3">ทะเบียนรถ</th>
                <th className="px-4 py-3">บัญชีธนาคาร</th>
                <th className="px-4 py-3">เบอร์โทรศัพท์</th>
                <th className="px-4 py-3 text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {visibleStaffs.map((v) => (
                <tr key={v.id} className="border-b border-black/5 hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3 font-semibold text-indigo-600">
                    {v.legacyMemberId || v.clientTempId?.slice(-6) || "—"}
                  </td>
                  <td className="px-4 py-3 font-medium text-ink">{v.mainName}</td>
                  
                  {/* ทะเบียนรถ */}
                  <td className="px-4 py-3">
                    {v.plates && v.plates.length > 0 ? (
                      <div className="space-y-1">
                        {v.plates.map((p, idx) => (
                          <div key={p.id || idx} className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-800 mr-1">
                            <Truck size={10} />
                            {p.plateNumber}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-ink/30">—</span>
                    )}
                  </td>

                  {/* บัญชีธนาคาร */}
                  <td className="px-4 py-3">
                    {v.bankAccounts && v.bankAccounts.length > 0 ? (
                      <div className="space-y-1 max-w-[240px]">
                        {[...v.bankAccounts].sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0)).map((bank, idx) => (
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
                    {v.contacts && v.contacts.length > 0 ? (
                      <div className="space-y-1">
                        {v.contacts.map((contact, idx) => (
                          <div key={contact.id || idx} className="text-xs font-medium text-ink/80 flex items-center gap-1">
                            <Smartphone size={12} className="text-indigo-500/65" />
                            {contact.phone}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-ink/30">—</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(v)}
                        title="แก้ไข"
                        className="grid h-8 w-8 place-items-center rounded-md bg-field text-ink hover:bg-slate-200 transition-colors"
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmDelete(v)}
                        title="ลบ"
                        className="grid h-8 w-8 place-items-center rounded-md bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-ink/40">
                    กำลังโหลดข้อมูล...
                  </td>
                </tr>
              ) : visibleStaffs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-ink/40">
                    ไม่พบข้อมูลขนส่งและพนักงาน
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-ink/75">
          <p>แสดง {firstVisible} ถึง {lastVisible} จากทั้งหมด {filteredStaffs.length} แถว</p>
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
                      ? "border-indigo-600 bg-indigo-600 text-white"
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

      {/* Modal */}
      {modalOpen && (
        <TransportModal
          staff={editingStaff}
          allStaffs={staffs}
          onClose={() => setModalOpen(false)}
          onSave={(v) => {
            if (editingStaff) {
              updateStaff.mutate(v, {
                onSuccess: () => toast.success("แก้ไขข้อมูลสำเร็จ"),
                onError: (err) => toast.error("แก้ไขข้อมูลไม่สำเร็จ: " + err.message)
              });
            } else {
              addStaff.mutate(v, {
                onSuccess: () => toast.success("เพิ่มข้อมูลสำเร็จ"),
                onError: (err) => toast.error("เพิ่มข้อมูลไม่สำเร็จ: " + err.message)
              });
            }
            setModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// Modal sub-component
// ═══════════════════════════════════════

type TransportModalProps = {
  staff: TransportStaff | null;
  allStaffs: TransportStaff[];
  onClose: () => void;
  onSave: (staff: TransportStaff) => void;
};

function TransportModal({ staff, allStaffs, onClose, onSave }: TransportModalProps) {
  const [mainName, setMainName] = useState(staff?.mainName ?? "");

  const initialLegacyMemberId = useMemo(() => {
    if (staff?.legacyMemberId) return staff.legacyMemberId;
    const beYear = new Date().getFullYear() + 543;
    const prefix = beYear.toString().slice(-2);
    let maxNum = 0;
    allStaffs.forEach(v => {
      if (v.legacyMemberId && v.legacyMemberId.startsWith(prefix) && v.legacyMemberId.length === 6) {
        const numPart = parseInt(v.legacyMemberId.slice(2), 10);
        if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
      }
    });
    return `${prefix}${String(maxNum + 1).padStart(4, "0")}`;
  }, [staff, allStaffs]);

  const [legacyMemberId] = useState(initialLegacyMemberId);

  // Child dynamic tables
  const [contacts, setContacts] = useState<CustomerContact[]>(staff?.contacts ?? []);
  const [bankAccounts, setBankAccounts] = useState<CustomerBankAccount[]>(staff?.bankAccounts ?? []);
  const [plates, setPlates] = useState<TransportStaffPlate[]>(staff?.plates ?? []);

  // Contact handlers
  function addContactRow() {
    setContacts(prev => [...prev, { id: makeClientTempId("contact"), phone: "" }]);
  }
  function removeContactRow(id: string) {
    setContacts(prev => prev.filter(c => c.id !== id));
  }
  function updateContactRow(id: string, phone: string) {
    setContacts(prev => prev.map(c => c.id === id ? { ...c, phone } : c));
  }

  // Bank handlers
  function addBankRow() {
    const isFirst = bankAccounts.length === 0;
    setBankAccounts(prev => [...prev, { id: makeClientTempId("bank"), bankName: "ธ.ก.ส.", accountNumber: "", accountName: "", isPrimary: isFirst }]);
  }
  function removeBankRow(id: string) {
    setBankAccounts(prev => {
      const updated = prev.filter(b => b.id !== id);
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

  // Plate handlers
  function addPlateRow() {
    setPlates(prev => [...prev, { id: makeClientTempId("plate"), plateNumber: "" }]);
  }
  function removePlateRow(id: string) {
    setPlates(prev => prev.filter(p => p.id !== id));
  }
  function updatePlateRow(id: string, plateNumber: string) {
    setPlates(prev => prev.map(p => p.id === id ? { ...p, plateNumber } : p));
  }

  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const errors: string[] = [];

    if (!mainName.trim()) errors.push("กรุณากรอกชื่อหลัก");

    const filledContacts = contacts.filter(c => c.phone.trim() !== "");
    filledContacts.forEach((c, idx) => {
      const digits = c.phone.replace(/\D/g, "");
      if (digits.length < 9 || digits.length > 10) {
        errors.push(`เบอร์โทรรายการที่ ${idx + 1} ("${c.phone}") ต้องเป็นตัวเลข 9-10 หลัก`);
      }
    });

    const filledPlates = plates.filter(p => p.plateNumber.trim() !== "");

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);
    const clientTempId = staff?.clientTempId ?? makeClientTempId("tv");
    const timestampId = staff?.legacyRecId ?? new Date().getTime().toString();

    onSave({
      id: staff?.id ?? clientTempId,
      clientTempId,
      legacyRecId: timestampId,
      legacyMemberId: legacyMemberId.trim() || undefined,
      mainName: mainName.trim(),
      syncStatus: staff?.syncStatus ?? "pending",
      idempotencyKey: staff?.idempotencyKey ?? makeIdempotencyKey("create", clientTempId),
      revisionNo: (staff?.revisionNo ?? 0) + (staff ? 1 : 0),
      recordStatus: staff?.recordStatus ?? "active",
      contacts: filledContacts,
      bankAccounts: bankAccounts.filter(b => b.accountNumber.trim() !== ""),
      plates: filledPlates
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 sm:p-6 animate-fade-in">
      <div className="mt-4 w-full max-w-5xl rounded-xl bg-white shadow-2xl overflow-hidden border border-black/5 animate-scale-up">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-4 bg-gradient-to-r from-indigo-500/5 to-violet-500/5">
          <div>
            <h2 className="text-lg font-bold text-ink">
              {staff ? "แก้ไขข้อมูลขนส่งและพนักงาน" : "เพิ่มข้อมูลขนส่งและพนักงานใหม่"}
            </h2>
            <p className="text-xs text-ink/65">รหัสชั่วคราว: {staff?.clientTempId ?? "สร้างอัตโนมัติ"}</p>
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

          {/* Validation errors */}
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

          {/* Section 1: Main info */}
          <div className="bg-slate-50 rounded-xl p-4 border border-black/5">
            <h3 className="text-sm font-bold text-ink mb-3">ข้อมูลหลัก</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-ink/75 mb-1">รหัสสมาชิก (6 หลัก)</label>
                <input
                  type="text"
                  maxLength={6}
                  value={legacyMemberId}
                  readOnly
                  className="focus-ring h-10 w-full rounded-lg border border-black/15 bg-slate-100 text-ink/60 px-3 text-sm font-semibold cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-ink/75 mb-1">ชื่อหลัก (คนขนส่ง) *</label>
                <input
                  type="text"
                  value={mainName}
                  onChange={(e) => setMainName(e.target.value)}
                  placeholder="เช่น สมชาย ขนส่งยาง"
                  required
                  className="focus-ring h-10 w-full rounded-lg border border-black/15 bg-white px-3 text-sm font-medium"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Contacts, Bank, Plates */}
          <div className="grid gap-5 md:grid-cols-2">
            
            {/* Phone contacts */}
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
                          <button type="button" onClick={() => removeContactRow(c.id)} className="h-6 px-1.5 rounded bg-rose-100 text-rose-700 hover:bg-rose-200 transition-colors">ลบ</button>
                        </td>
                      </tr>
                    ))}
                    {contacts.length === 0 && (
                      <tr><td colSpan={2} className="py-4 text-center text-ink/30 italic">ยังไม่มีรายการเบอร์โทรศัพท์</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* License Plates (ทะเบียนรถ) */}
            <div className="card border rounded-xl overflow-hidden shadow-sm bg-white">
              <div className="bg-indigo-500/10 border-b px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-950 flex items-center gap-1">
                  <Truck size={14} />
                  ทะเบียนรถ
                </span>
                <button
                  type="button"
                  onClick={addPlateRow}
                  className="rounded bg-indigo-600 text-white px-2 py-0.5 text-xs font-bold hover:bg-indigo-700 active:scale-95 transition-all"
                >
                  ➕ เพิ่มทะเบียน
                </button>
              </div>
              <div className="p-3 max-h-[220px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-ink/65 border-b">
                      <th className="pb-1.5">ทะเบียนรถ</th>
                      <th className="pb-1.5 text-center w-12">ลบ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plates.map((p, idx) => (
                      <tr key={p.id || idx} className="border-b last:border-b-0">
                        <td className="py-1.5">
                          <input
                            type="text"
                            value={p.plateNumber}
                            onChange={(e) => updatePlateRow(p.id, e.target.value)}
                            placeholder="เช่น กข-1234, 70-4874"
                            className="h-8 w-full rounded border px-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                          />
                        </td>
                        <td className="py-1.5 text-center">
                          <button type="button" onClick={() => removePlateRow(p.id)} className="h-6 px-1.5 rounded bg-rose-100 text-rose-700 hover:bg-rose-200 transition-colors">ลบ</button>
                        </td>
                      </tr>
                    ))}
                    {plates.length === 0 && (
                      <tr><td colSpan={2} className="py-4 text-center text-ink/30 italic">ยังไม่มีทะเบียนรถ</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Bank accounts (full width) */}
          <div className="card border rounded-xl overflow-hidden shadow-sm bg-white">
            <div className="bg-sky-500/10 border-b px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold text-sky-950 flex items-center gap-1">
                <CreditCard size={14} />
                บัญชีธนาคาร
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
                    <tr key={b.id || idx} className={`border-b last:border-b-0 transition-colors ${b.isPrimary ? 'bg-amber-50/60' : ''}`}>
                      <td className="py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => setPrimaryBank(b.id)}
                          title={b.isPrimary ? 'บัญชีหลักปัจจุบัน' : 'กำหนดเป็นบัญชีหลัก'}
                          className={`inline-flex items-center justify-center h-7 w-7 rounded-full transition-all ${
                            b.isPrimary
                              ? 'bg-amber-400 text-white shadow-sm scale-110'
                              : 'bg-slate-100 text-slate-400 hover:bg-amber-100 hover:text-amber-500'
                          }`}
                        >
                          <Star size={13} className={b.isPrimary ? 'fill-white' : ''} />
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
                          <option value="ไทยพาณิชย์">ไทยพาณิชย์</option>
                          <option value="กรุงเทพ">กรุงเทพ</option>
                          <option value="กรุงไทย">กรุงไทย</option>
                          <option value="กรุงศรีอยุธยา">กรุงศรีอยุธยา</option>
                          <option value="ออมสิน">ออมสิน</option>
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
                              copiedBankId === b.id ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500 hover:bg-sky-100 hover:text-sky-600'
                            }`}
                          >
                            {copiedBankId === b.id ? <Check size={13} /> : <Copy size={13} />}
                          </button>
                        )}
                      </td>
                      <td className="py-1.5 text-center">
                        <button type="button" onClick={() => removeBankRow(b.id)} className="h-6 px-1.5 rounded bg-rose-100 text-rose-700 hover:bg-rose-200 transition-colors">ลบ</button>
                      </td>
                    </tr>
                  ))}
                  {bankAccounts.length === 0 && (
                    <tr><td colSpan={6} className="py-4 text-center text-ink/30 italic">ยังไม่มีข้อมูลบัญชีธนาคาร</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions */}
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
              className="h-10 rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
            >
              <ShieldCheck size={18} />
              บันทึกข้อมูลขนส่งและพนักงาน
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
