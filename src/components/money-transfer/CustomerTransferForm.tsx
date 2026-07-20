"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  CreditCard,
  FileImage,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
  UserCheck,
  X,
} from "lucide-react";
import Swal from "sweetalert2";
import type {
  Customer,
  MoneyTransfer,
  MoneyTransferSlip,
  MoneyTransferItem,
  OcrTicket,
  Profile,
  RubberBill,
} from "@/types";
import { formatCurrency } from "@/lib/format";
import { authFetch } from "@/lib/auth-fetch";
import { SlipRow, type OcrSlipResult } from "./SlipRow";
import { ItemPicker } from "./ItemPicker";

export function CustomerTransferForm({
  locationId,
  online,
  profile,
  bills,
  ocrTickets,
  customers,
  usedSourceIds,
  editTransfer,
  onSave,
  onCancel,
}: {
  locationId: string;
  online: boolean;
  profile: Profile;
  bills: RubberBill[];
  ocrTickets: OcrTicket[];
  customers: Customer[];
  usedSourceIds: Set<string>;
  editTransfer: MoneyTransfer | null;
  onSave: (transfer: MoneyTransfer) => void;
  onCancel: () => void;
}) {
  const isEdit = !!editTransfer;

  // ── Selected items (Child 2) ──
  const [selectedItems, setSelectedItems] = useState<MoneyTransferItem[]>(
    editTransfer?.items ?? []
  );

  // ── Slips (Child 1) ──
  const [slips, setSlips] = useState<MoneyTransferSlip[]>(
    editTransfer?.slips ?? []
  );
  const [slipUploading, setSlipUploading] = useState(false);
  const slipFileRef = useRef<HTMLInputElement>(null);

  // ── Sections ──
  const [showItemPicker, setShowItemPicker] = useState(false);

  // ── Computed ──
  const totalFromItems = useMemo(
    () => selectedItems.reduce((sum, i) => sum + i.amount, 0),
    [selectedItems]
  );
  const totalFromSlips = useMemo(
    () => slips.reduce((sum, s) => sum + s.amount, 0),
    [slips]
  );
  const [isBranchPayingRemaining, setIsBranchPayingRemaining] = useState(
    editTransfer?.transferStatus === "branch_and_transfer"
  );

  const [manualCustomerSearch, setManualCustomerSearch] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [manualSelectedCustomer, setManualSelectedCustomer] = useState<Customer | null>(null);

  useEffect(() => {
    if (!editTransfer) {
      setManualCustomerSearch("");
      setManualSelectedCustomer(null);
    } else if (editTransfer.customerName) {
      setManualCustomerSearch(editTransfer.customerName);
    }
  }, [editTransfer]);

  useEffect(() => {
    setIsBranchPayingRemaining(editTransfer?.transferStatus === "branch_and_transfer");
  }, [slips, editTransfer?.transferStatus]);

  const computedStatus = useMemo(() => {
    if (totalFromSlips === 0) return "pending"; // รอโอน
    if (totalFromItems === 0 && totalFromSlips > 0) return "advance_payment"; // จ่ายล่วงหน้า
    const diff = totalFromItems - totalFromSlips;
    if (Math.abs(diff) < 0.01) return "paid"; // จ่ายครบ
    if (diff > 0.01) {
      if (isBranchPayingRemaining) return "branch_and_transfer"; // โอน+สาขาจ่าย
      return "partial"; // ค้างจ่าย
    }
    return "overpaid"; // ชำระเกิน
  }, [totalFromSlips, totalFromItems, isBranchPayingRemaining]);

  // Customer info from selected items or manual selection
  const customerNameFromItems = selectedItems.length > 0 ? selectedItems[0].customerName : null;
  const matchingCustomer = useMemo(() => {
    if (customerNameFromItems) {
      return customers.find((c) => c.mainName === customerNameFromItems) ?? null;
    }
    return manualSelectedCustomer || (editTransfer?.customerName ? customers.find(c => c.mainName === editTransfer.customerName) : null) || null;
  }, [customerNameFromItems, manualSelectedCustomer, customers, editTransfer]);

  const customerName = matchingCustomer?.mainName ?? customerNameFromItems ?? null;

  const bankAccounts = useMemo(() => {
    if (!matchingCustomer?.bankAccounts) return [];
    return [...matchingCustomer.bankAccounts].sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
  }, [matchingCustomer]);

  const defaultAccount = bankAccounts[0] ?? null;
  const [selectedAccountNumber, setSelectedAccountNumber] = useState<string | null>(editTransfer?.accountNumber ?? null);

  useEffect(() => {
    if (matchingCustomer) {
      const exists = bankAccounts.some(a => a.accountNumber === selectedAccountNumber);
      if (!exists && defaultAccount) {
        setSelectedAccountNumber(defaultAccount.accountNumber);
      } else if (!exists && !defaultAccount) {
        setSelectedAccountNumber(null);
      }
    } else {
      setSelectedAccountNumber(null);
    }
  }, [matchingCustomer, selectedAccountNumber, bankAccounts, defaultAccount]);

  const bankAccount = useMemo(() => {
    return bankAccounts.find(a => a.accountNumber === selectedAccountNumber) ?? null;
  }, [bankAccounts, selectedAccountNumber]);

  const handleCopyBankAccount = useCallback(async () => {
    if (!selectedAccountNumber) return;
    try {
      await navigator.clipboard.writeText(selectedAccountNumber);
      Swal.fire({
        icon: "success",
        title: "คัดลอกเลขบัญชีแล้ว",
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 3000
      });
    } catch (err) {
      console.error("Failed to copy", err);
    }
  }, [selectedAccountNumber]);

  // ── Handler: Add slip from OCR ──
  const handleSlipUpload = useCallback(
    async (files: FileList) => {
      if (!online) {
        void Swal.fire({
          icon: "warning",
          title: "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น",
          confirmButtonColor: "#3b82f6",
          confirmButtonText: "ตกลง"
        });
        return;
      }
      setSlipUploading(true);
      for (const file of Array.from(files)) {
        try {
          const formData = new FormData();
          formData.append("image", file);
          const res = await authFetch("/api/lanflow/ocr-slip", { method: "POST", body: formData });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Unknown" }));
            throw new Error(err.error || `HTTP ${res.status}`);
          }
          const result: OcrSlipResult = await res.json();
          const newSlip: MoneyTransferSlip = {
            id: crypto.randomUUID(),
            amount: result.amount ?? 0,
            referenceNumber: result.reference_number ?? null,
            fee: result.fee ?? 0,
            senderName: result.sender_name ?? null,
            receiverName: result.receiver_name ?? null,
            transactionDate: result.transaction_date ?? null,
            slipImageUrl: null,
            sortOrder: slips.length,
          };
          setSlips((prev) => [...prev, newSlip]);
        } catch (err) {
          console.error("Slip OCR failed:", err);
        }
      }
      setSlipUploading(false);
    },
    [online, slips.length]
  );

  // ── Handler: Add slip manually ──
  const addEmptySlip = useCallback(() => {
    if (!online) {
      void Swal.fire({
        icon: "warning",
        title: "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น",
        confirmButtonColor: "#3b82f6",
        confirmButtonText: "ตกลง"
      });
      return;
    }
    const newSlip: MoneyTransferSlip = {
      id: crypto.randomUUID(),
      amount: 0,
      referenceNumber: null,
      fee: 0,
      senderName: null,
      receiverName: null,
      transactionDate: null,
      slipImageUrl: null,
      sortOrder: slips.length,
    };
    setSlips((prev) => [...prev, newSlip]);
  }, [slips.length, online]);

  const updateSlip = useCallback((id: string, field: keyof MoneyTransferSlip, value: any) => {
    setSlips((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  }, []);

  const removeSlip = useCallback((id: string) => {
    setSlips((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // ── Handler: Save ──
  const handleSubmit = useCallback(() => {
    if (!online) {
      void Swal.fire({
        icon: "warning",
        title: "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น",
        confirmButtonColor: "#3b82f6",
        confirmButtonText: "ตกลง"
      });
      return;
    }
    if (!customerName || (selectedItems.length === 0 && slips.length === 0)) return;

    if (slips.some(s => !s.transactionDate)) {
      Swal.fire({
        icon: "warning",
        title: "ข้อมูลไม่ครบถ้วน",
        text: "กรุณาระบุวันที่ทำรายการให้ครบทุกสลิป",
        confirmButtonColor: "#3b82f6",
        confirmButtonText: "ตกลง"
      });
      return;
    }

    const transfer: MoneyTransfer = {
      id: editTransfer?.id ?? crypto.randomUUID(),
      clientTempId: editTransfer?.clientTempId ?? crypto.randomUUID(),
      idempotencyKey: editTransfer?.idempotencyKey ?? `mt:${crypto.randomUUID()}`,
      locationId,
      customerId: matchingCustomer?.id ?? null,
      customerName: customerName ?? null,
      accountNumber: bankAccount?.accountNumber ?? null,
      accountName: bankAccount?.accountName ?? null,
      bankName: bankAccount?.bankName ?? null,
      netAmountToPay: totalFromItems,
      transferType: "customer",
      transportCost: 0,
      transportStaffId: null,
      transportStaffName: null,
      targetLocationId: null,
      targetLocationName: null,
      transferStatus: computedStatus,
      branchPaidAmount: computedStatus === "branch_and_transfer" ? totalFromItems - totalFromSlips : 0,
      syncStatus: "pending",
      recordStatus: "active",
      revisionNo: (editTransfer?.revisionNo ?? 0) + (isEdit ? 1 : 0),
      createdByName: profile.name,
      createdByPhone: profile.phone,
      slips,
      items: selectedItems,
    };
    onSave(transfer);
  }, [
    editTransfer,
    locationId,
    matchingCustomer,
    customerName,
    bankAccount,
    totalFromItems,
    isEdit,
    profile,
    slips,
    selectedItems,
    onSave,
    computedStatus,
    totalFromSlips,
    online,
  ]);

  return (
    <div className="space-y-5 rounded-xl border border-river/20 bg-white p-5 shadow-panel">
      {/* ── Parent Info ── */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-ink">
          <CreditCard size={18} className="mr-2 inline-block text-river" />
          {isEdit ? "แก้ไขรายการโอนเงิน" : "สร้างรายการโอนเงินใหม่"}
        </h3>
        <button type="button" onClick={onCancel} className="grid h-8 w-8 place-items-center rounded-full hover:bg-field">
          <X size={18} />
        </button>
      </div>

      {/* Parent summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-black/5 bg-field/40 p-3 overflow-visible relative">
          <p className="text-xs font-semibold text-ink/50">ลูกค้า</p>
          {customerNameFromItems ? (
            <p className="mt-1 text-sm font-bold text-ink">
              <span className="inline-flex items-center gap-1">
                <UserCheck size={14} className="text-leaf" /> {customerNameFromItems}
              </span>
            </p>
          ) : (
            <div className="relative mt-1">
              <input
                value={manualCustomerSearch}
                onChange={(e) => {
                  setManualCustomerSearch(e.target.value);
                  setManualSelectedCustomer(null);
                  setShowCustomerDropdown(true);
                }}
                onFocus={() => setShowCustomerDropdown(true)}
                onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                className="w-full rounded bg-white px-2 py-1 text-sm font-bold text-ink border border-black/10 focus:outline-none focus:border-river"
                placeholder="ค้นหาชื่อลูกค้า..."
              />
              {showCustomerDropdown && (
                <div className="absolute left-0 top-full z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-black/10 bg-white py-1 shadow-lg">
                  {customers
                    .filter((c) => c.mainName.toLowerCase().includes(manualCustomerSearch.toLowerCase()))
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-field/50 text-ink"
                        onClick={() => {
                          setManualSelectedCustomer(c);
                          setManualCustomerSearch(c.mainName);
                          setShowCustomerDropdown(false);
                        }}
                      >
                        {c.mainName}
                      </button>
                    ))}
                  {customers.filter((c) => c.mainName.toLowerCase().includes(manualCustomerSearch.toLowerCase())).length === 0 && (
                    <div className="px-3 py-2 text-sm text-ink/40">ไม่พบชื่อลูกค้า</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-black/5 bg-field/40 p-3">
          <p className="text-xs font-semibold text-ink/50">เลขบัญชี</p>
          {bankAccounts.length > 0 ? (
            <div className="flex gap-2">
              <select
                value={selectedAccountNumber || ""}
                onChange={(e) => setSelectedAccountNumber(e.target.value)}
                className="mt-1 w-full rounded border border-black/10 bg-white px-2 py-1 text-sm font-bold font-mono text-ink focus:border-river focus:outline-none"
              >
                {bankAccounts.map(a => (
                  <option key={a.accountNumber} value={a.accountNumber}>
                    {a.isPrimary ? "[หลัก] " : ""}{a.bankName} - {a.accountNumber} {a.accountName ? `(${a.accountName})` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleCopyBankAccount}
                className="mt-1 flex items-center justify-center rounded border border-black/10 bg-white px-2 py-1 text-river hover:bg-field focus:outline-none"
                title="คัดลอกเลขบัญชี"
              >
                <Copy size={16} />
              </button>
            </div>
          ) : (
            <p className="mt-1 text-sm font-mono font-bold text-ink/30">—</p>
          )}
        </div>
        <div className="rounded-lg border border-black/5 bg-field/40 p-3">
          <p className="text-xs font-semibold text-ink/50">ผู้สร้าง</p>
          <p className="mt-1 text-sm font-semibold text-ink">{profile.name} · {profile.phone}</p>
        </div>
        <div className="rounded-lg border border-black/5 bg-field/40 p-3">
          <p className="text-xs font-semibold text-ink/50">วันเวลาสร้าง</p>
          <p className="mt-1 text-sm font-semibold text-ink">
            {new Date().toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
          </p>
        </div>
      </div>

      {/* ── Net Amount Summary ── */}
      <div className="rounded-lg border border-river/20 bg-river/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-ink/70">ยอดสุทธิที่ต้องจ่ายลูกค้า</span>
          <span className="text-2xl font-bold text-river">{formatCurrency(totalFromItems)}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink/50">ยอดสลิปรวม: {formatCurrency(totalFromSlips)}</span>
          {computedStatus === "paid" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-leaf/10 px-2 py-0.5 text-xs font-bold text-leaf">
              <CheckCircle2 size={12} /> จ่ายครบ
            </span>
          )}
          {computedStatus === "overpaid" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-clay/10 px-2 py-0.5 text-xs font-bold text-clay">
              <AlertCircle size={12} /> ชำระเกิน — ยอดเกิน {formatCurrency(Math.abs(totalFromItems - totalFromSlips))}
            </span>
          )}
          {computedStatus === "partial" && (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber/20 px-2 py-0.5 text-xs font-bold text-amber">
                <AlertCircle size={12} /> ค้างจ่าย — ยอดไม่ครบ {formatCurrency(Math.abs(totalFromItems - totalFromSlips))}
              </span>
              <button
                type="button"
                onClick={() => setIsBranchPayingRemaining(true)}
                className="ml-auto rounded-md bg-river px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-river/90 hover:-translate-y-0.5 transition-all focus:outline-none focus:ring-2 focus:ring-river/50"
              >
                🏢 สาขาจ่ายส่วนต่าง
              </button>
            </>
          )}
          {computedStatus === "branch_and_transfer" && (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-leaf/10 px-2 py-0.5 text-xs font-bold text-leaf">
                <CheckCircle2 size={12} /> โอน+สาขาจ่าย (สาขาจ่าย {formatCurrency(Math.abs(totalFromItems - totalFromSlips))})
              </span>
              <button
                type="button"
                onClick={() => setIsBranchPayingRemaining(false)}
                className="ml-auto text-[10px] font-bold text-ink/40 hover:text-clay transition-colors underline"
              >
                ยกเลิกสาขาจ่าย
              </button>
            </>
          )}
          {computedStatus === "pending" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber/20 px-2 py-0.5 text-xs font-bold text-amber">
              <AlertCircle size={12} /> รอโอน
            </span>
          )}
          {computedStatus === "advance_payment" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-bold text-purple-600">
              <Banknote size={12} /> จ่ายล่วงหน้า
            </span>
          )}
        </div>
      </div>

      {/* ═══ Child 2: Selected Bills/Tickets ═══ */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-ink">
            <Banknote size={16} className="mr-1.5 inline-block text-leaf" />
            รายการบิลที่เลือก ({selectedItems.length})
          </h4>
          <button
            type="button"
            onClick={() => setShowItemPicker(!showItemPicker)}
            className="focus-ring flex items-center gap-1.5 rounded-md bg-leaf px-3 py-2 text-sm font-semibold text-white hover:bg-leaf/90"
          >
            {showItemPicker ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showItemPicker ? "ซ่อนรายการ" : "เลือกบิลยาง / ใบชั่ง"}
          </button>
        </div>

        {/* Selected items table */}
        {selectedItems.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-black/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/5 bg-field/30 text-left text-xs font-bold text-ink/50">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">ประเภท</th>
                  <th className="px-3 py-2">ลูกค้า</th>
                  <th className="px-3 py-2 text-right">ยอดเงิน (฿)</th>
                  <th className="px-3 py-2 text-center">ลบ</th>
                </tr>
              </thead>
              <tbody>
                {selectedItems.map((item, idx) => (
                  <tr key={item.id} className="border-b border-black/5">
                    <td className="px-3 py-2 font-mono text-ink/40">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${item.sourceType === "rubber_bill" ? "bg-leaf/10 text-leaf" : "bg-river/10 text-river"}`}>
                        {item.sourceType === "rubber_bill" ? "บิลยาง" : "ใบชั่ง"}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-semibold">{item.customerName ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-river">{formatCurrency(item.amount)}</td>
                    <td className="px-3 py-2 text-center">
                      <button type="button" onClick={() => setSelectedItems((prev) => prev.filter((i) => i.id !== item.id))} className="text-ink/40 hover:text-clay">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Item picker */}
        {showItemPicker && (
          <ItemPicker
            bills={bills}
            ocrTickets={ocrTickets}
            usedSourceIds={usedSourceIds}
            selectedItems={selectedItems}
            onSelect={(item) => setSelectedItems((prev) => [...prev, item])}
            onDeselect={(sourceId) => setSelectedItems((prev) => prev.filter((i) => i.sourceId !== sourceId))}
          />
        )}
      </div>

      {/* ═══ Child 1: Slips ═══ */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-ink">
            <FileImage size={16} className="mr-1.5 inline-block text-river" />
            สลิปโอนเงิน ({slips.length})
          </h4>
          <div className="flex gap-2">
            <button type="button" onClick={addEmptySlip} disabled={!online} title={online ? undefined : "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น"} className="focus-ring flex items-center gap-1.5 rounded-md border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-field disabled:cursor-not-allowed disabled:opacity-50">
              <Plus size={14} /> เพิ่มเอง
            </button>
            <button
              type="button"
              onClick={() => slipFileRef.current?.click()}
              disabled={!online || slipUploading}
              title={online ? undefined : "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น"}
              className="focus-ring flex items-center gap-1.5 rounded-md bg-river px-3 py-2 text-sm font-semibold text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {slipUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              อ่านสลิป
            </button>
            <input
              ref={slipFileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={!online}
              onChange={(e) => {
                if (e.target.files) handleSlipUpload(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {slips.length > 0 && (
          <div className="space-y-3">
            {slips.map((slip, idx) => (
              <SlipRow
                key={slip.id}
                slip={slip}
                index={idx}
                isEdit={isEdit}
                onUpdate={updateSlip}
                onRemove={removeSlip}
              />
            ))}
          </div>
        )}

        {slips.length === 0 && (
          <p className="rounded-lg border border-dashed border-black/10 bg-field/30 py-6 text-center text-sm text-ink/40">
            ยังไม่มีสลิป — กด &quot;อ่านสลิป&quot; เพื่ออัปโหลดรูป หรือ &quot;เพิ่มเอง&quot;
          </p>
        )}
      </div>

      {/* ── Actions ── */}
      <div className="flex items-center justify-between border-t border-black/5 pt-4">
        <button type="button" onClick={onCancel} className="focus-ring rounded-md border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-field">
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!online}
          title={online ? undefined : "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น"}
          className="focus-ring flex items-center gap-1.5 rounded-md bg-river px-5 py-2 text-sm font-semibold text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save size={15} /> บันทึก
        </button>
      </div>
    </div>
  );
}
