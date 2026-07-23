"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FileImage,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Trash2,
  Upload,
  Eye,
  X,
  Copy,
  Download,
  Edit3,
  Save,
  WifiOff,
  ExternalLink,
  UserCheck,
  UserX
} from "lucide-react";
import type { OcrTicket, Customer } from "@/types";
import { authFetch } from "@/lib/auth-fetch";
import { OCR_TICKET_TRANSFER_LOCK_MESSAGE } from "@/lib/record-action-locks";

/* ── OCR API Result ── */
type OcrApiResult = {
  ticket_id: string | null;
  license_plate: string | null;
  date_in: string | null;
  weight_in: number | null;
  weight_out: number | null;
  weight_net: number | null;
  weight_deducted: number | null;
  weight_remaining: number | null;
  total_amount: number | null;
};

export type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
  status: "pending" | "processing" | "success" | "error";
  result?: OcrApiResult;
  errorMessage?: string;
  ocrTicketId?: string;
};

type Props = {
  locationId: string;
  online: boolean;
  uploadItems: UploadItem[];
  setUploadItems: React.Dispatch<React.SetStateAction<UploadItem[]>>;
  initialDateFilter?: string | null;
  onInitialDateFilterHandled?: () => void;
};

/* ── Main Component ── */
import { useOcrTickets } from "@/hooks/useOcrTickets";
import { useCustomers } from "@/hooks/useCustomers";
import { useMoneyTransfers } from "@/hooks/useMoneyTransfers";

export function OcrTicketUpload({
  locationId,
  online,
  uploadItems: items,
  setUploadItems: setItems,
  initialDateFilter,
  onInitialDateFilterHandled,
}: Props) {
  const { ocrTickets, addTicket, updateTicket, deleteTicket } = useOcrTickets(locationId);
  const { customers } = useCustomers();
  const { transfers } = useMoneyTransfers(locationId);

  const [previewItem, setPreviewItem] = useState<UploadItem | null>(null);
  const [editTicket, setEditTicket] = useState<OcrTicket | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  const offlineMessage = "อ่านใบชั่งและ OCR ใช้ได้เมื่อออนไลน์เท่านั้น";

  const lockedOcrTicketIds = useMemo(() => {
    const ids = new Set<string>();
    transfers.forEach((transfer) => {
      transfer.items?.forEach((item) => {
        if (item.sourceType === "ocr_ticket") ids.add(item.sourceId);
      });
    });
    return ids;
  }, [transfers]);

  const getTicketActionBlockReason = useCallback(
    (ticketId: string) => {
      if (!online) return offlineMessage;
      const reportLockNo = ocrTickets.find((ticket) => ticket.id === ticketId)?.reportLockNo;
      if (reportLockNo) return `ล็อกโดยรายงาน ${reportLockNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน`;
      return lockedOcrTicketIds.has(ticketId) ? OCR_TICKET_TRANSFER_LOCK_MESSAGE : null;
    },
    [lockedOcrTicketIds, ocrTickets, online, offlineMessage]
  );

  const showTicketActionBlocked = useCallback(
    (ticketId: string) => {
      const reason = getTicketActionBlockReason(ticketId);
      if (!reason) return false;
      setToastMsg(reason);
      return true;
    },
    [getTicketActionBlockReason]
  );

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => {
    if (!initialDateFilter) return;
    setDateFilter(initialDateFilter);
    onInitialDateFilterHandled?.();
  }, [initialDateFilter, onInitialDateFilterHandled]);

  const visibleOcrTickets = useMemo(() => {
    if (!dateFilter) return ocrTickets;
    return ocrTickets.filter((ticket) => ticket.dateIn === dateFilter);
  }, [dateFilter, ocrTickets]);

  // Warn before closing/refreshing if uploads are in progress
  const hasProcessing = items.some((i) => i.status === "processing");
  useEffect(() => {
    if (!hasProcessing) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers show a generic message, but we set returnValue for compatibility
      e.returnValue = "กำลังอัปโหลดรูปภาพอยู่ — ถ้าออกตอนนี้ข้อมูลอาจสูญหาย";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasProcessing]);

  // Auto-delete tickets with negative weight remaining after 10 minutes (with countdown)
  const negativeWeightTargets = useRef<Record<string, number>>({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      Object.entries(negativeWeightTargets.current).forEach(([id, targetTime]) => {
        if (currentTime >= targetTime) {
          delete negativeWeightTargets.current[id]; // Prevent duplicate triggers
          if (showTicketActionBlocked(id)) return;
          deleteTicket.mutate(id, {
            onSuccess: () => setToastMsg(`ลบใบชั่งอัตโนมัติ — น้ำหนักคงเหลือติดลบ`),
            onError: (error) => {
              setToastMsg(error instanceof Error ? error.message : "ลบใบชั่งไม่สำเร็จ");
            }
          });
        }
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [deleteTicket, showTicketActionBlocked]);

  useEffect(() => {
    const currentNegIds = new Set<string>();
    ocrTickets.forEach((ticket) => {
      const wNet = (ticket.weightIn ?? 0) - (ticket.weightOut ?? 0);
      const wRem = wNet - (ticket.weightDeducted ?? 0);
      if (wRem < 0) {
        currentNegIds.add(ticket.id);
        if (!negativeWeightTargets.current[ticket.id]) {
          negativeWeightTargets.current[ticket.id] = Date.now() + 10 * 60 * 1000;
        }
      }
    });
    Object.keys(negativeWeightTargets.current).forEach((id) => {
      if (!currentNegIds.has(id)) delete negativeWeightTargets.current[id];
    });
  }, [ocrTickets]);

  const existingFileNames = new Set([
    ...items.map((i) => i.file.name),
    ...ocrTickets.map((t) => t.fileName),
  ]);

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      if (!online) {
        setToastMsg(offlineMessage);
        return;
      }
      const newItems: UploadItem[] = [];
      const duplicates: string[] = [];
      Array.from(files)
        .filter((f) => f.type.startsWith("image/"))
        .forEach((file) => {
          if (existingFileNames.has(file.name)) {
            duplicates.push(file.name);
          } else {
            existingFileNames.add(file.name);
            newItems.push({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              file,
              previewUrl: URL.createObjectURL(file),
              status: "pending" as const,
            });
          }
        });
      if (duplicates.length > 0) setToastMsg(`ไฟล์ซ้ำ: ${duplicates.join(", ")}`);
      if (newItems.length > 0) setItems((prev) => [...prev, ...newItems]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, ocrTickets, online, offlineMessage]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => { e.preventDefault(); handleFiles(e.dataTransfer.files); },
    [handleFiles]
  );
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);

  const removeUploadItem = useCallback((id: string) => {
    setItems((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  }, [setItems]);

  const uploadImageToDrive = useCallback(
    async (file: File, ticketId: string) => {
      try {
        const fd = new FormData();
        fd.append("image", file);
        fd.append("ticketId", ticketId);
        const res = await authFetch("/api/lanflow/ocr-tickets/upload-image", { method: "POST", body: fd });
        if (res.ok) {
          const updated = (await res.json()) as OcrTicket;
          updateTicket.mutate(updated);
        } else {
          console.error("Drive upload failed:", await res.text());
        }
      } catch (err) {
        console.error("Drive upload error:", err);
      }
    },
    [updateTicket]
  );

  const processItem = useCallback(
    async (item: UploadItem) => {
      if (!online) {
        setToastMsg(offlineMessage);
        return;
      }
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: "processing" } : i))
      );
      try {
        // 1. OCR
        const formData = new FormData();
        formData.append("image", item.file);
        const res = await authFetch("/api/lanflow/ocr-ticket", { method: "POST", body: formData });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const result: OcrApiResult = await res.json();

        // 2. Create ticket
        const ticketId = crypto.randomUUID();
        const ticket: OcrTicket = {
          id: ticketId,
          clientTempId: ticketId,
          idempotencyKey: `ocr:${ticketId}`,
          locationId,
          fileName: item.file.name,
          ticketId: result.ticket_id,
          licensePlate: result.license_plate,
          dateIn: result.date_in,
          weightIn: result.weight_in,
          weightOut: result.weight_out,
          weightNet: result.weight_net,
          weightDeducted: result.weight_deducted,
          weightRemaining: result.weight_remaining,
          totalAmount: result.total_amount,
          driveFileId: null,
          driveUrl: null,
          syncStatus: "pending",
          recordStatus: "active",
          revisionNo: 0,
          createdAt: new Date().toISOString(),
        };
        addTicket.mutate(ticket);

        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, status: "success", result, ocrTicketId: ticketId } : i
          )
        );

        // 3. Upload image to Google Drive (background, don't block)
        uploadImageToDrive(item.file, ticketId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, status: "error", errorMessage: msg } : i
          )
        );
      }
    },
    [locationId, addTicket, setItems, uploadImageToDrive, online, offlineMessage]
  );

  // Process pending images one by one so OCR and upload state stay predictable.
  const processAll = useCallback(async () => {
    if (!online) {
      setToastMsg(offlineMessage);
      return;
    }
    if (processingRef.current) return;
    processingRef.current = true;
    const pending = items.filter((i) => i.status === "pending" || i.status === "error");
    for (const item of pending) {
      await processItem(item);
    }
    processingRef.current = false;
  }, [items, processItem, online, offlineMessage]);

  const clearAll = useCallback(() => {
    items.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    setItems([]);
  }, [items, setItems]);

  const successItems = items.filter((i) => i.status === "success");
  const pendingItems = items.filter((i) => i.status === "pending" || i.status === "error");
  const processingItems = items.filter((i) => i.status === "processing");

  const exportJSON = useCallback(() => {
    const blob = new Blob([JSON.stringify(ocrTickets, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ocr-results-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [ocrTickets]);

  const copyAllJSON = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(ocrTickets, null, 2));
    setToastMsg("คัดลอก JSON สำเร็จ");
  }, [ocrTickets]);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteConfirmId) {
      if (showTicketActionBlocked(deleteConfirmId)) {
        setDeleteConfirmId(null);
        return;
      }
      deleteTicket.mutate(deleteConfirmId, {
        onSuccess: () => {
          setItems((prev) => prev.filter((i) => i.ocrTicketId !== deleteConfirmId));
          setDeleteConfirmId(null);
        },
        onError: (error) => {
          setToastMsg(error instanceof Error ? error.message : "ลบใบชั่งไม่สำเร็จ");
          setDeleteConfirmId(null);
        }
      });
    }
  }, [deleteConfirmId, deleteTicket, setItems, showTicketActionBlocked]);

  const handleEditSave = useCallback(
    (updated: OcrTicket) => {
      if (showTicketActionBlocked(updated.id)) return;
      updateTicket.mutate(updated, {
        onSuccess: () => setEditTicket(null),
        onError: (error) => {
          setToastMsg(error instanceof Error ? error.message : "แก้ไขใบชั่งไม่สำเร็จ");
        }
      });
    },
    [showTicketActionBlocked, updateTicket]
  );

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 animate-pulse rounded-lg bg-clay px-4 py-2 text-sm font-semibold text-white shadow-lg">
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">
            <FileImage size={22} className="mr-2 inline-block text-leaf" />
            อ่านใบชั่ง (OCR)
          </h2>
          <p className="mt-1 text-sm text-ink/60">
            อัปโหลดรูปใบชั่งน้ำหนัก — เลือกได้หลายไฟล์พร้อมกัน
            {!online && (
              <span className="ml-2 inline-flex items-center gap-1 text-clay">
                <WifiOff size={14} /> ออฟไลน์
              </span>
            )}
          </p>
        </div>
        {items.length > 0 && (
          <button type="button" onClick={clearAll}
            className="focus-ring flex items-center gap-1.5 rounded-md border border-clay/30 bg-white px-3 py-2 text-sm font-semibold text-clay hover:bg-clay/10">
            <Trash2 size={15} /> ล้างรายการอัปโหลด
          </button>
        )}
      </div>

      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => {
          if (!online) {
            setToastMsg(offlineMessage);
            return;
          }
          fileInputRef.current?.click();
        }}
        title={online ? undefined : offlineMessage}
        className={`group rounded-xl border-2 border-dashed p-8 text-center transition-all ${
          online
            ? "cursor-pointer border-leaf/30 bg-mint/30 hover:border-leaf/60 hover:bg-mint/50"
            : "cursor-not-allowed border-black/10 bg-field/60 opacity-70"
        }`}
      >
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-leaf/10 text-leaf transition-transform group-hover:scale-110">
          <Upload size={28} />
        </div>
        <p className="font-semibold text-ink">คลิกหรือลากไฟล์มาวางที่นี่</p>
        <p className="mt-1 text-sm text-ink/50">รองรับ JPG, PNG, WEBP — เลือกได้หลายไฟล์</p>
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" disabled={!online}
          onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ""; }} />
      </div>

      {/* Action Bar */}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-black/5 bg-white p-3 shadow-panel">
          <div className="flex items-center gap-4 text-sm text-ink/70">
            <span>ทั้งหมด <strong className="text-ink">{items.length}</strong></span>
            {successItems.length > 0 && (
              <span className="flex items-center gap-1 text-leaf"><CheckCircle2 size={14} /> {successItems.length} สำเร็จ</span>
            )}
            {processingItems.length > 0 && (
              <span className="flex items-center gap-1 text-river"><Loader2 size={14} className="animate-spin" /> {processingItems.length} กำลังอ่าน</span>
            )}
            {items.filter((i) => i.status === "error").length > 0 && (
              <span className="flex items-center gap-1 text-clay"><AlertCircle size={14} /> {items.filter((i) => i.status === "error").length} ผิดพลาด</span>
            )}
          </div>
          <div className="ml-auto flex gap-2">
            {pendingItems.length > 0 && (
              <button type="button" onClick={processAll} disabled={processingItems.length > 0 || !online}
                className="focus-ring flex items-center gap-1.5 rounded-md bg-leaf px-4 py-2 text-sm font-semibold text-white hover:bg-leaf/90 disabled:opacity-50">
                {processingItems.length > 0 ? (<><Loader2 size={15} className="animate-spin" /> กำลังอ่าน...</>)
                  : !online ? (<><WifiOff size={15} /> ไม่มีเน็ต</>)
                  : (<><FileImage size={15} /> อ่านทั้งหมด ({pendingItems.length})</>)}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Upload Grid — always rendered, items persist across tab switches */}
      {items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <UploadCard key={item.id} item={item}
              onRemove={() => removeUploadItem(item.id)}
              onRetry={() => processItem(item)}
              onPreview={() => setPreviewItem(item)} />
          ))}
        </div>
      )}

      {/* Saved Results Table */}
      {ocrTickets.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-panel">
          <div className="flex flex-col gap-3 border-b border-black/5 bg-field/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="font-bold text-ink">
              <CheckCircle2 size={16} className="mr-1.5 inline-block text-leaf" />
              ข้อมูลใบชั่ง ({dateFilter ? `${visibleOcrTickets.length}/${ocrTickets.length}` : ocrTickets.length} รายการ)
            </h3>
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-2 rounded-md border border-black/10 bg-white px-2 py-1.5 text-xs font-semibold text-ink/60">
                วันที่
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(event) => setDateFilter(event.target.value)}
                  className="bg-transparent text-sm font-semibold text-ink outline-none"
                />
              </label>
              {dateFilter && (
                <button type="button" onClick={() => setDateFilter("")}
                  className="focus-ring rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-field">
                  ล้างวันที่
                </button>
              )}
              <button type="button" onClick={copyAllJSON}
                className="focus-ring flex items-center gap-1.5 rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-field">
                <Copy size={12} /> คัดลอก
              </button>
              <button type="button" onClick={exportJSON}
                className="focus-ring flex items-center gap-1.5 rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-field">
                <Download size={12} /> ดาวน์โหลด
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/5 bg-field/30 text-left text-xs font-bold uppercase tracking-wider text-ink/50">
                  <th className="px-3 py-3">#</th>
                  <th className="px-3 py-3">เลขที่</th>
                  <th className="px-3 py-3">ทะเบียน</th>
                  <th className="px-3 py-3">ลูกค้า</th>
                  <th className="px-3 py-3">วันที่</th>
                  <th className="px-3 py-3 text-right">นน.เข้า</th>
                  <th className="px-3 py-3 text-right">นน.ออก</th>
                  <th className="px-3 py-3 text-right">สุทธิ</th>
                  <th className="px-3 py-3 text-right">หัก</th>
                  <th className="px-3 py-3 text-right">คงเหลือ</th>
                  <th className="px-3 py-3 text-right">เงิน</th>
                  <th className="px-3 py-3 text-center">สถานะ</th>
                  <th className="px-3 py-3 text-center">รูป</th>
                  <th className="px-3 py-3 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {visibleOcrTickets.map((ticket, idx) => {
                  const tWNet = (ticket.weightIn ?? 0) - (ticket.weightOut ?? 0);
                  const tWRemaining = tWNet - (ticket.weightDeducted ?? 0);
                  const isNegative = tWRemaining < 0;
                  const actionBlockReason = getTicketActionBlockReason(ticket.id);
                  const actionsDisabled = Boolean(actionBlockReason);
                  
                  let countdownText = "";
                  if (isNegative && negativeWeightTargets.current[ticket.id]) {
                    const remainingSecs = Math.max(0, Math.floor((negativeWeightTargets.current[ticket.id] - now) / 1000));
                    const mins = Math.floor(remainingSecs / 60);
                    const secs = remainingSecs % 60;
                    countdownText = `${mins}:${secs.toString().padStart(2, '0')}`;
                  }
                  
                  return (
                  <tr key={ticket.id} className={`border-b border-black/5 transition-colors ${isNegative ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-mint/20'}`}>
                    <td className="px-3 py-2.5 font-mono text-ink/40">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-semibold text-ink">{ticket.ticketId ?? "—"}</td>
                    <td className="px-3 py-2.5">{ticket.licensePlate ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      {ticket.customerName ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-leaf/10 px-2 py-0.5 text-xs font-semibold text-leaf">
                          <UserCheck size={12} /> {ticket.customerName}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-clay/10 px-2 py-0.5 text-xs font-semibold text-clay">
                          <UserX size={12} /> ยังไม่ระบุ
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">{ticket.dateIn ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{ticket.weightIn?.toLocaleString() ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{ticket.weightOut?.toLocaleString() ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-leaf">{tWNet.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink/50">{ticket.weightDeducted?.toLocaleString() ?? "—"}</td>
                    <td className={`px-3 py-2.5 text-right font-mono font-semibold ${isNegative ? 'text-red-600' : ''}`}>{tWRemaining.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-river">{ticket.totalAmount?.toLocaleString() ?? "—"}</td>
                    <td className="px-3 py-2.5 text-center">
                      {isNegative ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700" title={`น้ำหนักคงเหลือติดลบ — จะถูกลบอัตโนมัติใน ${countdownText}`}>
                          <AlertTriangle size={12} /> น้ำหนักไม่ถูกต้อง ({countdownText})
                        </span>
                      ) : ticket.driveUrl ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-leaf/10 px-2 py-0.5 text-xs font-semibold text-leaf">
                          <CheckCircle2 size={12} /> ปกติ
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-field px-2 py-0.5 text-xs font-semibold text-ink/40">
                          รอตรวจสอบ
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {ticket.driveUrl ? (
                        <a href={ticket.driveUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md bg-river/10 px-2 py-1 text-xs font-semibold text-river hover:bg-river/20">
                          <ExternalLink size={12} /> ดูรูป
                        </a>
                      ) : (
                        <span className="text-xs text-ink/30">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button type="button" onClick={() => setEditTicket(ticket)}
                          disabled={actionsDisabled}
                          className={`grid h-7 w-7 place-items-center rounded-md text-ink/50 ${actionsDisabled ? "cursor-not-allowed opacity-40" : "hover:bg-mint hover:text-leaf"}`}
                          title={actionBlockReason ?? "แก้ไข"}>
                          <Edit3 size={14} />
                        </button>
                        <button type="button" onClick={() => setDeleteConfirmId(ticket.id)}
                          disabled={actionsDisabled}
                          className={`grid h-7 w-7 place-items-center rounded-md text-ink/50 ${actionsDisabled ? "cursor-not-allowed opacity-40" : "hover:bg-clay/10 hover:text-clay"}`}
                          title={actionBlockReason ?? "ลบ"}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
                {visibleOcrTickets.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-3 py-8 text-center text-sm text-ink/50">
                      ไม่พบใบชั่งในวันที่เลือก
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreviewItem(null)}>
          <div className="relative max-h-[90vh] max-w-4xl overflow-auto rounded-xl bg-white p-2 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setPreviewItem(null)}
              className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80">
              <X size={18} />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewItem.previewUrl} alt={previewItem.file.name} className="max-h-[85vh] rounded-lg object-contain" />
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDeleteConfirmId(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-ink">ยืนยันการลบ</h3>
            <p className="mt-2 text-sm text-ink/70">คุณแน่ใจหรือไม่ว่าต้องการลบใบชั่งนี้? รูปภาพใน Google Drive จะถูกลบด้วย</p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteConfirmId(null)}
                className="focus-ring rounded-md border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-field">
                ยกเลิก
              </button>
              <button type="button" onClick={handleDeleteConfirm} disabled={!online} title={online ? undefined : offlineMessage}
                className="focus-ring rounded-md bg-clay px-4 py-2 text-sm font-semibold text-white hover:bg-clay/90 disabled:cursor-not-allowed disabled:opacity-50">
                ลบ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editTicket && <EditTicketModal ticket={editTicket} targetTime={negativeWeightTargets.current[editTicket.id]} now={now} customers={customers} online={online} offlineMessage={offlineMessage} onSave={handleEditSave} onClose={() => setEditTicket(null)} />}
    </div>
  );
}

/* ── Upload Card ── */
function UploadCard({ item, onRemove, onRetry, onPreview }: {
  item: UploadItem; onRemove: () => void; onRetry: () => void; onPreview: () => void;
}) {
  const statusColors = {
    pending: "border-black/10",
    processing: "border-river/40 ring-2 ring-river/10",
    success: "border-leaf/30 ring-2 ring-leaf/10",
    error: "border-clay/40 ring-2 ring-clay/10",
  };
  return (
    <div className={`overflow-hidden rounded-xl border bg-white shadow-panel transition-all ${statusColors[item.status]}`}>
      <div className="relative h-40 overflow-hidden bg-field">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />
        {item.status === "processing" && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={32} className="animate-spin text-river" />
              <span className="text-sm font-semibold text-river">กำลังอ่าน...</span>
            </div>
          </div>
        )}
        {item.status === "success" && (
          <div className="absolute left-2 top-2">
            <span className="flex items-center gap-1 rounded-full bg-leaf px-2 py-0.5 text-xs font-bold text-white shadow">
              <CheckCircle2 size={12} /> สำเร็จ
            </span>
          </div>
        )}
        {item.status === "error" && (
          <div className="absolute left-2 top-2">
            <span className="flex items-center gap-1 rounded-full bg-clay px-2 py-0.5 text-xs font-bold text-white shadow">
              <AlertCircle size={12} /> ผิดพลาด
            </span>
          </div>
        )}
        <div className="absolute right-2 top-2 flex gap-1">
          <button type="button" onClick={onPreview}
            className="grid h-7 w-7 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70" title="ดูรูปขยาย">
            <Eye size={14} />
          </button>
          {item.status !== "processing" && (
            <button type="button" onClick={onRemove}
              className="grid h-7 w-7 place-items-center rounded-full bg-black/50 text-white hover:bg-clay" title="ลบ">
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-semibold text-ink" title={item.file.name}>{item.file.name}</p>
        <p className="text-xs text-ink/40">{(item.file.size / 1024).toFixed(0)} KB</p>
        {item.status === "error" && item.errorMessage && (
          <div className="mt-2 rounded-md bg-clay/10 px-2 py-1.5 text-xs text-clay">
            {item.errorMessage}
            <button type="button" onClick={onRetry} className="ml-2 font-bold underline hover:text-clay/80">ลองอีกครั้ง</button>
          </div>
        )}
        {item.status === "success" && item.result && (
          <div className="mt-2 space-y-1 rounded-md bg-field/60 p-2 text-xs">
            <div className="flex justify-between"><span className="text-ink/50">เลขที่</span><span className="font-bold text-ink">{item.result.ticket_id ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-ink/50">ทะเบียน</span><span className="font-semibold">{item.result.license_plate ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-ink/50">สุทธิ</span><span className="font-bold text-leaf">{item.result.weight_net != null ? `${item.result.weight_net.toLocaleString()} กก.` : "—"}</span></div>
            <div className="flex justify-between"><span className="text-ink/50">เงิน</span><span className="font-bold text-river">{item.result.total_amount != null ? `${item.result.total_amount.toLocaleString()} ฿` : "—"}</span></div>
          </div>
        )}
        {item.status === "pending" && <p className="mt-2 text-xs text-ink/40">รอประมวลผล...</p>}
      </div>
    </div>
  );
}

/* ── Edit Modal ── */
function EditTicketModal({ ticket, targetTime, now, customers, online, offlineMessage, onSave, onClose }: {
  ticket: OcrTicket; targetTime?: number; now: number; customers: Customer[]; online: boolean; offlineMessage: string; onSave: (t: OcrTicket) => void; onClose: () => void;
}) {
  const [form, setForm] = useState({ ...ticket });
  const [customerSearch, setCustomerSearch] = useState(ticket.customerName ?? "");
  const [showDropdown, setShowDropdown] = useState(false);
  const [moneyDeducted, setMoneyDeducted] = useState(ticket.moneyDeducted ?? 0);
  const set = (field: keyof OcrTicket, value: string | number | null) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const matchingCustomers = useMemo(() => {
    if (!customerSearch.trim()) return [];
    return customers.filter(c => {
      const nameMatch = c.mainName.toLowerCase().includes(customerSearch.toLowerCase());
      const idMatch = c.legacyMemberId?.toLowerCase().includes(customerSearch.toLowerCase());
      return nameMatch || idMatch;
    }).slice(0, 5);
  }, [customers, customerSearch]);

  // Calculated fields
  const wIn = form.weightIn ?? 0;
  const wOut = form.weightOut ?? 0;
  const wDeducted = form.weightDeducted ?? 0;
  const calcWeightNet = wIn > 0 || wOut > 0 ? wIn - wOut : null;
  const calcWeightRemaining = calcWeightNet != null ? calcWeightNet - wDeducted : null;
  const isWeightInvalid = calcWeightRemaining != null && calcWeightRemaining < 0;
  const calcNetPay = form.totalAmount != null ? (form.totalAmount ?? 0) - moneyDeducted : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!online) {
      alert(offlineMessage);
      return;
    }
    onSave({
      ...form,
      customerName: customerSearch || null,
      weightNet: calcWeightNet,
      weightRemaining: calcWeightRemaining,
      moneyDeducted: moneyDeducted || 0,
      revisionNo: (form.revisionNo ?? 0) + 1,
      syncStatus: "pending",
      idempotencyKey: `ocr:update:${form.id}:${(form.revisionNo ?? 0) + 1}`,
    });
  };

  // Use lh3 direct thumbnail for reliable rendering
  const driveThumbUrl = ticket.driveFileId
    ? `https://lh3.googleusercontent.com/d/${ticket.driveFileId}=w800`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
          <h3 className="text-lg font-bold text-ink"><Edit3 size={18} className="mr-2 inline-block text-leaf" /> แก้ไขข้อมูลใบชั่ง</h3>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full hover:bg-field"><X size={18} /></button>
        </div>

        {/* Drive Image Preview */}
        {driveThumbUrl && (
          <div className="border-b border-black/5 bg-field/40 px-5 py-3">
            <div className="overflow-hidden rounded-lg border border-black/10 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={driveThumbUrl}
                alt="ใบชั่ง"
                className="w-full object-contain"
                style={{ maxHeight: "350px" }}
              />
              {ticket.driveUrl && (
                <div className="border-t border-black/5 px-3 py-2 text-center">
                  <a href={ticket.driveUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-river hover:underline">
                    <ExternalLink size={12} /> เปิดใน Google Drive
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-4">
            <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">เลขที่เอกสาร</span>
              <input type="text" value={form.ticketId ?? ""} onChange={(e) => set("ticketId", e.target.value || null)}
                className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3 text-sm" /></label>
            <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">วันที่เข้า</span>
              <input type="date" value={form.dateIn ?? ""} onChange={(e) => set("dateIn", e.target.value || null)}
                className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3 text-sm" /></label>
          </div>
          <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">ทะเบียนรถ</span>
            <input type="text" value={form.licensePlate ?? ""} onChange={(e) => set("licensePlate", e.target.value || null)}
              className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3 text-sm" /></label>

          {/* Customer Name Autocomplete */}
          <div className="relative z-20">
            <span className="mb-1 block text-sm font-semibold text-ink/70">ชื่อลูกค้า</span>
            <input
              value={customerSearch}
              onChange={(e) => {
                setCustomerSearch(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => { if (customerSearch.trim()) setShowDropdown(true); }}
              onBlur={() => { setTimeout(() => setShowDropdown(false), 200); }}
              placeholder="ค้นหาชื่อ หรือ รหัสสมาชิก..."
              className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3 pr-10 text-sm"
              autoComplete="off"
            />
            {customerSearch ? (
              <span className="absolute right-3 top-[2.1rem] inline-flex items-center gap-1 rounded-full bg-leaf/10 px-2 py-0.5 text-xs font-semibold text-leaf">
                <UserCheck size={11} />
              </span>
            ) : (
              <span className="absolute right-3 top-[2.1rem] inline-flex items-center gap-1 rounded-full bg-clay/10 px-2 py-0.5 text-xs font-semibold text-clay">
                <UserX size={11} />
              </span>
            )}

            {showDropdown && matchingCustomers.length > 0 && (
              <div className="absolute left-0 right-0 z-[60] mt-1 max-h-48 overflow-y-auto rounded-md border border-black/10 bg-white shadow-lg">
                {matchingCustomers.map(cust => (
                  <button
                    key={cust.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setCustomerSearch(cust.mainName);
                      setShowDropdown(false);
                    }}
                    className="flex w-full items-center justify-between border-b border-black/5 px-4 py-2.5 text-left text-sm last:border-0 hover:bg-slate-100"
                  >
                    <div>
                      <span className="font-semibold text-ink">{cust.mainName}</span>
                      {cust.farms?.[0]?.address && <span className="ml-2 text-xs text-ink/50">({cust.farms[0].address})</span>}
                    </div>
                    <span className="rounded bg-leaf/10 px-2 py-0.5 text-xs font-bold text-leaf">
                      {cust.legacyMemberId || "FSC"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Weight fields */}
          <div className="grid grid-cols-2 gap-4">
            <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">นน.เข้า (กก.)</span>
              <input type="number" value={form.weightIn ?? ""} onChange={(e) => set("weightIn", e.target.value ? Number(e.target.value) : null)}
                className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3 text-sm" /></label>
            <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">นน.ออก (กก.)</span>
              <input type="number" value={form.weightOut ?? ""} onChange={(e) => set("weightOut", e.target.value ? Number(e.target.value) : null)}
                className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3 text-sm" /></label>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">สุทธิ (กก.)</span>
              <input type="number" value={calcWeightNet ?? ""} readOnly
                className="h-10 w-full rounded-md border border-black/5 bg-field/50 px-3 text-sm font-semibold text-leaf cursor-not-allowed" /></label>
            <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">หักนน.</span>
              <input type="number" value={form.weightDeducted ?? ""} onChange={(e) => set("weightDeducted", e.target.value ? Number(e.target.value) : null)}
                className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3 text-sm" /></label>
            <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">นน.คงเหลือ</span>
              <input type="number" value={calcWeightRemaining ?? ""} readOnly
                className={`h-10 w-full rounded-md border px-3 text-sm font-semibold cursor-not-allowed ${isWeightInvalid ? 'border-red-300 bg-red-50 text-red-600' : 'border-black/5 bg-field/50'}`} /></label>
          </div>

          {/* Negative weight warning */}
          {isWeightInvalid && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-600" />
              <div>
                <p className="text-sm font-semibold text-red-700">น้ำหนักไม่ถูกต้อง</p>
                <p className="mt-0.5 text-xs text-red-600">
                  น้ำหนักคงเหลือติดลบ ({calcWeightRemaining?.toLocaleString()} กก.) — ข้อมูลนี้จะถูกลบอัตโนมัติใน{' '}
                  {targetTime ? (
                    <span className="font-bold">{Math.floor(Math.max(0, targetTime - now) / 60000)}:{(Math.floor(Math.max(0, targetTime - now) / 1000) % 60).toString().padStart(2, '0')}</span>
                  ) : (
                    "10 นาที"
                  )}{' '}
                  กรุณาตรวจสอบน้ำหนักเข้า/ออก
                </p>
              </div>
            </div>
          )}

          {/* Money fields */}
          <div className="grid grid-cols-2 gap-4">
            <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">ราคาสินค้า (฿)</span>
              <input type="number" value={form.totalAmount ?? ""} readOnly
                className="h-10 w-full rounded-md border border-black/5 bg-field/50 px-3 text-sm font-semibold text-river cursor-not-allowed" /></label>
            <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">หักเงิน (฿)</span>
              <input type="number" value={moneyDeducted || ""} onChange={(e) => setMoneyDeducted(e.target.value ? Number(e.target.value) : 0)}
                className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3 text-sm" placeholder="0" /></label>
          </div>
          <div className="rounded-lg border border-leaf/20 bg-leaf/5 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-ink/70">ยอดสุทธิที่ต้องจ่ายลูกค้า</span>
              <span className="text-lg font-bold text-leaf">{calcNetPay != null ? `฿${calcNetPay.toLocaleString()}` : "—"}</span>
            </div>
            {moneyDeducted > 0 && (
              <p className="mt-1 text-xs text-ink/50">ราคาสินค้า {(form.totalAmount ?? 0).toLocaleString()} − หักเงิน {moneyDeducted.toLocaleString()} = {calcNetPay?.toLocaleString()}</p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="focus-ring rounded-md border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-field">ยกเลิก</button>
            <button type="submit" disabled={isWeightInvalid || !online} title={online ? undefined : offlineMessage}
              className={`focus-ring flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold text-white ${isWeightInvalid || !online ? 'bg-gray-300 cursor-not-allowed' : 'bg-leaf hover:bg-leaf/90'}`}>
              <Save size={15} /> บันทึก</button>
          </div>
        </form>
      </div>
    </div>
  );
}
