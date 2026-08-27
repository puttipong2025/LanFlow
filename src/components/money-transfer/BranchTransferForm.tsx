"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { CheckCircle2, Save, Upload, Loader2, Plus } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import type { Location, MoneyTransfer, MoneyTransferSlip, Profile } from "@/types";
import { SlipRow, type OcrSlipResult } from "./SlipRow";
import { SlipValidationSummary } from "./SlipValidationSummary";
import { focusFirstSlipIssue, validateMoneyTransferSlips, type SlipValidationIssue } from "./slip-validation";
import { normalizeBangkokDateTime } from "@/lib/bangkok-date";
import { formatCurrency } from "@/lib/format";
import { deriveMoneyTransferStatus, sumMoneyTransferSlips } from "@/lib/money-transfers/state";

export function BranchTransferForm({
  locationId,
  online,
  profile,
  locations,
  editTransfer,
  submitting,
  onSave,
  onCancel,
}: {
  locationId: string;
  online: boolean;
  profile: Profile;
  locations: Location[];
  editTransfer?: MoneyTransfer | null;
  submitting: boolean;
  onSave: (transfer: MoneyTransfer) => void;
  onCancel: () => void;
}) {
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(
    editTransfer?.targetLocationId ?? (locations.some((location) => location.id === locationId) ? locationId : null),
  );

  
  // Slips
  const [slips, setSlips] = useState<MoneyTransferSlip[]>(editTransfer?.slips ?? []);
  const [slipUploading, setSlipUploading] = useState(false);
  const [validationIssues, setValidationIssues] = useState<SlipValidationIssue[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSlipUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!online) {
        setFormError("โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น");
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
            inputMethod: "ocr",
            amount: result.amount ?? 0,
            referenceNumber: result.reference_number ?? null,
            fee: result.fee ?? 0,
            senderName: result.sender_name ?? null,
            receiverName: result.receiver_name ?? null,
            transactionDate: normalizeBangkokDateTime(result.transaction_date),
            slipImageUrl: null,
            sortOrder: 0,
          };
          setSlips((prev) => [...prev, { ...newSlip, sortOrder: prev.length }]);
        } catch (err) {
          console.error("Slip OCR failed:", err);
          setFormError(err instanceof Error ? err.message : "อ่านข้อมูลสลิปไม่สำเร็จ");
        }
      }
      setSlipUploading(false);
    },
    [online]
  );

  const addEmptySlip = useCallback(() => {
    if (!online) {
      setFormError("โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น");
      return;
    }
    const newSlip: MoneyTransferSlip = {
      id: crypto.randomUUID(),
      inputMethod: "manual",
      amount: 0,
      referenceNumber: null,
      fee: 0,
      senderName: null,
      receiverName: null,
      transactionDate: null,
      slipImageUrl: null,
      sortOrder: 0,
    };
    setSlips((prev) => [...prev, { ...newSlip, sortOrder: prev.length }]);
  }, [online]);

  const updateSlip = useCallback((id: string, field: keyof MoneyTransferSlip, value: any) => {
    setSlips((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
    setValidationIssues((current) => current.filter((issue) => issue.slipId !== id || issue.field !== field));
  }, []);

  const removeSlip = useCallback((id: string) => {
    setSlips((prev) => prev.filter((s) => s.id !== id));
    setValidationIssues((current) => current.filter((issue) => issue.slipId !== id));
  }, []);

  const totalFromSlips = useMemo(
    () => sumMoneyTransferSlips(slips),
    [slips]
  );

  const computedStatus = deriveMoneyTransferStatus({
    amountDue: totalFromSlips,
    amountPaid: totalFromSlips,
  });

  const handleSubmit = useCallback(() => {
    if (submitting) return;
    setFormError(null);
    if (!online) {
      setFormError("โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น");
      return;
    }
    if (!selectedLocationId) {
      setFormError("กรุณาเลือกสาขาผู้รับ");
      return;
    }

    const issues = validateMoneyTransferSlips(slips, {
      requireOne: true,
      requireSameBangkokDate: true,
    });
    setValidationIssues(issues);
    if (issues.length > 0) {
      focusFirstSlipIssue(issues);
      return;
    }

    const targetLoc = locations.find(l => l.id === selectedLocationId);

    const transfer: MoneyTransfer = {
      id: editTransfer?.id ?? crypto.randomUUID(),
      clientTempId: editTransfer?.clientTempId ?? crypto.randomUUID(),
      idempotencyKey: editTransfer?.idempotencyKey ?? `mt:${crypto.randomUUID()}`,
      locationId: selectedLocationId,
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
      revisionNo: editTransfer?.revisionNo ?? 0,
      createdByName: profile.name,
      createdByPhone: profile.phone,
      slips,
      items: [],
    };
    onSave(transfer);
  }, [
    editTransfer,
    selectedLocationId,
    locations,
    profile,
    slips,
    onSave,
    computedStatus,
    totalFromSlips,
    online,
    submitting,
  ]);

  const slipErrors = useMemo(() => {
    const result = new Map<string, Partial<Record<SlipValidationIssue["field"], string>>>();
    validationIssues.forEach((issue) => {
      if (!issue.slipId) return;
      result.set(issue.slipId, { ...result.get(issue.slipId), [issue.field]: issue.message });
    });
    return result;
  }, [validationIssues]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-6">
      {formError && <p role="alert" className="rounded-md border border-clay/25 bg-clay/10 px-4 py-3 text-sm font-semibold text-ink/80">{formError}</p>}
      <SlipValidationSummary issues={validationIssues} />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-black/5 bg-field/40 p-3 overflow-visible">
            <p className="text-xs font-semibold text-ink/50">
              สาขาที่รับเงิน
            </p>
            <select
              aria-label="สาขาที่รับเงิน"
              value={selectedLocationId || ""}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              className="mt-1 w-full rounded border border-black/10 bg-white px-2 py-1 text-sm font-bold text-ink focus:border-river focus:outline-none"
            >
              <option value="" disabled>-- เลือกสาขา --</option>
              {locations.map(loc => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Net Amount Summary ── */}
        <div className="rounded-lg border border-river/20 bg-river/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink/70">
              ยอดรวมที่โอนให้สาขา
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
                disabled={submitting || slipUploading || !online}
                title={online ? undefined : "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น"}
                className="focus-ring flex items-center gap-1.5 rounded-md bg-river px-3 py-1.5 text-xs font-semibold text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {slipUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                อ่านสลิป
              </button>
              <button
                type="button"
                onClick={addEmptySlip}
                disabled={submitting || !online}
                title={online ? undefined : "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น"}
                className="focus-ring flex items-center gap-1.5 rounded-md bg-leaf px-3 py-1.5 text-xs font-semibold text-white hover:bg-leaf/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={14} /> เพิ่มเอง
              </button>
            </div>
            <input type="file" accept="image/*" multiple className="hidden" ref={fileInputRef} onChange={handleSlipUpload} disabled={submitting || !online} />
          </div>
          {slips.length > 0 ? (
            <div className="space-y-2">
              {slips.map((slip, i) => (
                <SlipRow key={slip.id} slip={slip} index={i} errors={slipErrors.get(slip.id)} onUpdate={updateSlip} onRemove={removeSlip} />
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
        <button type="button" onClick={onCancel} disabled={submitting} className="focus-ring rounded-md bg-actionSecondary px-4 py-2 text-sm font-semibold text-white hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-50">ยกเลิก</button>
        <div className="flex items-center gap-3">
          {!online && (
            <span className="text-sm font-semibold text-clay text-right">
              รายการโอนให้สาขาต้องออนไลน์ก่อนบันทึก
            </span>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !selectedLocationId || slips.length === 0 || !online}
            className="focus-ring flex items-center gap-1.5 rounded-md bg-commit px-5 py-2 text-sm font-semibold text-white hover:bg-commit/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {submitting ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}
