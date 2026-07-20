"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Banknote, CheckCircle2, Copy, Save, Upload, X, Loader2, Plus } from "lucide-react";
import Swal from "sweetalert2";
import { useAuth } from "@/hooks/use-auth";
import { authFetch } from "@/lib/auth-fetch";
import type { MoneyTransfer, MoneyTransferSlip } from "@/types";
import { useTransportStaffs } from "@/hooks/useTransportStaffs";
import { SlipRow, type OcrSlipResult } from "./SlipRow";
import { formatCurrency } from "@/lib/format";

export function TransportTransferForm({
  locationId,
  online,
  editTransfer,
  onSave,
  onCancel,
}: {
  locationId: string;
  online: boolean;
  editTransfer?: MoneyTransfer | null;
  onSave: (transfer: MoneyTransfer) => void;
  onCancel: () => void;
}) {
  const { profile } = useAuth();
  const isEdit = !!editTransfer;
  const { staffs } = useTransportStaffs();

  // Search and selection
  const [transportSearch, setTransportSearch] = useState(editTransfer?.transportStaffName ?? "");
  const [showTransportDropdown, setShowTransportDropdown] = useState(false);
  
  const matchingStaffs = useMemo(() => {
    if (!transportSearch) return staffs;
    const lower = transportSearch.toLowerCase();
    return staffs.filter(s => s.mainName.toLowerCase().includes(lower));
  }, [transportSearch, staffs]);

  const matchingStaff = useMemo(() => {
    return staffs.find(s => s.mainName === transportSearch) ?? null;
  }, [transportSearch, staffs]);

  // Bank account
  const bankAccounts = useMemo(() => {
    if (!matchingStaff?.bankAccounts) return [];
    return [...matchingStaff.bankAccounts].sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
  }, [matchingStaff]);

  const defaultAccount = bankAccounts[0] ?? null;
  const [selectedAccountNumber, setSelectedAccountNumber] = useState<string | null>(editTransfer?.accountNumber ?? null);

  useEffect(() => {
    if (matchingStaff) {
      const exists = bankAccounts.some(a => a.accountNumber === selectedAccountNumber);
      if (!exists && defaultAccount) {
        setSelectedAccountNumber(defaultAccount.accountNumber);
      } else if (!exists && !defaultAccount) {
        setSelectedAccountNumber(null);
      }
    } else {
      setSelectedAccountNumber(null);
    }
  }, [matchingStaff, selectedAccountNumber, bankAccounts, defaultAccount]);

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

  // Cost
  const [transportCostInput, setTransportCostInput] = useState<string>(
    editTransfer?.transportCost ? editTransfer.transportCost.toString() : ""
  );
  
  const totalCost = parseFloat(transportCostInput) || 0;

  // Slips
  const [slips, setSlips] = useState<MoneyTransferSlip[]>(editTransfer?.slips ?? []);
  const [slipUploading, setSlipUploading] = useState(false);

  const handleSlipUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!online) {
        void Swal.fire({
          icon: "warning",
          title: "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น",
          confirmButtonColor: "#3b82f6",
          confirmButtonText: "ตกลง"
        });
        e.target.value = "";
        return;
      }
      const files = e.target.files;
      if (!files || files.length === 0) return;
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
    [slips.length, online]
  );

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

  const totalFromSlips = useMemo(
    () => slips.reduce((sum, s) => sum + s.amount, 0),
    [slips]
  );
  
  const [isBranchPayingRemaining, setIsBranchPayingRemaining] = useState(
    editTransfer?.transferStatus === "branch_and_transfer"
  );

  useEffect(() => {
    setIsBranchPayingRemaining(editTransfer?.transferStatus === "branch_and_transfer");
  }, [slips, editTransfer?.transferStatus]);

  const computedStatus = useMemo(() => {
    if (totalFromSlips === 0) return "pending"; 
    if (totalCost === 0 && totalFromSlips > 0) return "advance_payment"; 
    const diff = totalCost - totalFromSlips;
    if (Math.abs(diff) < 0.01) return "paid"; 
    if (diff > 0.01) {
      if (isBranchPayingRemaining) return "branch_and_transfer"; 
      return "partial"; 
    }
    return "overpaid"; 
  }, [totalFromSlips, totalCost, isBranchPayingRemaining]);

  const slipAmountMatch = Math.abs(totalCost - totalFromSlips) < 0.01;

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
    if (!matchingStaff && !transportSearch) return;

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
      customerId: null,
      customerName: null,
      accountNumber: bankAccount?.accountNumber ?? null,
      accountName: bankAccount?.accountName ?? null,
      bankName: bankAccount?.bankName ?? null,
      netAmountToPay: totalCost,
      transferType: "transport",
      transportCost: totalCost,
      transportStaffId: matchingStaff?.id ?? null,
      transportStaffName: matchingStaff?.mainName ?? transportSearch ?? null,
      targetLocationId: null,
      targetLocationName: null,
      transferStatus: computedStatus,
      branchPaidAmount: computedStatus === "branch_and_transfer" ? totalCost - totalFromSlips : 0,
      syncStatus: "pending",
      recordStatus: "active",
      revisionNo: (editTransfer?.revisionNo ?? 0) + (isEdit ? 1 : 0),
      createdByName: profile?.name,
      createdByPhone: profile?.phone,
      slips,
      items: [],
    };
    onSave(transfer);
  }, [
    editTransfer,
    locationId,
    matchingStaff,
    transportSearch,
    bankAccount,
    totalCost,
    isEdit,
    profile,
    slips,
    onSave,
    computedStatus,
    totalFromSlips,
    online,
  ]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex max-h-[85vh] flex-col rounded-lg bg-white shadow-2xl overflow-hidden">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-black/5 p-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
          <Banknote className="text-river" />
          {isEdit ? "แก้ไขรายการโอนเงิน (รถขนส่ง)" : "สร้างรายการโอนเงินใหม่ (รถขนส่ง)"}
        </h3>
        <button onClick={onCancel} className="rounded-md p-1 hover:bg-black/5">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-black/5 bg-field/40 p-3 overflow-visible">
            <p className="text-xs font-semibold text-ink/50">รถขนส่ง</p>
            <div className="relative mt-1">
              <input
                value={transportSearch}
                onChange={(e) => {
                  setTransportSearch(e.target.value);
                  setShowTransportDropdown(true);
                }}
                onFocus={() => setShowTransportDropdown(true)}
                onBlur={() => setTimeout(() => setShowTransportDropdown(false), 200)}
                className="w-full rounded bg-white px-2 py-1 text-sm font-bold text-ink border border-black/10 focus:outline-none focus:border-river"
                placeholder="พิมพ์ชื่อรถขนส่ง..."
              />
              {showTransportDropdown && matchingStaffs.length > 0 && (
                <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-black/10 bg-white shadow-lg">
                  {matchingStaffs.map(staff => (
                    <button
                      key={staff.id}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-field"
                      onMouseDown={() => {
                        setTransportSearch(staff.mainName);
                        setShowTransportDropdown(false);
                      }}
                    >
                      <div className="font-bold text-ink">{staff.mainName}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
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
            <p className="text-xs font-semibold text-ink/50">ค่าขนส่ง</p>
            <input 
              type="number"
              value={transportCostInput}
              onChange={(e) => setTransportCostInput(e.target.value)}
              className="mt-1 w-full rounded bg-white px-2 py-1 text-sm font-bold text-ink border border-black/10 focus:outline-none focus:border-river"
              placeholder="0.00"
            />
          </div>
        </div>

        {/* ── Net Amount Summary ── */}
        <div className="rounded-lg border border-river/20 bg-river/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink/70">ยอดสุทธิที่ต้องจ่ายค่าขนส่ง</span>
            <span className="text-2xl font-bold text-river">{formatCurrency(totalCost)}</span>
          </div>
          {slips.length > 0 && (
            <div className="mt-4 flex flex-col items-end gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-ink/50">ยอดสลิปรวม: {formatCurrency(totalFromSlips)}</span>
                {slipAmountMatch ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-leaf/10 px-2 py-0.5 text-xs font-bold text-leaf">
                    <CheckCircle2 size={12} /> ตรงกัน
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-clay/10 px-2 py-0.5 text-xs font-bold text-clay">
                    <AlertCircle size={12} /> ไม่ตรง (ต่าง {formatCurrency(Math.abs(totalCost - totalFromSlips))})
                  </span>
                )}
              </div>
              
              {!slipAmountMatch && totalCost - totalFromSlips > 0.01 && (
                <button
                  type="button"
                  onClick={() => setIsBranchPayingRemaining(!isBranchPayingRemaining)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                    isBranchPayingRemaining 
                      ? "bg-leaf text-white hover:bg-leaf/90" 
                      : "bg-amber/20 text-amber-700 hover:bg-amber/30"
                  }`}
                >
                  <CheckCircle2 size={14} className={isBranchPayingRemaining ? "text-white" : "text-amber-700"} />
                  {isBranchPayingRemaining ? "สาขากำลังจ่ายส่วนต่าง" : "ให้สาขาจ่ายส่วนต่าง"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Slips */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-ink">สลิปโอนเงิน / หลักฐาน</h4>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={slipUploading || !online}
                title={online ? undefined : "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น"}
                className="focus-ring flex items-center gap-1.5 rounded-md border border-river text-river px-3 py-1.5 text-xs font-semibold hover:bg-river/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {slipUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                อ่านสลิป
              </button>
              <button
                type="button"
                onClick={addEmptySlip}
                disabled={!online}
                title={online ? undefined : "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น"}
                className="focus-ring flex items-center gap-1.5 rounded-md bg-black/5 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={14} /> เพิ่มเอง
              </button>
            </div>
            <input type="file" accept="image/*" multiple className="hidden" ref={fileInputRef} onChange={handleSlipUpload} disabled={!online} />
          </div>
          {slips.length > 0 ? (
            <div className="space-y-2">
              {slips.map((slip, i) => (
                <SlipRow key={slip.id} slip={slip} index={i} isEdit={isEdit} onUpdate={updateSlip} onRemove={removeSlip} />
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-black/10 bg-field/30 py-6 text-center text-sm text-ink/40">
              ยังไม่มีสลิป
            </p>
          )}
        </div>
      </div>
      
      <div className="flex flex-shrink-0 items-center justify-between border-t border-black/5 p-4">
        <button type="button" onClick={onCancel} className="focus-ring rounded-md border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-field">ยกเลิก</button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!online}
          title={online ? undefined : "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น"}
          className="focus-ring flex items-center gap-1.5 rounded-md bg-river px-5 py-2 text-sm font-semibold text-white hover:bg-river/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save size={15} /> บันทึก
        </button>
      </div>
    </div>
  );
}
