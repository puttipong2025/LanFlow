import { ArrowRightLeft, Edit3, ExternalLink, Eye, Plus, Settings, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { formatCurrency } from "@/lib/format";
import { useIncomeExpense } from "@/hooks/useIncomeExpense";
import { useIncomeExpenseApprovals } from "@/hooks/useIncomeExpenseApprovals";
import { useMoneyTransfers } from "@/hooks/useMoneyTransfers";
import { useCashBranchTransfers } from "@/hooks/useCashBranchTransfers";
import { useLocations } from "@/hooks/useLocations";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePerRecordSyncRetry } from "@/hooks/usePerRecordSyncRetry";
import { getOfflineSyncedActionBlockReason } from "@/lib/record-action-locks";
import { canAccessSourceLocation, canManageSystemFeatures } from "@/lib/permissions";
import { INCOME_EXPENSE_FEED_QUERY_KEY } from "@/lib/income-expense/query-keys";
import {
  buildSaleReceiptModel,
  getSaleReceiptShareBlockReason,
  renderSaleReceiptHtml,
} from "@/lib/income-expense/sale-receipt";
import { receiptPdfFilename } from "@/lib/rubber-bills/print-receipt";
import {
  cashTransferReference,
  renderCashTransferReceiptHtml,
} from "@/lib/cash-branch-transfer-receipt";
import { useSharePdf } from "@/hooks/useSharePdf";

import type { CashBranchTransfer, IncomeExpense, Location, MoneyTransfer, Profile } from "@/types";
import { IconButton } from "@/components/shared/IconButton";
import { SyncStatusBadge } from "@/components/shared/SyncStatusBadge";
import { BranchTransferForm } from "@/components/money-transfer/BranchTransferForm";
import { CashBranchTransferCreateModal, CashBranchTransferDetails, CashBranchTransferReceiveModal } from "./CashBranchTransferModal";
import { getIncomeExpenseDisplayNo } from "./income-expense-display";
import { IncomeExpenseApprovalModal } from "./IncomeExpenseApprovalModal";
import { IncomeExpenseModal } from "./IncomeExpenseModal";
import { SharePdfWaitingModal } from "@/components/shared/SharePdfWaitingModal";
import { ModalShell } from "@/components/shared/ModalShell";

function BranchTransferModeSelector({
  mode,
  bankAllowed,
  onChange,
}: {
  mode: "cash" | "bank";
  bankAllowed: boolean;
  onChange: (mode: "cash" | "bank") => void;
}) {
  const buttonClass = (active: boolean) =>
    active
      ? "focus-ring rounded-md bg-river px-3 py-1.5 text-sm font-semibold text-white"
      : "focus-ring rounded-md px-3 py-1.5 text-sm font-semibold text-ink/65 hover:bg-white";

  return (
    <div
      data-testid="branch-transfer-mode-selector"
      className="flex shrink-0 items-center justify-between gap-3 border-b border-black/[0.07] bg-white px-3 py-2.5 sm:px-4"
    >
      <span className="text-sm font-semibold text-ink/60">รูปแบบการโยกเงิน</span>
      <div className="inline-flex rounded-lg bg-field p-1">
        <button
          type="button"
          aria-pressed={mode === "cash"}
          onClick={() => onChange("cash")}
          className={buttonClass(mode === "cash")}
        >
          เงินสด
        </button>
        <button
          type="button"
          aria-pressed={mode === "bank"}
          onClick={() => {
            if (!bankAllowed) return toast.error("ไม่มีสิทธิ์ใช้โอนธนาคาร");
            onChange("bank");
          }}
          className={buttonClass(mode === "bank")}
        >
          โอนธนาคาร
        </button>
      </div>
    </div>
  );
}

export function IncomeExpenseModule({
  selectedLocation,
  profile,
  canCreateMoneyTransfer = true,
  onOpenMoneyTransferSource,
  onOpenRubberBillSource,
  onOpenRubberExportSource,
  onOpenOcrTicketSource,
  onOpenTimeTrackingSource,
}: {
  selectedLocation: Location;
  profile: Profile;
  canCreateMoneyTransfer?: boolean;
  onOpenMoneyTransferSource?: (transferId: string, locationId: string) => void;
  onOpenRubberBillSource?: (locationId: string, billDate?: string) => void;
  onOpenRubberExportSource?: (exportId: string, locationId: string) => void;
  onOpenOcrTicketSource?: (locationId: string, ticketDate?: string) => void;
  onOpenTimeTrackingSource?: (sourceId: string, sourceType: "time_tracking_withdrawal" | "payroll_slip") => void;
}) {
  const queryClient = useQueryClient();
  const pdfShare = useSharePdf();
  const {
    transactions,
    addTransaction,
    updateTransaction,
    syncTransaction,
    deleteTransaction,
    hasMore,
    isLoadingMore,
    loadMore,
  } = useIncomeExpense(selectedLocation.id, profile.id);
  const isOnline = useOnlineStatus();
  const canManageSystem = canManageSystemFeatures(profile);
  const {
    pendingCount: pendingApprovalCount,
    submitForApprovalIfNeeded,
  } = useIncomeExpenseApprovals({
    includePendingCount: canManageSystem,
    pendingLocationId: selectedLocation.id,
  });
  const approvalButtonLabel = isOnline && pendingApprovalCount > 0
    ? `ตั้งค่าและอนุมัติรับ-จ่าย รออนุมัติ ${pendingApprovalCount} รายการ`
    : "ตั้งค่าและอนุมัติรับ-จ่าย";
  const { addTransfer } = useMoneyTransfers(selectedLocation.id, { enabled: canCreateMoneyTransfer });
  const cashTransfers = useCashBranchTransfers(selectedLocation.id);
  const { locations } = useLocations();
  const pendingCashReceipts = cashTransfers.transfers.filter((transfer) => transfer.targetLocationId === selectedLocation.id && transfer.status === "pending_receipt");
  const { retrySyncEvent, isRetrying } = usePerRecordSyncRetry(selectedLocation.id, profile.id);
  const ledgerTransactions = transactions;
  const nextNumber = String(ledgerTransactions.length + 1);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"income" | "expense">("income");
  const [editingTransaction, setEditingTransaction] = useState<IncomeExpense | null>(null);
  const [viewingSaleBill, setViewingSaleBill] = useState<IncomeExpense | null>(null);
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [branchTransferModalOpen, setBranchTransferModalOpen] = useState(false);
  const [branchTransferMode, setBranchTransferMode] = useState<"cash" | "bank">("cash");
  const [cashReceiptId, setCashReceiptId] = useState<string | null>(null);
  const [cashDetailsId, setCashDetailsId] = useState<string | null>(null);
  const [cashEditingId, setCashEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const visibleTransactions = search.trim()
    ? ledgerTransactions.filter((transaction) =>
      `${transaction.number} ${transaction.title} ${transaction.createdByName}`
        .toLocaleLowerCase("th-TH")
        .includes(search.trim().toLocaleLowerCase("th-TH"))
    )
    : ledgerTransactions;

  function openAdd(type: "income" | "expense") {
    setModalType(type);
    setEditingTransaction(null);
    setModalOpen(true);
  }

  async function loadSaleBillDetails(transaction: IncomeExpense) {
    if (transaction.billOption !== "บิลขาย" || transaction.saleLines) return transaction;
    const response = await fetch(`/api/lanflow/income-expense/${transaction.id}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error ?? "โหลดรายการบิลขายไม่สำเร็จ");
    }
    return {
      ...transaction,
      title: data.title ?? transaction.title,
      cost: typeof data.cost === "number" ? data.cost : transaction.cost,
      serverBillNo: data.serverBillNo ?? transaction.serverBillNo,
      number: data.serverBillNo ?? transaction.number,
      txDate: data.txDate ?? transaction.txDate,
      createdByName: data.createdByName ?? transaction.createdByName,
      revisionNo: Number.isInteger(data.revisionNo) ? data.revisionNo : transaction.revisionNo,
      reportLockNo: data.reportLockNo ?? transaction.reportLockNo,
      saleLineCount: data.saleLineCount,
      saleLines: data.saleLines,
    } satisfies IncomeExpense;
  }

  async function openSaleDetails(transaction: IncomeExpense) {
    try {
      setViewingSaleBill(await loadSaleBillDetails(transaction));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "โหลดรายการบิลขายไม่สำเร็จ");
    }
  }

  async function openEdit(transaction: IncomeExpense) {
    const blockReason = getActionBlockReason(transaction);
    if (blockReason) {
      toast.error(blockReason);
      return;
    }
    try {
      const detailedTransaction = await loadSaleBillDetails(transaction);
      setModalType(detailedTransaction.type);
      setEditingTransaction(detailedTransaction);
      setModalOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "โหลดรายการบิลขายไม่สำเร็จ");
    }
  }

  function getActionBlockReason(transaction: IncomeExpense) {
    if (transaction.relationLockReason) return transaction.relationLockReason;
    return getOfflineSyncedActionBlockReason(transaction, isOnline);
  }

  function openBranchTransfer() {
    if (!isOnline) {
      toast.error("การโยกเงินไปสาขาอื่นต้องออนไลน์ก่อน");
      return;
    }
    setBranchTransferMode("cash");
    setBranchTransferModalOpen(true);
  }

  function handleBranchTransferSave(transfer: MoneyTransfer) {
    addTransfer.mutate(transfer, {
      onSuccess: () => {
        setBranchTransferModalOpen(false);
        queryClient.invalidateQueries({ queryKey: [INCOME_EXPENSE_FEED_QUERY_KEY] });
        toast.success("บันทึกรายการโยกเงินไปสาขาอื่นแล้ว");
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : "บันทึกรายการโยกเงินไม่สำเร็จ");
      },
    });
  }

  async function confirmDelete(transaction: IncomeExpense) {
    const blockReason = getActionBlockReason(transaction);
    if (blockReason) {
      toast.error(blockReason);
      return;
    }
    if (window.confirm(`ลบรายการ ${transaction.number} ใช่ไหม?`)) {
      try {
        const approvalResult = await submitForApprovalIfNeeded(transaction, "delete");
        if (approvalResult.requiresApproval) {
          toast.info("ส่งคำขอลบบิลเพื่อรออนุมัติแล้ว");
          return;
        }
        await deleteTransaction({
          clientTempId: transaction.clientTempId,
          deletedByName: profile.name,
          deletedByPhone: profile.phone,
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "ลบรายการไม่สำเร็จ");
      }
    }
  }

  async function retryFailedSync(transaction: IncomeExpense) {
    try {
      await retrySyncEvent({ entity: "income_expense", id: transaction.clientTempId });
      toast.success("ซิงก์รายการสำเร็จ");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ซิงก์รายการไม่สำเร็จ");
    }
  }

  function saleReceiptDocument(transaction: IncomeExpense) {
    const referenceNo = transaction.serverBillNo;
    if (!referenceNo) throw new Error("บิลขายยังไม่มีเลขบิลส่วนกลาง");
    return {
      html: renderSaleReceiptHtml(buildSaleReceiptModel(transaction, selectedLocation)),
      filename: receiptPdfFilename("LanFlow-sale-bill", referenceNo),
    };
  }

  function showSaleReceiptDelivery(delivery: "shared" | "downloaded" | "cancelled") {
    if (delivery === "shared") toast.success("แชร์ PDF บิลขายแล้ว");
    if (delivery === "downloaded") {
      toast.success("แชร์บนอุปกรณ์นี้ไม่ได้ จึงดาวน์โหลด PDF แทน");
    }
  }

  function abortShare() {
    const error = new Error("ยกเลิกการรอแชร์ PDF");
    error.name = "AbortError";
    return error;
  }

  async function persistSubmittedTransactions(submittedTransactions: IncomeExpense[]) {
    let pendingApprovalCount = 0;
    const persistedTransactions: IncomeExpense[] = [];
    let persistError: unknown;

    for (const [index, transaction] of submittedTransactions.entries()) {
      try {
        const isSyncedRecord =
          Boolean(transaction.serverBillNo)
          || transaction.id !== transaction.clientTempId;
        const operation =
          editingTransaction && index === 0 && isSyncedRecord ? "update" : "create";
        const approvalResult = await submitForApprovalIfNeeded(transaction, operation);

        if (approvalResult.requiresApproval) {
          pendingApprovalCount += 1;
          continue;
        }

        persistedTransactions.push(
          operation === "update"
            ? await updateTransaction(transaction)
            : await addTransaction(transaction)
        );
      } catch (error) {
        persistError = error;
        break;
      }
    }

    return { pendingApprovalCount, persistedTransactions, persistError };
  }

  function showPersistSummary(
    pendingApprovalCount: number,
    persistedCount: number
  ) {
    if (pendingApprovalCount > 0) {
      toast.info(`ส่งคำขออนุมัติ ${pendingApprovalCount} รายการแล้ว`);
    }
    if (persistedCount > 0 && pendingApprovalCount > 0) {
      toast.success(`บันทึกรายการที่ไม่ต้องอนุมัติ ${persistedCount} รายการแล้ว`);
    }
  }

  async function shareSaleReceipt(transaction: IncomeExpense) {
    try {
      const detailedTransaction = await loadSaleBillDetails(transaction);
      const blockReason = getSaleReceiptShareBlockReason(detailedTransaction, isOnline)
        ?? (pdfShare.busy ? "กำลังสร้าง PDF" : null);
      if (blockReason) {
        toast.error(blockReason);
        return;
      }
      const delivery = await pdfShare.sharePdf(() => saleReceiptDocument(detailedTransaction));
      showSaleReceiptDelivery(delivery);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "สร้าง PDF บิลขายไม่สำเร็จ");
    }
  }

  async function submitAndShareSaleReceipt(
    submittedTransactions: IncomeExpense[]
  ) {
    if (pdfShare.busy) {
      toast.error("กำลังสร้าง PDF อื่นอยู่ กรุณารอสักครู่");
      return;
    }

    setModalOpen(false);

    try {
      const delivery = await pdfShare.sharePdf(async (signal) => {
        const { pendingApprovalCount, persistedTransactions, persistError } =
          await persistSubmittedTransactions(submittedTransactions);
        showPersistSummary(pendingApprovalCount, persistedTransactions.length);

        const syncedTransaction = persistedTransactions[0]
          ? await syncTransaction(persistedTransactions[0])
          : undefined;

        if (persistError) throw persistError;
        if (pendingApprovalCount > 0 || signal.aborted) throw abortShare();

        const blockReason = getSaleReceiptShareBlockReason(syncedTransaction, true);
        if (blockReason || !syncedTransaction) {
          throw new Error(blockReason ?? "ไม่พบบิลขายหลังซิงก์");
        }

        return saleReceiptDocument(syncedTransaction);
      });
      showSaleReceiptDelivery(delivery);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "บันทึกหรือซิงก์บิลขายไม่สำเร็จ");
    }
  }

  async function shareCashTransfer(transfer: CashBranchTransfer) {
    if (pdfShare.busy) {
      toast.error("กำลังสร้าง PDF");
      return;
    }

    const sourceLocationName = locations.find((location) => location.id === transfer.locationId)?.name
      ?? (transfer.locationId === selectedLocation.id ? selectedLocation.name : "ไม่ทราบสาขา");
    const reference = cashTransferReference(transfer.id);
    try {
      const delivery = await pdfShare.sharePdf(() => ({
        html: renderCashTransferReceiptHtml(transfer, sourceLocationName),
        filename: receiptPdfFilename("LanFlow-cash-transfer", reference),
      }));
      if (delivery === "shared") toast.success("แชร์ PDF รายละเอียดเงินสดแล้ว");
      if (delivery === "downloaded") toast.success("แชร์บนอุปกรณ์นี้ไม่ได้ จึงดาวน์โหลด PDF แทน");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "สร้าง PDF รายละเอียดเงินสดไม่สำเร็จ");
    }
  }

  function cashDeleteBlockReason(transfer: CashBranchTransfer) {
    if (!isOnline) return "การลบรายการโยกเงินต้องออนไลน์";
    if (transfer.reportLockNo) {
      return `ล็อกโดยรายงาน ${transfer.reportLockNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน`;
    }
    const isSourceAdmin = profile.role === "admin" && profile.locationIds.includes(transfer.locationId);
    if (!canManageSystem && !isSourceAdmin) return "เฉพาะผู้ดูแลสาขาต้นทางหรือผู้จัดการระบบเท่านั้น";
    return null;
  }

  async function confirmCashDelete(transfer: CashBranchTransfer) {
    const blockReason = cashDeleteBlockReason(transfer);
    if (blockReason) {
      toast.error(blockReason);
      return;
    }
    const warning = transfer.status === "received"
      ? "ปลายทางยืนยันยอดแล้ว ระบบอาจส่งคำขอลบให้ผู้จัดการอนุมัติ ดำเนินการต่อใช่ไหม?"
      : "ลบรายการโยกเงินนี้ถาวรใช่ไหม?";
    if (!window.confirm(warning)) return;

    try {
      const result = await cashTransfers.remove.mutateAsync(transfer.id);
      if (result.status === "pending_approval") {
        toast.info("ส่งคำขอลบไปที่ ตั้งค่าและอนุมัติรับ-จ่าย แล้ว");
      } else {
        toast.success("ลบรายการโยกเงินแล้ว");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ลบรายการโยกเงินไม่สำเร็จ");
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-md border border-black/10 bg-white p-3 shadow-panel sm:p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-bold text-ink">CRUD รายรับ-รายจ่าย · {selectedLocation.name}</h2>
          <p className="text-sm text-ink/60">เพิ่มผ่าน modal และจัดการรายการจากตาราง</p>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ค้นหาในรายการที่โหลดแล้ว"
            className="mt-3 h-9 w-full max-w-xs rounded-md border border-black/15 px-3 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => openAdd("income")}
            className="focus-ring flex h-10 w-full items-center justify-center gap-2 rounded-md bg-leaf px-4 text-sm font-semibold text-white sm:w-auto"
          >
            <Plus size={18} />
            เพิ่มรายรับ
          </button>
          <button
            type="button"
            onClick={() => openAdd("expense")}
            className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-clay px-3 text-sm font-semibold text-white hover:bg-clay/90"
          >
            <Plus size={18} />
            เพิ่มรายจ่าย
          </button>
          {canAccessSourceLocation(profile, selectedLocation.id) && (
            <button
              type="button"
              onClick={openBranchTransfer}
              disabled={!isOnline}
              title={isOnline ? "โยกเงินไปสาขาอื่น" : "โยกเงินต้องออนไลน์ก่อน"}
              className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-river px-3 text-sm font-semibold text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <ArrowRightLeft size={18} />
              {isOnline ? "โยกเงินไปสาขาอื่น" : "โยกเงินใช้ได้เมื่อออนไลน์"}
            </button>
          )}
          {pendingCashReceipts.length > 0 && (
            <button type="button" disabled={!isOnline} onClick={() => setCashReceiptId(pendingCashReceipts[0]?.id ?? null)} className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-amber px-3 text-sm font-semibold text-white hover:bg-amber/90 disabled:cursor-not-allowed disabled:bg-slate-300">
              <ArrowRightLeft size={18} /> รอรับเงิน ({pendingCashReceipts.length})
            </button>
          )}
          {canManageSystem && (
            <button
              type="button"
              onClick={() => {
                if (!isOnline) {
                  toast.error("ตั้งค่าและอนุมัติรับ-จ่ายใช้ได้เมื่อออนไลน์เท่านั้น");
                  return;
                }
                setApprovalModalOpen(true);
              }}
              disabled={!isOnline}
              aria-label={approvalButtonLabel}
              title={isOnline ? approvalButtonLabel : "ตั้งค่าและอนุมัติรับ-จ่ายใช้ได้เมื่อออนไลน์เท่านั้น"}
              className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-settings px-3 text-sm font-semibold text-white hover:bg-settings/90 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Settings size={18} />
              ตั้งค่าและอนุมัติรับ-จ่าย
              {isOnline && pendingApprovalCount > 0 && (
                <span
                  aria-hidden="true"
                  className="min-w-5 rounded-full bg-amber px-1.5 py-0.5 text-center text-[10px] font-extrabold leading-none text-white"
                >
                  {pendingApprovalCount > 99 ? "99+" : pendingApprovalCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {pendingCashReceipts.length > 0 && (
        <section className="rounded-md border border-amber/40 bg-amber/10 p-3">
          <h3 className="font-bold text-ink">คิวรอตรวจรับเงินสด</h3>
          <div className="mt-2 space-y-2">
            {pendingCashReceipts.map((transfer) => <button key={transfer.id} type="button" data-transfer-id={transfer.id} disabled={!isOnline} onClick={() => setCashReceiptId(transfer.id)} className="flex w-full items-center justify-between rounded bg-amber px-3 py-2 text-left text-sm text-white hover:bg-amber/90 disabled:opacity-60"><span>จาก {transfer.createdByName} · {formatCurrency(transfer.sentTotal)}</span><span className="font-semibold">ตรวจรับ</span></button>)}
          </div>
        </section>
      )}

      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-ink/60">
                <th className="py-2">เลขที่</th>
                <th>เลขบิล</th>
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
              {visibleTransactions.map((transaction) => {
                const actionBlockReason = getActionBlockReason(transaction);
                const actionsDisabled = Boolean(actionBlockReason);
                const isSaleBill = transaction.billOption === "บิลขาย";
                const saleShareBlockReason = isSaleBill
                  ? !isOnline
                    ? "แชร์ PDF บิลขายได้เมื่อออนไลน์"
                    : transaction.syncStatus !== "synced" || !transaction.serverBillNo
                      ? "กำลังรอให้บิลขายซิงก์สำเร็จ"
                      : pdfShare.busy
                        ? "กำลังสร้าง PDF"
                        : null
                  : null;
                const sourceLocationId = transaction.relationSourceLocationId ?? transaction.locationId;
                const cashTransferId = transaction.relationSourceId?.startsWith("cash:") ? transaction.relationSourceId.slice(5) : null;
                const cashTransfer = cashTransferId
                  ? cashTransfers.transfers.find((item) => item.id === cashTransferId)
                  : undefined;
                const cashDeleteReason = cashTransferId
                  ? cashTransfer
                    ? cashDeleteBlockReason(cashTransfer)
                    : "กำลังโหลดรายละเอียดเงินสด"
                  : null;
                const canOpenMoneyTransferSource = Boolean(
                  transaction.relationSourceType === "money_transfer" &&
                  transaction.relationSourceId &&
                  onOpenMoneyTransferSource &&
                  canAccessSourceLocation(profile, sourceLocationId)
                );
                const canOpenRubberBillSource = Boolean(
                  transaction.relationSourceType === "rubber_bill_daily" &&
                  onOpenRubberBillSource &&
                  canAccessSourceLocation(profile, sourceLocationId)
                );
                const canOpenOcrTicketSource = Boolean(
                  transaction.relationSourceType === "ocr_ticket_daily" &&
                  onOpenOcrTicketSource &&
                  canAccessSourceLocation(profile, sourceLocationId)
                );
                const canOpenRubberExportSource = Boolean(
                  transaction.relationSourceType === "rubber_export" &&
                  transaction.relationSourceId &&
                  onOpenRubberExportSource &&
                  canAccessSourceLocation(profile, sourceLocationId)
                );
                const canOpenTimeTrackingSource = Boolean(
                  (transaction.relationSourceType === "time_tracking_withdrawal" || transaction.relationSourceType === "payroll_slip") &&
                  transaction.relationSourceId &&
                  onOpenTimeTrackingSource &&
                  (profile.role === "admin" || profile.role === "super_admin")
                );
                const canOpenSource = Boolean(cashTransferId) || canOpenMoneyTransferSource || canOpenRubberBillSource || canOpenRubberExportSource || canOpenOcrTicketSource || canOpenTimeTrackingSource;
                const openSourceLabel = transaction.relationSourceType === "rubber_export"
                  ? "ดูรายการส่งออกยาง"
                  : "เปิดรายการต้นทาง";

                function openRelationSource() {
                  if (cashTransferId) { setCashDetailsId(cashTransferId); return; }
                  if (canOpenMoneyTransferSource) {
                    onOpenMoneyTransferSource?.(transaction.relationSourceId!, sourceLocationId);
                    return;
                  }
                  if (canOpenRubberBillSource) {
                    onOpenRubberBillSource?.(sourceLocationId, transaction.relationSourceDate);
                    return;
                  }
                  if (canOpenRubberExportSource) {
                    onOpenRubberExportSource?.(transaction.relationSourceId!, sourceLocationId);
                    return;
                  }
                  if (canOpenOcrTicketSource) {
                    onOpenOcrTicketSource?.(sourceLocationId, transaction.relationSourceDate);
                    return;
                  }
                  if (canOpenTimeTrackingSource) {
                    onOpenTimeTrackingSource?.(
                      transaction.relationSourceId!,
                      transaction.relationSourceType as "time_tracking_withdrawal" | "payroll_slip",
                    );
                  }
                }

                return (
                <tr key={transaction.id} className="border-b border-black/5 hover:bg-field/50">
                  <td className="py-3 font-semibold">{getIncomeExpenseDisplayNo(transaction)}</td>
                  <td className="text-xs text-ink/55">
                    <div className="flex flex-col gap-0.5">
                      <span>{getIncomeExpenseDisplayNo(transaction)}</span>
                      {transaction.serverBillNo ? (
                        transaction.localBillNo !== transaction.serverBillNo && (
                          <span className="text-[10px] text-leaf font-semibold">ซิงก์จาก {transaction.localBillNo}</span>
                        )
                      ) : (
                        <span className="text-[10px] text-amber-600 font-semibold">Local</span>
                      )}
                    </div>
                  </td>
                  <td>{transaction.txDate}</td>
                  <td>{transaction.type === "income" ? "รายรับ" : "รายจ่าย"}</td>
                  <td>
                    <div className="flex flex-col gap-1">
                      <span>{transaction.title}</span>
                      {transaction.relationLabel && (
                        <span className="w-fit rounded-full bg-river/10 px-2 py-0.5 text-[10px] font-bold text-river">
                          {transaction.relationLabel}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>{transaction.billOption}</td>
                  <td className={transaction.type === "income" ? "font-semibold text-leaf" : "font-semibold text-clay"}>
                    {transaction.type === "income" ? "+" : "-"}{formatCurrency(transaction.cost)}
                  </td>
                  <td>{transaction.createdByName} · {transaction.createdByPhone}</td>
                  <td><SyncStatusBadge status={transaction.syncStatus} errorMessage={transaction.syncErrorMessage} /></td>
                  <td>
                    <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                      {cashTransferId ? (
                        <IconButton
                          label={!cashTransfer ? "กำลังโหลดรายละเอียดเงินสด" : pdfShare.busy ? "กำลังสร้าง PDF" : "แชร์ PDF รายละเอียดเงินสด 80 มม."}
                          visibleLabel="แชร์ PDF"
                          onClick={() => { if (cashTransfer) void shareCashTransfer(cashTransfer); }}
                          tone="actionSecondary"
                          disabled={!cashTransfer || pdfShare.busy}
                        >
                          <Share2 size={16} />
                        </IconButton>
                      ) : (
                        <>
                          {isSaleBill && (
                            <IconButton label="ดูรายละเอียดบิลขาย" visibleLabel="ดู" onClick={() => void openSaleDetails(transaction)} tone="actionSecondary">
                              <Eye size={16} />
                            </IconButton>
                          )}
                          <IconButton label={actionBlockReason ?? "แก้ไข"} visibleLabel="แก้ไข" onClick={() => void openEdit(transaction)} tone="amber" disabled={actionsDisabled}>
                            <Edit3 size={16} />
                          </IconButton>
                        </>
                      )}
                      {cashTransferId ? (
                        <IconButton
                          label={cashDeleteReason ?? "ลบรายการโยกเงิน"}
                          visibleLabel="ลบ"
                          onClick={() => { if (cashTransfer) void confirmCashDelete(cashTransfer); }}
                          tone="danger"
                          disabled={!cashTransfer || Boolean(cashDeleteReason) || cashTransfers.remove.isPending}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      ) : (
                        <IconButton label={actionBlockReason ?? "ลบ"} visibleLabel="ลบ" onClick={() => void confirmDelete(transaction)} tone="danger" disabled={actionsDisabled}>
                          <Trash2 size={16} />
                        </IconButton>
                      )}
                      {isSaleBill && (
                        <button
                          type="button"
                          onClick={() => void shareSaleReceipt(transaction)}
                          disabled={Boolean(saleShareBlockReason)}
                          title={saleShareBlockReason ?? "แชร์ PDF บิลขาย 80 มม."}
                          aria-label={`แชร์ PDF บิลขาย ${transaction.serverBillNo ?? transaction.localBillNo}`}
                          className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md bg-actionSecondary px-3 text-sm font-semibold text-white hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Share2 size={16} />
                          แชร์ PDF
                        </button>
                      )}
                      {transaction.syncStatus === "failed" && (
                        <button
                          type="button"
                          onClick={() => void retryFailedSync(transaction)}
                          disabled={!isOnline || isRetrying}
                          className="rounded-md bg-river px-2 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          ลองซิงก์อีกครั้ง
                        </button>
                      )}
                      {canOpenSource && (
                        <button
                          type="button"
                          title={openSourceLabel}
                          aria-label={openSourceLabel}
                          onClick={openRelationSource}
                          className="focus-ring inline-flex h-9 shrink-0 items-center gap-1 rounded-md bg-river px-2 text-xs font-semibold text-white hover:bg-river/90"
                        >
                          <ExternalLink size={16} />
                          {openSourceLabel}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
              {visibleTransactions.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-ink/50">
                    {search ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีรายการรับ-จ่ายในสาขานี้"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={isLoadingMore}
            className="focus-ring rounded-md bg-actionSecondary px-4 py-2 text-sm font-semibold text-white hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoadingMore ? "กำลังโหลด..." : "โหลดรายการเพิ่ม"}
          </button>
        </div>
      )}

      {modalOpen && (
        <IncomeExpenseModal
          selectedLocation={selectedLocation}
          profile={profile}
          type={modalType}
          transaction={editingTransaction}
          nextNumber={nextNumber}
          nextLocalSequence={transactions.length + 1}
          onClose={() => setModalOpen(false)}
          onSave={async (savedTransactions) => {
            const isSaleSubmission =
              savedTransactions.length > 0
              && savedTransactions.every(
                (transaction) => transaction.billOption === "บิลขาย"
              );
            if (isSaleSubmission) {
              await submitAndShareSaleReceipt(savedTransactions);
              return;
            }

            try {
              const { pendingApprovalCount, persistedTransactions, persistError } =
                await persistSubmittedTransactions(savedTransactions);
              if (persistError) throw persistError;
              setModalOpen(false);
              showPersistSummary(pendingApprovalCount, persistedTransactions.length);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "บันทึกรายการไม่สำเร็จ");
            }
          }}
        />
      )}

      {viewingSaleBill && (
        <ModalShell
          title={`รายละเอียด ${viewingSaleBill.serverBillNo ?? viewingSaleBill.localBillNo}`}
          subtitle={`${viewingSaleBill.title} · ${viewingSaleBill.txDate}`}
          onClose={() => setViewingSaleBill(null)}
          size="wide"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-ink/60">
                  <th className="py-2">ลำดับ</th>
                  <th>สินค้า</th>
                  <th className="text-right">จำนวน</th>
                  <th className="text-right">ราคา/หน่วย</th>
                  <th className="text-right">รวม</th>
                </tr>
              </thead>
              <tbody>
                {(viewingSaleBill.saleLines ?? []).map((line) => (
                  <tr key={line.id ?? line.sequenceNo} className="border-b border-black/5">
                    <td className="py-3">{line.sequenceNo}</td>
                    <td className="font-semibold text-ink">{line.title}</td>
                    <td className="text-right">{line.quantity}</td>
                    <td className="text-right">{formatCurrency(line.unitPrice)}</td>
                    <td className="text-right font-semibold">{formatCurrency(line.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold text-ink">
                  <td colSpan={4} className="py-3 text-right">ยอดรวม</td>
                  <td className="text-right">{formatCurrency(viewingSaleBill.cost)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </ModalShell>
      )}

      {branchTransferModalOpen && (
        <>
          {branchTransferMode === "cash" ? (
            <CashBranchTransferCreateModal
              location={selectedLocation}
              online={isOnline}
              modeSelector={<BranchTransferModeSelector mode={branchTransferMode} bankAllowed={canCreateMoneyTransfer} onChange={setBranchTransferMode} />}
              onSave={cashTransfers.create.mutateAsync}
              onClose={() => setBranchTransferModalOpen(false)}
            />
          ) : (
            <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 sm:p-6">
              <div className="mt-4 w-full max-w-4xl">
                <BranchTransferForm
                  locationId={selectedLocation.id}
                  modeSelector={<BranchTransferModeSelector mode={branchTransferMode} bankAllowed={canCreateMoneyTransfer} onChange={setBranchTransferMode} />}
                  onSave={handleBranchTransferSave}
                  onCancel={() => setBranchTransferModalOpen(false)}
                />
              </div>
            </div>
          )}
        </>
      )}
      {cashReceiptId && (() => { const transfer = cashTransfers.transfers.find((item) => item.id === cashReceiptId); return transfer ? <CashBranchTransferReceiveModal transfer={transfer} online={isOnline} onReceive={(received) => cashTransfers.receive.mutateAsync({ id: transfer.id, received })} onClose={() => setCashReceiptId(null)} /> : null; })()}
      {cashEditingId && (() => { const transfer = cashTransfers.transfers.find((item) => item.id === cashEditingId); return transfer ? <CashBranchTransferCreateModal location={selectedLocation} transfer={transfer} online={isOnline} onSave={(payload) => cashTransfers.update.mutateAsync({ id: transfer.id, payload })} onClose={() => setCashEditingId(null)} /> : null; })()}
      {cashDetailsId && (() => { const transfer = cashTransfers.transfers.find((item) => item.id === cashDetailsId); return transfer ? <CashBranchTransferDetails transfer={transfer} canEdit={!transfer.reportLockNo && transfer.status === "pending_receipt" && (profile.role === "super_admin" || transfer.createdByUserId === profile.id)} online={isOnline} onEdit={() => { setCashDetailsId(null); setCashEditingId(transfer.id); }} onClose={() => setCashDetailsId(null)} /> : null; })()}
      <SharePdfWaitingModal open={pdfShare.waiting} onCancel={pdfShare.cancel} />

      {approvalModalOpen && (
        <IncomeExpenseApprovalModal
          initialLocationId={selectedLocation.id}
          onClose={() => setApprovalModalOpen(false)}
        />
      )}
    </section>
  );
}
