"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownUp,
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Edit3,
  FileImage,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
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

/* ── OCR Slip API Result ── */
type OcrSlipResult = {
  amount: number | null;
  reference_number: string | null;
  fee: number | null;
  sender_name: string | null;
  receiver_name: string | null;
  transaction_date: string | null;
};

type Props = {
  locationId: string;
  online: boolean;
  profile: Profile;
  transfers: MoneyTransfer[];
  bills: RubberBill[];
  ocrTickets: OcrTicket[];
  customers: Customer[];
  usedSourceIds: Set<string>;
  onSave: (transfer: MoneyTransfer) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
};

/* ═════════════════════════════════════════════════════════
   Main Module
   ═════════════════════════════════════════════════════════ */
export function MoneyTransferModule({
  locationId,
  online,
  profile,
  transfers,
  bills,
  ocrTickets,
  customers,
  usedSourceIds,
  onSave,
  onDelete,
  onRefresh,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editTransfer, setEditTransfer] = useState<MoneyTransfer | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const handleSave = useCallback(
    (transfer: MoneyTransfer) => {
      onSave(transfer);
      setShowForm(false);
      setEditTransfer(null);
      setToastMsg("บันทึกรายการโอนเงินสำเร็จ");
    },
    [onSave]
  );

  const handleDeleteConfirm = useCallback(() => {
    if (deleteConfirmId) {
      onDelete(deleteConfirmId);
      setDeleteConfirmId(null);
      setToastMsg("ลบรายการโอนเงินสำเร็จ");
    }
  }, [deleteConfirmId, onDelete]);

  const handleEdit = useCallback((t: MoneyTransfer) => {
    setEditTransfer(t);
    setShowForm(true);
  }, []);

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 animate-pulse rounded-lg bg-leaf px-4 py-2 text-sm font-semibold text-white shadow-lg">
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">
            <ArrowDownUp size={22} className="mr-2 inline-block text-river" />
            ระบบโอนเงิน
          </h2>
          <p className="mt-1 text-sm text-ink/60">
            สร้างรายการโอนเงินจากบิลยางและใบชั่ง พร้อมอัปโหลดสลิป
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => {
              setEditTransfer(null);
              setShowForm(true);
            }}
            className="focus-ring flex items-center gap-1.5 rounded-md bg-river px-4 py-2.5 text-sm font-semibold text-white hover:bg-river/90"
          >
            <Plus size={16} /> สร้างรายการโอน
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <TransferForm
          locationId={locationId}
          online={online}
          profile={profile}
          bills={bills}
          ocrTickets={ocrTickets}
          customers={customers}
          usedSourceIds={usedSourceIds}
          editTransfer={editTransfer}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false);
            setEditTransfer(null);
          }}
        />
      )}

      {/* List */}
      {transfers.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-panel">
          <div className="flex items-center justify-between border-b border-black/5 bg-field/60 px-5 py-3">
            <h3 className="font-bold text-ink">
              <CheckCircle2 size={16} className="mr-1.5 inline-block text-river" />
              รายการโอนเงิน ({transfers.length} รายการ)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/5 bg-field/30 text-left text-xs font-bold uppercase tracking-wider text-ink/50">
                  <th className="px-3 py-3">#</th>
                  <th className="px-3 py-3">ลูกค้า</th>
                  <th className="px-3 py-3">เลขบัญชี</th>
                  <th className="px-3 py-3 text-right">ยอดจ่าย</th>
                  <th className="px-3 py-3 text-center">สลิป</th>
                  <th className="px-3 py-3 text-center">รายการ</th>
                  <th className="px-3 py-3">สถานะ</th>
                  <th className="px-3 py-3">สร้างโดย</th>
                  <th className="px-3 py-3">วันที่สร้าง</th>
                  <th className="px-3 py-3 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t, idx) => (
                  <tr key={t.id} className="border-b border-black/5 transition-colors hover:bg-mint/20">
                    <td className="px-3 py-2.5 font-mono text-ink/40">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-semibold text-ink">{t.customerName ?? "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-ink/70">{t.accountNumber ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-river">
                      {formatCurrency(t.netAmountToPay)}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="rounded-full bg-river/10 px-2 py-0.5 text-xs font-bold text-river">
                        {t.slips?.length ?? 0}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="rounded-full bg-leaf/10 px-2 py-0.5 text-xs font-bold text-leaf">
                        {t.items?.length ?? 0}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          t.transferStatus === "completed"
                            ? "bg-leaf/10 text-leaf"
                            : t.transferStatus === "cancelled"
                            ? "bg-clay/10 text-clay"
                            : "bg-amber/20 text-amber"
                        }`}
                      >
                        {t.transferStatus === "completed" ? "โอนแล้ว" : t.transferStatus === "cancelled" ? "ยกเลิก" : "รอโอน"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-ink/60">{t.createdByName ?? "—"}</td>
                    <td className="px-3 py-2.5 text-sm text-ink/60">
                      {t.createdAt ? new Date(t.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleEdit(t)}
                          className="grid h-7 w-7 place-items-center rounded-md text-ink/50 hover:bg-mint hover:text-leaf"
                          title="แก้ไข"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(t.id)}
                          className="grid h-7 w-7 place-items-center rounded-md text-ink/50 hover:bg-clay/10 hover:text-clay"
                          title="ลบ"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {transfers.length === 0 && !showForm && (
        <div className="rounded-xl border border-dashed border-black/10 bg-white/60 px-8 py-12 text-center">
          <ArrowDownUp size={48} className="mx-auto mb-3 text-ink/20" />
          <p className="text-lg font-semibold text-ink/40">ยังไม่มีรายการโอนเงิน</p>
          <p className="mt-1 text-sm text-ink/30">กดปุ่ม &quot;สร้างรายการโอน&quot; เพื่อเริ่มต้น</p>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDeleteConfirmId(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-ink">ยืนยันการลบ</h3>
            <p className="mt-2 text-sm text-ink/70">คุณแน่ใจหรือไม่ว่าต้องการลบรายการโอนเงินนี้? บิลยาง/ใบชั่งที่เลือกไว้จะสามารถเลือกใช้ใหม่ได้</p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteConfirmId(null)} className="focus-ring rounded-md border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-field">
                ยกเลิก
              </button>
              <button type="button" onClick={handleDeleteConfirm} className="focus-ring rounded-md bg-clay px-4 py-2 text-sm font-semibold text-white hover:bg-clay/90">
                ลบ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════
   Transfer Form (Parent–Child)
   ═════════════════════════════════════════════════════════ */
function TransferForm({
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
  const slipAmountMatch = Math.abs(totalFromItems - totalFromSlips) < 0.01;

  // Customer info from selected items
  const customerName = selectedItems.length > 0 ? selectedItems[0].customerName : null;
  const matchingCustomer = useMemo(() => {
    if (!customerName) return null;
    return customers.find((c) => c.mainName === customerName) ?? null;
  }, [customerName, customers]);

  const bankAccount = matchingCustomer?.bankAccounts?.[0] ?? null;

  // ── Handler: Add slip from OCR ──
  const handleSlipUpload = useCallback(
    async (files: FileList) => {
      if (!online) return;
      setSlipUploading(true);
      for (const file of Array.from(files)) {
        try {
          const formData = new FormData();
          formData.append("image", file);
          const res = await fetch("/api/lanflow/ocr-slip", { method: "POST", body: formData });
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
  }, [slips.length]);

  const updateSlip = useCallback((id: string, field: keyof MoneyTransferSlip, value: any) => {
    setSlips((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  }, []);

  const removeSlip = useCallback((id: string) => {
    setSlips((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // ── Handler: Save ──
  const handleSubmit = useCallback(() => {
    if (selectedItems.length === 0) return;

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
      transferStatus: editTransfer?.transferStatus ?? "pending",
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
        <div className="rounded-lg border border-black/5 bg-field/40 p-3">
          <p className="text-xs font-semibold text-ink/50">ลูกค้า</p>
          <p className="mt-1 text-sm font-bold text-ink">
            {customerName ? (
              <span className="inline-flex items-center gap-1">
                <UserCheck size={14} className="text-leaf" /> {customerName}
              </span>
            ) : (
              <span className="text-ink/30">— เลือกบิลก่อน —</span>
            )}
          </p>
        </div>
        <div className="rounded-lg border border-black/5 bg-field/40 p-3">
          <p className="text-xs font-semibold text-ink/50">เลขบัญชี</p>
          <p className="mt-1 text-sm font-mono font-bold text-ink">
            {bankAccount ? `${bankAccount.bankName} · ${bankAccount.accountNumber}` : "—"}
          </p>
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
        {slips.length > 0 && (
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="text-ink/50">ยอดสลิปรวม: {formatCurrency(totalFromSlips)}</span>
            {slipAmountMatch ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-leaf/10 px-2 py-0.5 text-xs font-bold text-leaf">
                <CheckCircle2 size={12} /> ตรงกัน
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-clay/10 px-2 py-0.5 text-xs font-bold text-clay">
                <AlertCircle size={12} /> ไม่ตรง (ต่าง {formatCurrency(Math.abs(totalFromItems - totalFromSlips))})
              </span>
            )}
          </div>
        )}
      </div>

      {/* ═══ Child 2: Selected Bills/Tickets ═══ */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-ink">
            <Banknote size={16} className="mr-1.5 inline-block text-leaf" />
            รายการบิลที่เลือก ({selectedItems.length})
          </h4>
          {!isEdit && (
            <button
              type="button"
              onClick={() => setShowItemPicker(!showItemPicker)}
              className="focus-ring flex items-center gap-1.5 rounded-md bg-leaf px-3 py-2 text-sm font-semibold text-white hover:bg-leaf/90"
            >
              {showItemPicker ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showItemPicker ? "ซ่อนรายการ" : "เลือกบิลยาง / ใบชั่ง"}
            </button>
          )}
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
                  {!isEdit && <th className="px-3 py-2 text-center">ลบ</th>}
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
                    {!isEdit && (
                      <td className="px-3 py-2 text-center">
                        <button type="button" onClick={() => setSelectedItems((prev) => prev.filter((i) => i.id !== item.id))} className="text-ink/40 hover:text-clay">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Item picker */}
        {showItemPicker && !isEdit && (
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
            <button type="button" onClick={addEmptySlip} className="focus-ring flex items-center gap-1.5 rounded-md border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-field">
              <Plus size={14} /> เพิ่มเอง
            </button>
            <button
              type="button"
              onClick={() => slipFileRef.current?.click()}
              disabled={!online || slipUploading}
              className="focus-ring flex items-center gap-1.5 rounded-md bg-river px-3 py-2 text-sm font-semibold text-white hover:bg-river/90 disabled:opacity-50"
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
          disabled={selectedItems.length === 0 || (slips.length > 0 && !slipAmountMatch)}
          className="focus-ring flex items-center gap-1.5 rounded-md bg-river px-5 py-2 text-sm font-semibold text-white hover:bg-river/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save size={15} /> บันทึก
        </button>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════
   Slip Row
   ═════════════════════════════════════════════════════════ */
function SlipRow({
  slip,
  index,
  isEdit,
  onUpdate,
  onRemove,
}: {
  slip: MoneyTransferSlip;
  index: number;
  isEdit: boolean;
  onUpdate: (id: string, field: keyof MoneyTransferSlip, value: any) => void;
  onRemove: (id: string) => void;
}) {
  const refReadOnly = isEdit; // reference number is read-only when editing

  return (
    <div className="rounded-lg border border-black/10 bg-field/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold text-ink/40">สลิป #{index + 1}</span>
        <button type="button" onClick={() => onRemove(slip.id)} className="text-ink/40 hover:text-clay">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink/60">จำนวนเงิน (฿)</span>
          <input
            type="number"
            value={slip.amount || ""}
            onChange={(e) => onUpdate(slip.id, "amount", e.target.value ? Number(e.target.value) : 0)}
            className="focus-ring h-9 w-full rounded-md border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink/60">หมายเลขอ้างอิง</span>
          <input
            type="text"
            value={slip.referenceNumber ?? ""}
            readOnly={refReadOnly}
            onChange={(e) => onUpdate(slip.id, "referenceNumber", e.target.value || null)}
            className={`focus-ring h-9 w-full rounded-md border border-black/10 px-3 text-sm font-mono ${refReadOnly ? "bg-field/50 cursor-not-allowed" : "bg-white"}`}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink/60">ค่าธรรมเนียม (฿)</span>
          <input
            type="number"
            value={slip.fee || ""}
            onChange={(e) => onUpdate(slip.id, "fee", e.target.value ? Number(e.target.value) : 0)}
            className="focus-ring h-9 w-full rounded-md border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink/60">ชื่อผู้โอน</span>
          <input
            type="text"
            value={slip.senderName ?? ""}
            onChange={(e) => onUpdate(slip.id, "senderName", e.target.value || null)}
            className="focus-ring h-9 w-full rounded-md border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink/60">ชื่อผู้รับ</span>
          <input
            type="text"
            value={slip.receiverName ?? ""}
            onChange={(e) => onUpdate(slip.id, "receiverName", e.target.value || null)}
            className="focus-ring h-9 w-full rounded-md border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink/60">วันที่ทำรายการ</span>
          <input
            type="datetime-local"
            value={slip.transactionDate?.slice(0, 16) ?? ""}
            onChange={(e) => onUpdate(slip.id, "transactionDate", e.target.value ? new Date(e.target.value).toISOString() : null)}
            className="focus-ring h-9 w-full rounded-md border border-black/10 bg-white px-3 text-sm"
          />
        </label>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════
   Item Picker (เลือกบิลยาง / ใบชั่ง)
   ═════════════════════════════════════════════════════════ */
function ItemPicker({
  bills,
  ocrTickets,
  usedSourceIds,
  selectedItems,
  onSelect,
  onDeselect,
}: {
  bills: RubberBill[];
  ocrTickets: OcrTicket[];
  usedSourceIds: Set<string>;
  selectedItems: MoneyTransferItem[];
  onSelect: (item: MoneyTransferItem) => void;
  onDeselect: (sourceId: string) => void;
}) {
  const [tab, setTab] = useState<"rubber" | "ocr">("rubber");
  const selectedSourceIds = new Set(selectedItems.map((i) => i.sourceId));

  // Filter active bills/tickets
  const activeBills = bills.filter((b) => b.recordStatus !== "deleted");
  const activeTickets = ocrTickets.filter((t) => t.recordStatus !== "deleted");

  return (
    <div className="rounded-lg border border-leaf/20 bg-leaf/5 p-3">
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("rubber")}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold ${tab === "rubber" ? "bg-leaf text-white" : "bg-white text-ink hover:bg-field"}`}
        >
          บิลยาง ({activeBills.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("ocr")}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold ${tab === "ocr" ? "bg-river text-white" : "bg-white text-ink hover:bg-field"}`}
        >
          ใบชั่ง ({activeTickets.length})
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto rounded-lg border border-black/10 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-black/5 bg-field/60 text-left text-xs font-bold text-ink/50">
              <th className="px-3 py-2">เลือก</th>
              {tab === "rubber" ? (
                <>
                  <th className="px-3 py-2">เลขบิล</th>
                  <th className="px-3 py-2">ลูกค้า</th>
                  <th className="px-3 py-2">วันที่</th>
                  <th className="px-3 py-2 text-right">ยอดสุทธิ (฿)</th>
                </>
              ) : (
                <>
                  <th className="px-3 py-2">เลขที่</th>
                  <th className="px-3 py-2">ลูกค้า</th>
                  <th className="px-3 py-2">ทะเบียน</th>
                  <th className="px-3 py-2 text-right">ยอดเงิน (฿)</th>
                </>
              )}
              <th className="px-3 py-2 text-center">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {tab === "rubber" &&
              activeBills.map((bill) => {
                const alreadyUsed = usedSourceIds.has(bill.id);
                const alreadySelected = selectedSourceIds.has(bill.id);
                const noCustomer = !bill.customerName;
                const negative = bill.netTotal < 0;
                const disabled = alreadyUsed || noCustomer || negative;

                // If editing and this was part of the edit, allow re-show
                return (
                  <tr key={bill.id} className={`border-b border-black/5 ${disabled && !alreadySelected ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2">
                      {alreadySelected ? (
                        <button type="button" onClick={() => onDeselect(bill.id)} className="rounded bg-leaf px-2 py-0.5 text-xs font-bold text-white">
                          ✓
                        </button>
                      ) : disabled ? (
                        <span className="rounded bg-field px-2 py-0.5 text-xs font-bold text-ink/30">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            onSelect({
                              id: crypto.randomUUID(),
                              sourceType: "rubber_bill",
                              sourceId: bill.id,
                              customerName: bill.customerName,
                              amount: bill.netTotal,
                            })
                          }
                          className="rounded bg-leaf/10 px-2 py-0.5 text-xs font-bold text-leaf hover:bg-leaf/20"
                        >
                          เลือก
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono font-semibold">{bill.billNo}</td>
                    <td className="px-3 py-2">
                      {bill.customerName ? (
                        <span className="inline-flex items-center gap-1 text-xs"><UserCheck size={12} className="text-leaf" /> {bill.customerName}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-clay"><UserX size={12} /> ไม่มีชื่อ</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink/60">{bill.billDate}</td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${negative ? "text-clay" : "text-river"}`}>
                      {formatCurrency(bill.netTotal)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {alreadyUsed && !alreadySelected ? (
                        <span className="rounded-full bg-amber/20 px-2 py-0.5 text-xs font-bold text-amber">โอนแล้ว</span>
                      ) : noCustomer ? (
                        <span className="rounded-full bg-clay/10 px-2 py-0.5 text-xs font-bold text-clay">ไม่มีชื่อ</span>
                      ) : negative ? (
                        <span className="rounded-full bg-clay/10 px-2 py-0.5 text-xs font-bold text-clay">ติดลบ</span>
                      ) : (
                        <span className="rounded-full bg-leaf/10 px-2 py-0.5 text-xs font-bold text-leaf">พร้อม</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            {tab === "ocr" &&
              activeTickets.map((ticket) => {
                const alreadyUsed = usedSourceIds.has(ticket.id);
                const alreadySelected = selectedSourceIds.has(ticket.id);
                const noCustomer = !ticket.customerName;
                const amount = ticket.totalAmount ?? 0;
                const negative = amount < 0;
                const disabled = alreadyUsed || noCustomer || negative;

                return (
                  <tr key={ticket.id} className={`border-b border-black/5 ${disabled && !alreadySelected ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2">
                      {alreadySelected ? (
                        <button type="button" onClick={() => onDeselect(ticket.id)} className="rounded bg-river px-2 py-0.5 text-xs font-bold text-white">
                          ✓
                        </button>
                      ) : disabled ? (
                        <span className="rounded bg-field px-2 py-0.5 text-xs font-bold text-ink/30">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            onSelect({
                              id: crypto.randomUUID(),
                              sourceType: "ocr_ticket",
                              sourceId: ticket.id,
                              customerName: ticket.customerName ?? null,
                              amount,
                            })
                          }
                          className="rounded bg-river/10 px-2 py-0.5 text-xs font-bold text-river hover:bg-river/20"
                        >
                          เลือก
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono font-semibold">{ticket.ticketId ?? "—"}</td>
                    <td className="px-3 py-2">
                      {ticket.customerName ? (
                        <span className="inline-flex items-center gap-1 text-xs"><UserCheck size={12} className="text-leaf" /> {ticket.customerName}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-clay"><UserX size={12} /> ไม่มีชื่อ</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink/60">{ticket.licensePlate ?? "—"}</td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${negative ? "text-clay" : "text-river"}`}>
                      {formatCurrency(amount)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {alreadyUsed && !alreadySelected ? (
                        <span className="rounded-full bg-amber/20 px-2 py-0.5 text-xs font-bold text-amber">โอนแล้ว</span>
                      ) : noCustomer ? (
                        <span className="rounded-full bg-clay/10 px-2 py-0.5 text-xs font-bold text-clay">ไม่มีชื่อ</span>
                      ) : negative ? (
                        <span className="rounded-full bg-clay/10 px-2 py-0.5 text-xs font-bold text-clay">ติดลบ</span>
                      ) : (
                        <span className="rounded-full bg-leaf/10 px-2 py-0.5 text-xs font-bold text-leaf">พร้อม</span>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        {tab === "rubber" && activeBills.length === 0 && (
          <p className="py-6 text-center text-sm text-ink/40">ไม่มีบิลยาง</p>
        )}
        {tab === "ocr" && activeTickets.length === 0 && (
          <p className="py-6 text-center text-sm text-ink/40">ไม่มีใบชั่ง</p>
        )}
      </div>
    </div>
  );
}
