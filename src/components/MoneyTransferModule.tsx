"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownUp,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit3,
  GitMerge,
  Loader2,
  Plus,
  Share2,
  Trash2,
  WifiOff,
} from "lucide-react";
import type { Location, MoneyTransfer, Profile } from "@/types";

import { useMoneyTransfers } from "@/hooks/useMoneyTransfers";
import { useRubberBills } from "@/hooks/useRubberBills";
import { useOcrTickets } from "@/hooks/useOcrTickets";
import { useCustomers } from "@/hooks/useCustomers";
import { useRubberBillApprovals } from "@/hooks/useRubberBillApprovals";
import {
  receiptPdfFilename,
} from "@/lib/rubber-bills/print-receipt";
import { useSharePdf } from "@/hooks/useSharePdf";
import { SharePdfWaitingModal } from "@/components/shared/SharePdfWaitingModal";
import { ModalShell } from "@/components/shared/ModalShell";
import { cn } from "@/lib/cn";
import { getMoneyTransferPaymentSummary } from "@/lib/money-transfers/state";

import { CustomerTransferForm } from "./money-transfer/CustomerTransferForm";
import { TransportTransferForm } from "./money-transfer/TransportTransferForm";
import { BranchTransferForm } from "./money-transfer/BranchTransferForm";
import {
  buildMoneyTransferReceiptModel,
  getMoneyTransferPrintBlockReason,
  renderMoneyTransferReceiptHtml,
  shortTransferId,
} from "./money-transfer/money-transfer-print";

type Props = {
  locationId: string;
  locations: Location[];
  online: boolean;
  profile: Profile;
  initialEditTransferId?: string | null;
  onInitialEditTransferHandled?: () => void;
};

type TransferStatusFilter = MoneyTransfer["transferStatus"] | "all";

const PAGE_SIZE = 20;
const MONEY_TRANSFER_CURRENCY_FORMATTER = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const MONEY_TRANSFER_AMOUNT_FORMATTER = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const STATUS_FILTERS: Array<[TransferStatusFilter, string]> = [
  ["all", "ทั้งหมด"],
  ["pending", "รอโอน"],
  ["partial", "ค้างจ่าย"],
  ["advance_payment", "จ่ายล่วงหน้า"],
  ["paid", "จ่ายครบ"],
  ["overpaid", "ชำระเกิน"],
  ["branch_and_transfer", "โอน+สาขาจ่าย"],
  ["cancelled", "ยกเลิก"],
];

const STATUS_STYLES: Record<MoneyTransfer["transferStatus"], string> = {
  paid: "bg-leaf/10 text-leaf",
  branch_and_transfer: "bg-leaf/10 text-leaf",
  overpaid: "bg-clay/10 text-clay",
  partial: "bg-amber/20 text-amber",
  advance_payment: "bg-purple-500/20 text-purple-600",
  cancelled: "bg-clay/10 text-clay",
  pending: "bg-amber/20 text-amber",
};

const STATUS_LABELS: Record<MoneyTransfer["transferStatus"], string> = {
  paid: "จ่ายครบ",
  branch_and_transfer: "โอน+สาขาจ่าย",
  overpaid: "ชำระเกิน",
  partial: "ค้างจ่าย",
  advance_payment: "จ่ายล่วงหน้า",
  cancelled: "ยกเลิก",
  pending: "รอโอน",
};

function getMergeFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("ไม่มีสิทธิ์")) return message;
  if (message.includes("REPORT_LOCKED")) {
    return "มีรายการถูก Report Lock ระหว่างการรวม กรุณาโหลดข้อมูลแล้วลองใหม่";
  }
  return "รวมรายการรอโอนไม่สำเร็จ";
}

function formatMoneyTransferCurrency(value: number) {
  return MONEY_TRANSFER_CURRENCY_FORMATTER.format(value);
}

export function MoneyTransferModule({
  locationId,
  locations,
  online,
  profile,
  initialEditTransferId,
  onInitialEditTransferHandled,
}: Props) {
  const {
    transfers,
    addTransfer,
    updateTransfer,
    deleteTransfer,
    mergePendingTransfers,
    getReceiptSourceDetails,
  } = useMoneyTransfers(locationId);
  const { bills } = useRubberBills(locationId, profile.id);
  const { markers: rubberBillApprovalMarkers } = useRubberBillApprovals({ locationId });
  const { ocrTickets } = useOcrTickets(locationId);
  const { customers } = useCustomers();
  const pdfShare = useSharePdf();
  const billsWithApprovalState = useMemo(() => {
    const pendingBillIds = new Set(
      rubberBillApprovalMarkers
        .map((marker) => marker.billId)
        .filter((id): id is string => Boolean(id))
    );
    return bills.map((bill) => (
      pendingBillIds.has(bill.id) ? { ...bill, approvalPending: true } : bill
    ));
  }, [bills, rubberBillApprovalMarkers]);

  const usedSourceIds = useMemo(() => {
    const set = new Set<string>();
    transfers.forEach(t => {
      t.items?.forEach(i => set.add(i.sourceId));
    });
    return set;
  }, [transfers]);

  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [activeFormType, setActiveFormType] = useState<'customer' | 'transport' | 'branch' | null>(null);
  const [editTransfer, setEditTransfer] = useState<MoneyTransfer | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TransferStatusFilter>("pending");
  const [page, setPage] = useState(1);
  const offlineMessage = "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น";
  const branchTransferFormMode =
    editTransfer?.transferType === "branch" && editTransfer.targetLocationId && editTransfer.locationId !== editTransfer.targetLocationId
      ? "branch-to-branch"
      : "head-office-to-branch";

  const transferRows = useMemo(() => transfers.map((transfer) => ({
    transfer,
    summary: getMoneyTransferPaymentSummary(transfer),
  })), [transfers]);

  const statusCounts = useMemo(() => {
    const counts = new Map<TransferStatusFilter, number>([["all", transferRows.length]]);
    transferRows.forEach(({ summary }) => {
      counts.set(summary.status, (counts.get(summary.status) ?? 0) + 1);
    });
    return counts;
  }, [transferRows]);

  const filteredRows = useMemo(() => (
    statusFilter === "all"
      ? transferRows
      : transferRows.filter(({ summary }) => summary.status === statusFilter)
  ), [statusFilter, transferRows]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const eligibleMergeGroupCount = useMemo(() => {
    const groups = new Map<string, number>();
    transfers.forEach((transfer) => {
      if (
        transfer.transferType !== "customer"
        || transfer.transferStatus !== "pending"
        || transfer.recordStatus === "deleted"
        || transfer.syncStatus !== "synced"
        || !transfer.customerId
        || transfer.reportLockNo
        || (transfer.slips?.length ?? 0) > 0
      ) return;
      const key = `${transfer.customerId}\u0000${transfer.accountNumber ?? ""}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    });
    return [...groups.values()].filter((count) => count >= 2).length;
  }, [transfers]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => {
    setPage(1);
  }, [locationId]);

  const copyToClipboard = useCallback(async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setToastMsg(successMessage);
    } catch {
      setToastMsg("คัดลอกไม่สำเร็จ กรุณาลองใหม่");
    }
  }, []);

  const handleSave = useCallback(
    (transfer: MoneyTransfer) => {
      if (!online) {
        setToastMsg(offlineMessage);
        return;
      }
      if (editTransfer) {
        updateTransfer.mutate(transfer, {
          onSuccess: () => {
            setActiveFormType(null);
            setEditTransfer(null);
            setToastMsg("บันทึกรายการโอนเงินสำเร็จ");
          },
          onError: (err) => {
            console.error("Failed to update transfer:", err);
            setToastMsg("เกิดข้อผิดพลาดในการบันทึก");
          }
        });
      } else {
        addTransfer.mutate(transfer, {
          onSuccess: () => {
            setActiveFormType(null);
            setEditTransfer(null);
            setToastMsg("บันทึกรายการโอนเงินสำเร็จ");
          },
          onError: (err) => {
            console.error("Failed to add transfer:", err);
            setToastMsg("เกิดข้อผิดพลาดในการบันทึก");
          }
        });
      }
    },
    [editTransfer, addTransfer, updateTransfer, online, offlineMessage]
  );

  const handleDeleteConfirm = useCallback(() => {
    if (!online) {
      setToastMsg(offlineMessage);
      return;
    }
    if (deleteConfirmId) {
      deleteTransfer.mutate(deleteConfirmId, {
        onSuccess: () => {
          setDeleteConfirmId(null);
          setToastMsg("ลบรายการโอนเงินสำเร็จ");
        },
        onError: (err) => {
          console.error("Failed to delete transfer:", err);
          setToastMsg("เกิดข้อผิดพลาดในการลบ");
        }
      });
    }
  }, [deleteConfirmId, deleteTransfer, online, offlineMessage]);

  const handleMergePending = useCallback(() => {
    if (!online) {
      setToastMsg(offlineMessage);
      return;
    }
    mergePendingTransfers.mutate(undefined, {
      onSuccess: (result) => {
        setPage(1);
        setToastMsg(
          `รวมสำเร็จ ${result.mergedGroupCount} กลุ่ม · รวม ${result.mergedTransferCount} รายการ · ข้าม ${result.skippedTransferCount} รายการ`,
        );
      },
      onError: (error) => {
        setToastMsg(getMergeFailureMessage(error));
      },
    });
  }, [mergePendingTransfers, offlineMessage, online]);

  const handleEdit = useCallback((t: MoneyTransfer) => {
    if (!online) {
      setToastMsg(offlineMessage);
      return;
    }
    setEditTransfer(t);
    setActiveFormType(t.transferType === 'transport' ? 'transport' : t.transferType === 'branch' ? 'branch' : 'customer');
  }, [online, offlineMessage]);

  const handleShare = useCallback(async (transfer: MoneyTransfer) => {
    if (!online) {
      setToastMsg(offlineMessage);
      return;
    }
    const blockReason = getMoneyTransferPrintBlockReason(transfer);
    if (blockReason || pdfShare.busy) {
      if (blockReason) setToastMsg(blockReason);
      return;
    }

    try {
      const sourceDetails = await getReceiptSourceDetails(transfer.id);
      const sourceDetailsById = new Map(sourceDetails.map((item) => [item.id, item]));
      const enrichedTransfer: MoneyTransfer = {
        ...transfer,
        items: (transfer.items ?? []).map((item) => {
          const detail = sourceDetailsById.get(item.id);
          if (
            !detail
            || detail.sourceType !== item.sourceType
            || detail.sourceId !== item.sourceId
          ) {
            throw new Error("ไม่พบรายละเอียดต้นทางของรายการโอนเงิน");
          }
          return { ...item, ...detail, customerName: item.customerName, amount: item.amount };
        }),
      };
      const delivery = await pdfShare.sharePdf(() => {
        const model = buildMoneyTransferReceiptModel(enrichedTransfer, locations);
        return {
          html: renderMoneyTransferReceiptHtml(model),
          filename: receiptPdfFilename("LanFlow-money-transfer", model.shortId),
        };
      });
      if (delivery === "shared") setToastMsg("แชร์ PDF ใบรายการโอนเงินแล้ว");
      if (delivery === "downloaded") setToastMsg("แชร์บนอุปกรณ์นี้ไม่ได้ จึงดาวน์โหลด PDF แทน");
    } catch (error) {
      setToastMsg(error instanceof Error ? error.message : "สร้าง PDF ใบรายการโอนเงินไม่สำเร็จ");
    }
  }, [getReceiptSourceDetails, locations, offlineMessage, online, pdfShare]);

  useEffect(() => {
    if (!initialEditTransferId) return;
    const transfer = transfers.find(t => t.id === initialEditTransferId);
    if (!transfer) return;
    handleEdit(transfer);
    onInitialEditTransferHandled?.();
  }, [initialEditTransferId, transfers, handleEdit, onInitialEditTransferHandled]);

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 animate-pulse rounded-lg bg-leaf px-4 py-2 text-sm font-semibold text-white shadow-lg">
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 rounded-md border border-black/10 bg-white p-3 shadow-panel sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div>
          <h2 className="text-xl font-bold text-ink">
            <ArrowDownUp size={22} className="mr-2 inline-block text-river" />
            ระบบโอนเงิน
          </h2>
          <p className="mt-1 text-sm text-ink/60">
            สร้างรายการโอนเงินจากบิลยางและใบชั่ง พร้อมอัปโหลดสลิป
          </p>
        </div>
        {!activeFormType && (
          <div className="relative w-full sm:w-auto">
            <button
              type="button"
              onClick={() => {
                if (!online) {
                  setToastMsg(offlineMessage);
                  return;
                }
                setShowTypeSelector(!showTypeSelector);
              }}
              disabled={!online}
              title={online ? undefined : offlineMessage}
              className="focus-ring flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-leaf px-4 text-sm font-semibold text-white hover:bg-leaf/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {online ? <Plus size={16} /> : <WifiOff size={16} />} สร้างรายการโอน
            </button>
            {showTypeSelector && (
              <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-lg border border-black/10 bg-white py-1 shadow-xl">
                <button type="button" onClick={() => { setActiveFormType('customer'); setShowTypeSelector(false); setEditTransfer(null); }} className="focus-ring w-full bg-actionSecondary px-4 py-2.5 text-left text-sm font-semibold text-white transition-colors hover:bg-leaf focus:bg-leaf">💰 โอนให้ลูกค้า</button>
                <button type="button" onClick={() => { setActiveFormType('transport'); setShowTypeSelector(false); setEditTransfer(null); }} className="focus-ring w-full bg-actionSecondary px-4 py-2.5 text-left text-sm font-semibold text-white transition-colors hover:bg-leaf focus:bg-leaf">🚛 จ่ายค่าขนส่ง</button>
                <button type="button" onClick={() => { setActiveFormType('branch'); setShowTypeSelector(false); setEditTransfer(null); }} className="focus-ring w-full bg-actionSecondary px-4 py-2.5 text-left text-sm font-semibold text-white transition-colors hover:bg-leaf focus:bg-leaf">🏢 โอนให้สาขา</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Forms */}
      {activeFormType === 'customer' && (
        <ModalShell
          title={editTransfer ? "แก้ไขรายการโอนเงิน" : "สร้างรายการโอนเงินใหม่"}
          subtitle="โอนให้ลูกค้าจากบิลยางหรือใบชั่ง"
          size="wide"
          closeOnEscape
          onClose={() => {
            setActiveFormType(null);
            setEditTransfer(null);
          }}
        >
          <CustomerTransferForm
            locationId={locationId}
            online={online}
            profile={profile}
            bills={billsWithApprovalState}
            ocrTickets={ocrTickets}
            customers={customers}
            usedSourceIds={usedSourceIds}
            editTransfer={editTransfer}
            onSave={handleSave}
            onCancel={() => {
              setActiveFormType(null);
              setEditTransfer(null);
            }}
          />
        </ModalShell>
      )}
      {activeFormType === 'transport' && (
        <ModalShell
          title={editTransfer ? "แก้ไขรายการโอนเงิน (รถขนส่ง)" : "สร้างรายการโอนเงินใหม่ (รถขนส่ง)"}
          subtitle="บันทึกค่าขนส่งและหลักฐานการโอน"
          size="wide"
          closeOnEscape
          onClose={() => {
            setActiveFormType(null);
            setEditTransfer(null);
          }}
        >
          <TransportTransferForm
            locationId={locationId}
            online={online}
            editTransfer={editTransfer}
            onSave={handleSave}
            onCancel={() => {
              setActiveFormType(null);
              setEditTransfer(null);
            }}
          />
        </ModalShell>
      )}
      {activeFormType === 'branch' && (
        <ModalShell
          title={editTransfer ? "แก้ไขรายการโอนเงิน (ให้สาขา)" : "สร้างรายการโอนเงินใหม่ (ให้สาขา)"}
          subtitle="บันทึกรายการโอนเงินระหว่างสาขา"
          size="wide"
          closeOnEscape
          onClose={() => {
            setActiveFormType(null);
            setEditTransfer(null);
          }}
        >
          <BranchTransferForm
            locationId={locationId}
            mode={branchTransferFormMode}
            editTransfer={editTransfer}
            onSave={handleSave}
            onCancel={() => {
              setActiveFormType(null);
              setEditTransfer(null);
            }}
          />
        </ModalShell>
      )}

      {/* Transfer filters and actions */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setStatusFilter(value);
                setPage(1);
              }}
              aria-pressed={statusFilter === value}
              className={cn(
                "focus-ring inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold text-white",
                statusFilter === value ? "bg-leaf" : "bg-actionSecondary hover:bg-actionSecondary/90",
              )}
            >
              {label}
              <span className="min-w-5 rounded-full bg-white/20 px-1.5 py-0.5 text-center text-[10px] font-extrabold leading-none">
                {statusCounts.get(value) ?? 0}
              </span>
            </button>
          ))}
        </div>
        {statusFilter === "pending" && (
          <button
            type="button"
            onClick={handleMergePending}
            disabled={!online || mergePendingTransfers.isPending || eligibleMergeGroupCount === 0}
            title={eligibleMergeGroupCount > 0 ? `พบอย่างน้อย ${eligibleMergeGroupCount} กลุ่มที่รวมได้` : "ยังไม่มีกลุ่มรายการรอโอนที่รวมได้"}
            className="focus-ring inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-leaf px-3 py-2 text-sm font-semibold text-white hover:bg-leaf/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mergePendingTransfers.isPending ? <Loader2 size={16} className="animate-spin" /> : <GitMerge size={16} />}
            รวมบิลยางและใบชั่ง
          </button>
        )}
      </div>

      {/* Transfer List */}
      {transfers.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-panel">
          <div className="flex items-center justify-between border-b border-black/5 bg-field/60 px-5 py-3">
            <h3 className="font-bold text-ink">
              <CheckCircle2 size={16} className="mr-1.5 inline-block text-river" />
              รายการโอนเงิน ({filteredRows.length} รายการ)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/5 bg-field/30 text-left text-xs font-bold uppercase tracking-wider text-ink/50">
                  <th className="px-3 py-3 text-center">จัดการ</th>
                  <th className="px-3 py-3">#</th>
                  <th className="px-3 py-3">ประเภท</th>
                  <th className="px-3 py-3">ปลายทาง</th>
                  <th className="px-3 py-3">บัญชีธนาคาร</th>
                  <th className="px-3 py-3 text-right">ยอดที่ต้องจ่าย</th>
                  <th className="px-3 py-3 text-right">ยอดจ่ายจริง</th>
                  <th className="px-3 py-3 text-center">สลิป</th>
                  <th className="px-3 py-3 text-center">รายการ</th>
                  <th className="px-3 py-3">สถานะ</th>
                  <th className="px-3 py-3">สร้างโดย</th>
                  <th className="px-3 py-3">วันที่สร้าง</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map(({ transfer: t, summary }, idx) => {
                  const canCopyAmount = summary.status === "pending" || summary.status === "partial";
                  const amountToCopy = summary.status === "partial"
                    ? Math.max(summary.amountDue - summary.amountPaid, 0)
                    : summary.amountDue;
                  const formattedAmountToCopy = MONEY_TRANSFER_AMOUNT_FORMATTER.format(amountToCopy);

                  return (
                  <tr key={t.id} data-transfer-id={t.id} className="border-b border-black/5 transition-colors hover:bg-mint/20">
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleShare(t)}
                          disabled={!online || Boolean(getMoneyTransferPrintBlockReason(t)) || pdfShare.busy}
                          aria-label={`แชร์ PDF รายการโอนเงิน ${shortTransferId(t.id)}`}
                          className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md bg-actionSecondary px-3 text-xs font-semibold text-white hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-40"
                          title={!online ? offlineMessage : getMoneyTransferPrintBlockReason(t) ?? (pdfShare.busy ? "กำลังสร้าง PDF" : "แชร์ PDF ใบรายการโอนเงิน 80 มม.")}
                        >
                          <Share2 size={14} />
                          แชร์ PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEdit(t)}
                          disabled={!online || Boolean(t.reportLockNo)}
                          className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md bg-amber px-3 text-xs font-semibold text-white shadow-sm hover:bg-amber/90 disabled:cursor-not-allowed disabled:opacity-40"
                          title={t.reportLockNo ? `ล็อกโดยรายงาน ${t.reportLockNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน` : online ? "แก้ไข" : offlineMessage}
                        >
                          <Edit3 size={14} />
                          แก้ไข
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (t.reportLockNo) {
                              setToastMsg(`ล็อกโดยรายงาน ${t.reportLockNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน`);
                              return;
                            }
                            if (!online) {
                              setToastMsg(offlineMessage);
                              return;
                            }
                            setDeleteConfirmId(t.id);
                          }}
                          disabled={!online || Boolean(t.reportLockNo)}
                          className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md bg-clay px-3 text-xs font-semibold text-white hover:bg-clay/90 disabled:cursor-not-allowed disabled:opacity-40"
                          title={t.reportLockNo ? `ล็อกโดยรายงาน ${t.reportLockNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน` : online ? "ลบ" : offlineMessage}
                        >
                          <Trash2 size={14} />
                          ลบ
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-ink/40">{(currentPage - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold",
                        t.transferType === "customer" && "bg-blue-100 text-blue-700",
                        t.transferType === "transport" && "bg-orange-100 text-orange-700",
                        t.transferType === "branch" && "bg-purple-100 text-purple-700",
                      )}>
                        {t.transferType === "customer" ? "ลูกค้า" : t.transferType === "transport" ? "รถขนส่ง" : "ให้สาขา"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-ink">{t.customerName ?? t.transportStaffName ?? t.targetLocationName ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      {t.accountNumber ? (
                        <div className="max-w-[240px] rounded border border-sky-200/70 bg-sky-50/60 p-1.5 text-[11px]">
                          {t.bankName && <span className="block font-bold text-sky-800">{t.bankName}</span>}
                          <div className="mt-0.5 flex items-center gap-1">
                            <span className="font-mono tabular-nums text-ink/80">{t.accountNumber}</span>
                            <button
                              type="button"
                              onClick={() => void copyToClipboard(t.accountNumber!, "คัดลอกเลขบัญชีแล้ว")}
                              aria-label={`คัดลอกเลขบัญชี ${t.accountNumber}`}
                              title="คัดลอกเลขบัญชี"
                              className="focus-ring inline-flex h-10 shrink-0 items-center justify-center gap-1 rounded bg-actionSecondary px-2 text-xs font-semibold text-white hover:bg-actionSecondary/90"
                            >
                              <Copy size={12} />
                              คัดลอก
                            </button>
                          </div>
                          {t.accountName && <span className="block truncate text-[10px] text-ink/50">{t.accountName}</span>}
                        </div>
                      ) : (
                        <span className="text-xs text-ink/30">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex min-w-[168px] flex-col items-end gap-1.5">
                        <span className="font-mono font-bold tabular-nums text-river">
                          {formatMoneyTransferCurrency(summary.amountDue)}
                        </span>
                        {summary.status === "partial" && (
                          <span className="text-xs font-semibold tabular-nums text-amber">
                            คงเหลือ {formatMoneyTransferCurrency(amountToCopy)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => void copyToClipboard(
                            amountToCopy.toFixed(2),
                            `คัดลอกยอด ${formattedAmountToCopy} บาทแล้ว`,
                          )}
                          disabled={!canCopyAmount}
                          aria-label={`คัดลอกยอด ${formattedAmountToCopy} บาท`}
                          title={canCopyAmount
                            ? `คัดลอกยอด ${formattedAmountToCopy} บาท`
                            : "คัดลอกยอดได้เฉพาะรายการรอโอนหรือค้างจ่าย"}
                          className="focus-ring inline-flex h-10 items-center justify-center gap-1 rounded bg-actionSecondary px-2 text-xs font-semibold text-white hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Copy size={12} />
                          คัดลอกยอด
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums text-leaf">{formatMoneyTransferCurrency(summary.amountPaid)}</td>
                    <td className="px-3 py-2.5 text-center"><span className="rounded-full bg-river/10 px-2 py-0.5 text-xs font-bold text-river">{t.slips?.length ?? 0}</span></td>
                    <td className="px-3 py-2.5 text-center"><span className="rounded-full bg-leaf/10 px-2 py-0.5 text-xs font-bold text-leaf">{t.items?.length ?? 0}</span></td>
                    <td className="px-3 py-2.5">
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_STYLES[summary.status])}>
                        {STATUS_LABELS[summary.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-ink/60">{t.createdByName ?? "—"}</td>
                    <td className="px-3 py-2.5 text-sm text-ink/60">
                      {t.createdAt ? new Date(t.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "—"}
                    </td>
                  </tr>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr><td colSpan={12} className="px-6 py-10 text-center text-sm text-ink/45">ไม่มีรายการในสถานะนี้</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-col gap-3 border-t border-black/5 px-4 pb-4 pt-3 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-sm text-ink/60">
              แสดง {filteredRows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredRows.length)} จาก {filteredRows.length} รายการ
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={currentPage === 1}
                className="focus-ring flex items-center gap-1.5 rounded-md bg-actionSecondary px-3 py-2 text-sm font-semibold text-white hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={16} /> ก่อนหน้า
              </button>
              <span className="min-w-20 text-center text-sm font-semibold tabular-nums text-ink">หน้า {currentPage}/{totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={currentPage === totalPages}
                className="focus-ring flex items-center gap-1.5 rounded-md bg-actionSecondary px-3 py-2 text-sm font-semibold text-white hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ถัดไป <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {transfers.length === 0 && !activeFormType && (
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
              <button type="button" onClick={() => setDeleteConfirmId(null)} className="focus-ring rounded-md bg-actionSecondary px-4 py-2 text-sm font-semibold text-white hover:bg-actionSecondary/90">
                ยกเลิก
              </button>
              <button type="button" onClick={handleDeleteConfirm} disabled={!online} title={online ? undefined : offlineMessage} className="focus-ring rounded-md bg-clay px-4 py-2 text-sm font-semibold text-white hover:bg-clay/90 disabled:cursor-not-allowed disabled:opacity-50">
                ลบ
              </button>
            </div>
          </div>
        </div>
      )}
      <SharePdfWaitingModal open={pdfShare.waiting} onCancel={pdfShare.cancel} />
    </div>
  );
}
