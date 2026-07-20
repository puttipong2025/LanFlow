"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Banknote, CheckCircle2, Save, Upload, X, Loader2, Plus } from "lucide-react";
import Swal from "sweetalert2";
import { useAuth } from "@/hooks/use-auth";
import { authFetch } from "@/lib/auth-fetch";
import type { MoneyTransfer, MoneyTransferSlip } from "@/types";
import { useLocations } from "@/hooks/useLocations";
import { SlipRow, type OcrSlipResult } from "./SlipRow";
import { formatCurrency } from "@/lib/format";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export function BranchTransferForm({
  locationId,
  mode = "branch-to-branch",
  editTransfer,
  onSave,
  onCancel,
}: {
  locationId: string;
  mode?: "branch-to-branch" | "head-office-to-branch";
  editTransfer?: MoneyTransfer | null;
  onSave: (transfer: MoneyTransfer) => void;
  onCancel: () => void;
}) {
  const { profile } = useAuth();
  const isEdit = !!editTransfer;
  const isHeadOfficeTransfer = mode === "head-office-to-branch";
  const { locations } = useLocations();
  const isOnline = useOnlineStatus();

  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(editTransfer?.targetLocationId ?? null);

  
  // Slips
  const [slips, setSlips] = useState<MoneyTransferSlip[]>(editTransfer?.slips ?? []);
  const [slipUploading, setSlipUploading] = useState(false);

  const handleSlipUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isOnline) {
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
    [slips.length, isOnline]
  );

  const addEmptySlip = useCallback(() => {
    if (!isOnline) {
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
  }, [slips.length, isOnline]);

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

  const computedStatus = slips.length > 0 ? "paid" : "pending";

  const handleSubmit = useCallback(() => {
    if (!isOnline) {
      void Swal.fire({
        icon: "warning",
        title: "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น",
        confirmButtonColor: "#3b82f6",
        confirmButtonText: "ตกลง"
      });
      return;
    }
    if (!selectedLocationId) return;

    if (!isHeadOfficeTransfer && selectedLocationId === locationId) {
      Swal.fire({
        icon: "warning",
        title: "เลือกสาขาไม่ถูกต้อง",
        text: "สาขาปลายทางต้องไม่ใช่สาขาปัจจุบัน",
        confirmButtonColor: "#3b82f6",
        confirmButtonText: "ตกลง"
      });
      return;
    }

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

    const targetLoc = locations.find(l => l.id === selectedLocationId);
    const transferLocationId = isHeadOfficeTransfer ? selectedLocationId : locationId;
    
    const transfer: MoneyTransfer = {
      id: editTransfer?.id ?? crypto.randomUUID(),
      clientTempId: editTransfer?.clientTempId ?? crypto.randomUUID(),
      idempotencyKey: editTransfer?.idempotencyKey ?? `mt:${crypto.randomUUID()}`,
      locationId: transferLocationId,
      customerId: null,
      customerName: null,
      accountNumber: null,
      accountName: null,
      bankName: null,
      netAmountToPay: totalFromSlips, // For branch, just track what was sent
      transferType: "branch",
      transportCost: 0,
      transportStaffId: null,
      transportStaffName: null,
      targetLocationId: selectedLocationId,
      targetLocationName: targetLoc?.name ?? null,
      transferStatus: computedStatus,
      branchPaidAmount: 0,
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
    isHeadOfficeTransfer,
    selectedLocationId,
    locations,
    isEdit,
    profile,
    slips,
    onSave,
    computedStatus,
    totalFromSlips,
    isOnline,
  ]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex max-h-[85vh] flex-col rounded-lg bg-white shadow-2xl overflow-hidden">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-black/5 p-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
          <Banknote className="text-river" />
          {isHeadOfficeTransfer
            ? (isEdit ? "แก้ไขรายการโอนเงิน (ให้สาขา)" : "สร้างรายการโอนเงินใหม่ (ให้สาขา)")
            : (isEdit ? "แก้ไขรายการโอนเงิน (ระหว่างสาขา)" : "สร้างรายการโอนเงินใหม่ (ระหว่างสาขา)")}
        </h3>
        <button onClick={onCancel} className="rounded-md p-1 hover:bg-black/5">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-black/5 bg-field/40 p-3 overflow-visible">
            <p className="text-xs font-semibold text-ink/50">
              {isHeadOfficeTransfer ? "สาขาที่รับเงิน" : "สาขาปลายทาง"}
            </p>
            <select
              value={selectedLocationId || ""}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              className="mt-1 w-full rounded border border-black/10 bg-white px-2 py-1 text-sm font-bold text-ink focus:border-river focus:outline-none"
            >
              <option value="" disabled>-- เลือกสาขา --</option>
              {locations.map(loc => (
                <option key={loc.id} value={loc.id} disabled={!isHeadOfficeTransfer && loc.id === locationId}>
                  {loc.name} {!isHeadOfficeTransfer && loc.id === locationId ? "(สาขาปัจจุบัน)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Net Amount Summary ── */}
        <div className="rounded-lg border border-river/20 bg-river/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink/70">
              {isHeadOfficeTransfer ? "ยอดรวมที่โอนให้สาขา" : "ยอดรวมที่โอนระหว่างสาขา"}
            </span>
            <span className="text-2xl font-bold text-river">{formatCurrency(totalFromSlips)}</span>
          </div>
          {slips.length > 0 && (
            <div className="mt-2 text-sm font-bold text-leaf">
              <CheckCircle2 size={14} className="inline mr-1" />
              แนบสลิปแล้ว สถานะ: โอนแล้ว
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
                disabled={slipUploading || !isOnline}
                title={isOnline ? undefined : "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น"}
                className="focus-ring flex items-center gap-1.5 rounded-md border border-river text-river px-3 py-1.5 text-xs font-semibold hover:bg-river/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {slipUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                อ่านสลิป
              </button>
              <button
                type="button"
                onClick={addEmptySlip}
                disabled={!isOnline}
                title={isOnline ? undefined : "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น"}
                className="focus-ring flex items-center gap-1.5 rounded-md bg-black/5 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={14} /> เพิ่มเอง
              </button>
            </div>
            <input type="file" accept="image/*" multiple className="hidden" ref={fileInputRef} onChange={handleSlipUpload} disabled={!isOnline} />
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
        <div className="flex items-center gap-3">
          {!isOnline && (
            <span className="text-sm font-semibold text-clay text-right">
              {isHeadOfficeTransfer ? "รายการโอนให้สาขาต้องออนไลน์ก่อนบันทึก" : "รายการโยกเงินต้องออนไลน์ก่อนบันทึก"}
            </span>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedLocationId || (!isHeadOfficeTransfer && selectedLocationId === locationId) || slips.length === 0 || !isOnline}
            className="focus-ring flex items-center gap-1.5 rounded-md bg-river px-5 py-2 text-sm font-semibold text-white hover:bg-river/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={15} /> บันทึก
          </button>
        </div>
      </div>
    </div>
  );
}
