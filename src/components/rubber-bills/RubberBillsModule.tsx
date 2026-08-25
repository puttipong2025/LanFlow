import { Clock3, FileScan, PackagePlus, Plus, RefreshCw, Settings, Ticket } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useRubberBillMutations } from "@/hooks/useRubberBills";
import {
  useRubberBillList,
  useRubberBillWorkCounts,
  type RubberBillDocumentStatus,
  type RubberBillListMode,
} from "@/hooks/useRubberBillList";
import { useCustomers } from "@/hooks/useCustomers";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { bangkokDateString } from "@/lib/bangkok-date";
import { usePerRecordSyncRetry } from "@/hooks/usePerRecordSyncRetry";
import { useRubberBillApprovals } from "@/hooks/useRubberBillApprovals";
import { invalidateMoneyFlowLocation } from "@/lib/money-flow/invalidation";
import { canManageSystemFeatures } from "@/lib/permissions";
import {
  getOfflineSyncedActionBlockReason,
  RUBBER_BILL_TRANSFER_LOCK_MESSAGE
} from "@/lib/record-action-locks";
import type { Location, Profile, RubberBill } from "@/types";
import { RubberBillsTable } from "./RubberBillsTable";
import { TablePageSizeSelect } from "@/components/shared/TablePagination";
import { RubberBillModal, type RubberBillCustomerOption } from "./RubberBillModal";
import type { useRubberBillOcrQueue, RubberBillOcrInitialDraft, RubberBillOcrQueueItem } from "@/hooks/useRubberBillOcrQueue";
import { RubberBillApprovalModal } from "./RubberBillApprovalModal";
import { WeighingAppointmentModal } from "./WeighingAppointmentModal";
import { WeighingQueueModal } from "./WeighingQueueModal";
import {
  getRubberBillPrintBlockReason,
  resolveRubberBillReceiptForPrint,
  renderRubberBillReceiptHtml
} from "./bill-display";
import {
  receiptPdfFilename,
} from "@/lib/rubber-bills/print-receipt";
import { useSharePdf } from "@/hooks/useSharePdf";
import { SharePdfWaitingModal } from "@/components/shared/SharePdfWaitingModal";
import { ModalShell } from "@/components/shared/ModalShell";
import { getDeviceId } from "@/lib/format";
import { openRubberBillOcrSourceImage } from "@/lib/rubber-bills/open-ocr-source-image";
import { getRubberBillReceiptSnapshot } from "@/lib/idb-queue";
import {
  loadCustomerCache,
  saveCustomerCache,
  type WeighingQueueCustomer,
} from "@/lib/rubber-bills/weighing-queue";
import { runBlockingAction } from "@/lib/swal";
import { cn } from "@/lib/cn";
import {
  BranchRubberReceiptDetailModal,
  BranchRubberReceiptModal,
} from "./BranchRubberReceiptModal";
import { ExportVehicleWeighBillsModal } from "./ExportVehicleWeighBillsModal";

export function RubberBillsModule({
  selectedLocation,
  profile,
  initialSearch,
  onInitialSearchHandled,
  onOpenEvidence,
  ocrQueue,
}: {
  selectedLocation: Location;
  profile: Profile;
  initialSearch?: string | null;
  onInitialSearchHandled?: () => void;
  onOpenEvidence: (billId: string) => void;
  ocrQueue: ReturnType<typeof useRubberBillOcrQueue>;
}) {
  const queryClient = useQueryClient();
  const pdfShare = useSharePdf();
  const canManageApprovals = canManageSystemFeatures(profile);
  const { settings: approvalSettings } = useRubberBillApprovals({
    locationId: selectedLocation.id,
  });
  const { addBill, updateBill, deleteBill, discardSyncProblem } = useRubberBillMutations(
    selectedLocation.id,
    profile.id,
    approvalSettings
  );
  const { customers, isLoading: customersLoading, error: customersError } = useCustomers();
  const isOnline = useOnlineStatus();
  const [billsView, setBillsView] = useState<"purchase" | "wex">("purchase");
  const [mode, setMode] = useState<RubberBillListMode>("latest");
  const [documentStatus, setDocumentStatus] = useState<RubberBillDocumentStatus>("any");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const list = useRubberBillList({
    ownerUserId: profile.id,
    locationId: selectedLocation.id,
    mode,
    documentStatus,
    search: debouncedSearch,
  });
  const workCounts = useRubberBillWorkCounts(profile.id, selectedLocation.id);
  const pendingApprovalCount = workCounts.data?.pendingApproval ?? 0;
  const approvalButtonLabel = isOnline && pendingApprovalCount > 0
    ? `ตั้งค่าและอนุมัติบิลยาง รออนุมัติ ${pendingApprovalCount} รายการ`
    : "ตั้งค่าและอนุมัติบิลยาง";
  const { retrySyncEvent, isRetrying } = usePerRecordSyncRetry(selectedLocation.id, profile.id);
  const [deviceId] = useState(getDeviceId);
  const [cachedCustomers, setCachedCustomers] = useState<WeighingQueueCustomer[]>(() => (
    loadCustomerCache(deviceId)
  ));
  const [modalOpen, setModalOpen] = useState(false);
  const [ocrQueueModalOpen, setOcrQueueModalOpen] = useState(false);
  const [ocrReviewItem, setOcrReviewItem] = useState<RubberBillOcrQueueItem | null>(null);
  const ocrFileInputRef = useRef<HTMLInputElement>(null);
  const [queueModalOpen, setQueueModalOpen] = useState(false);
  const [appointmentModalOpen, setAppointmentModalOpen] = useState(false);
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [branchReceiptModalOpen, setBranchReceiptModalOpen] = useState(false);
  const [viewingBranchReceipt, setViewingBranchReceipt] = useState<RubberBill | null>(null);
  const [editingBill, setEditingBill] = useState<RubberBill | null>(null);
  const [deletingBillId, setDeletingBillId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pendingTargetPage, setPendingTargetPage] = useState<number | null>(null);
  const navigationInFlightRef = useRef(false);
  const navigationScopeRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    navigationScopeRef.current += 1;
    navigationInFlightRef.current = false;
    setPendingTargetPage(null);
    setPage(1);
  }, [profile.id, selectedLocation.id]);

  useEffect(() => {
    if (!initialSearch) return;
    setSearch(initialSearch);
    setPage(1);
    onInitialSearchHandled?.();
  }, [initialSearch, onInitialSearchHandled]);

  useEffect(() => {
    if (!isOnline || customersLoading || customersError) return;
    try {
      const snapshot = customers.map((customer) => ({
        id: customer.id,
        mainName: customer.mainName,
        legacyMemberId: customer.legacyMemberId ?? null,
        class: customer.class,
        farmAddress: customer.farms?.[0]?.address ?? null,
      }));
      saveCustomerCache(deviceId, snapshot);
      setCachedCustomers(snapshot);
    } catch {
      // Both forms still accept manually entered names when local storage is unavailable.
    }
  }, [customers, customersError, customersLoading, deviceId, isOnline]);

  const liveCustomerOptions: RubberBillCustomerOption[] = customers.map((customer) => ({
    id: customer.id,
    mainName: customer.mainName,
    legacyMemberId: customer.legacyMemberId ?? null,
    farmAddress: customer.farms?.[0]?.address ?? null,
  }));
  const cachedCustomerOptions: RubberBillCustomerOption[] = cachedCustomers.map((customer) => ({
    id: customer.id,
    mainName: customer.mainName,
    legacyMemberId: customer.legacyMemberId,
    farmAddress: customer.farmAddress ?? null,
  }));
  const customerOptions = !isOnline || customersLoading || customersError
    ? cachedCustomerOptions
    : liveCustomerOptions;

  const displayedBills = list.bills;

  const filteredBills = displayedBills.filter((bill: RubberBill) => {
    const haystack = [
      bill.billNo,
      bill.localBillNo,
      bill.serverBillNo,
      bill.billDate,
      bill.customerName,
      bill.billType,
      bill.createdByName,
      bill.createdByPhone
    ].join(" ");
    return haystack.toLowerCase().includes(search.toLowerCase());
  });
  function getActionBlockReason(bill: RubberBill) {
    return (bill.approvalPending ? "บิลนี้กำลังรออนุมัติการเปลี่ยนแปลง" : null)
      ?? (bill.reportLockNo ? `ล็อกโดยรายงาน ${bill.reportLockNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน` : null)
      ?? getOfflineSyncedActionBlockReason(bill, isOnline)
      ?? (bill.transferLockId ? RUBBER_BILL_TRANSFER_LOCK_MESSAGE : null);
  }

  function getPrintBlockReason(bill: RubberBill) {
    return pdfShare.busy ? "กำลังสร้าง PDF" : getRubberBillPrintBlockReason(bill);
  }

  async function handlePrint(bill: RubberBill) {
    const blockReason = getPrintBlockReason(bill);
    if (blockReason) {
      toast.error(blockReason);
      return;
    }

    try {
      const delivery = await pdfShare.sharePdf(async (signal) => {
        let snapshot = null;
        if (bill.syncStatus === "synced" && bill.serverBillNo) {
          snapshot = await getRubberBillReceiptSnapshot(bill.id);
        }
        if (signal.aborted) {
          const error = new Error("ยกเลิกการสร้าง PDF");
          error.name = "AbortError";
          throw error;
        }
        const receipt = resolveRubberBillReceiptForPrint(bill, snapshot, isOnline);
        return {
          html: renderRubberBillReceiptHtml(receipt),
          filename: receiptPdfFilename("LanFlow-rubber-bill", receipt.referenceNo),
        };
      });
      if (delivery === "shared") {
        toast.success("แชร์ PDF ใบรับซื้อยางแล้ว");
      } else if (delivery === "downloaded") {
        toast.success("แชร์บนอุปกรณ์นี้ไม่ได้ จึงดาวน์โหลด PDF แทน");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "สร้าง PDF ไม่สำเร็จ");
    }
  }

  function openAdd() {
    setOcrReviewItem(null);
    setEditingBill(null);
    setModalOpen(true);
  }

  function openOcrReview(item: RubberBillOcrQueueItem) {
    if (!item.uploadId || !item.draft) return;
    setOcrReviewItem(item);
    ocrQueue.setReviewing(item.id);
    setOcrQueueModalOpen(false);
    setEditingBill(null);
    setModalOpen(true);
  }

  function closeBillModal() {
    if (ocrReviewItem) ocrQueue.restoreReady(ocrReviewItem.id);
    setOcrReviewItem(null);
    setModalOpen(false);
  }

  function openEdit(bill: RubberBill) {
    const blockReason = getActionBlockReason(bill);
    if (blockReason) {
      toast.error(blockReason);
      return;
    }
    setOcrReviewItem(null);
    setEditingBill(bill);
    setModalOpen(true);
  }

  function openView(bill: RubberBill) {
    if (bill.sourceRubberExportId) {
      setViewingBranchReceipt(bill);
      return;
    }
    openEdit(bill);
  }

  async function confirmDelete(bill: RubberBill) {
    if (deletingBillId) return;
    const blockReason = getActionBlockReason(bill);
    if (blockReason) {
      toast.error(blockReason);
      return;
    }
    const dateApprovalNotice = approvalSettings?.nonCurrentDateRequiresApproval
      && bill.billDate !== bangkokDateString()
      ? "\nรายการต่างวันจะถูกส่งขออนุมัติก่อนลบ"
      : "";
    if (confirm(`ต้องการลบบิลนี้ใช่หรือไม่?${dateApprovalNotice}`)) {
      const elapsedMinutes = bill.serverCreatedAt
        ? (Date.now() - new Date(bill.serverCreatedAt).getTime()) / 60_000
        : 0;
      const likelyNeedsApproval = Boolean(
        (approvalSettings?.nonCurrentDateRequiresApproval && bill.billDate !== bangkokDateString())
        || (approvalSettings?.editWindowMinutes != null && elapsedMinutes > approvalSettings.editWindowMinutes)
      );
      setDeletingBillId(bill.id);
      try {
        await runBlockingAction(
          likelyNeedsApproval ? "กำลังส่งคำขอลบ..." : "กำลังลบรายการ...",
          () => deleteBill({
            bill,
            deletedByName: profile.name,
            deletedByPhone: profile.phone,
          }),
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "ลบบิลยางไม่สำเร็จ");
      } finally {
        setDeletingBillId(null);
      }
    }
  }

  async function retryFailedSync(bill: RubberBill) {
    try {
      await retrySyncEvent({ entity: "rubber_bills", id: bill.clientTempId });
      toast.success("ซิงก์รายการสำเร็จ");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ซิงก์รายการไม่สำเร็จ");
    }
  }

  async function openOcrSourceImage(bill: RubberBill) {
    try {
      await openRubberBillOcrSourceImage(bill.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "เปิดรูปต้นฉบับจาก OCR ไม่สำเร็จ");
    }
  }

  function handleSearch(value: string) {
    navigationScopeRef.current += 1;
    setSearch(value);
    setPendingTargetPage(null);
    setPage(1);
  }

  function handlePageSize(value: string) {
    navigationScopeRef.current += 1;
    setPageSize(Number(value));
    setPendingTargetPage(null);
    setPage(1);
  }

  async function handlePageChange(nextPage: number) {
    if (navigationInFlightRef.current || pendingTargetPage !== null || list.isFetchingNextPage) return;
    const needsMore = (nextPage - 1) * pageSize >= filteredBills.length;
    if (needsMore) {
      if (!list.hasMore) return;
      const requestScope = navigationScopeRef.current;
      navigationInFlightRef.current = true;
      setPendingTargetPage(nextPage);
      try {
        const result = await list.fetchNextPage();
        if (result.isError || requestScope !== navigationScopeRef.current) return;
      } finally {
        navigationInFlightRef.current = false;
        setPendingTargetPage(null);
      }
    }
    setPage(nextPage);
  }

  function selectMode(nextMode: RubberBillListMode) {
    navigationScopeRef.current += 1;
    setMode(nextMode);
    setDocumentStatus("any");
    setPendingTargetPage(null);
    setPage(1);
  }

  function selectDocumentStatus(nextStatus: RubberBillDocumentStatus) {
    navigationScopeRef.current += 1;
    setDocumentStatus(nextStatus);
    setMode("latest");
    setPendingTargetPage(null);
    setPage(1);
  }

  async function confirmDiscardSyncProblem(bill: RubberBill) {
    if (deletingBillId || !isOnline) return;
    const reference = bill.serverBillNo ?? bill.localBillNo;
    const confirmed = window.confirm(
      `ทิ้งรายการค้าง ${reference} ในเครื่องนี้ใช่ไหม?\n`
      + "การแก้ไขที่ยังไม่ซิงก์จะหาย และระบบจะโหลดข้อมูลล่าสุดจากเซิร์ฟเวอร์",
    );
    if (!confirmed) return;

    setDeletingBillId(bill.id);
    try {
      await runBlockingAction(
        "กำลังทิ้งรายการค้าง...",
        () => discardSyncProblem(bill.clientTempId),
      );
      setPage(1);
      toast.success("ทิ้งรายการค้างแล้ว และโหลดข้อมูลล่าสุดจากเซิร์ฟเวอร์แล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ทิ้งรายการค้างไม่สำเร็จ");
    } finally {
      setDeletingBillId(null);
    }
  }

  function selectBillsView(nextView: "purchase" | "wex") {
    setBillsView(nextView);
  }

  function moveBillsViewFocus(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextView = event.key === "Home" || event.key === "ArrowLeft"
      ? "purchase"
      : "wex";
    selectBillsView(nextView);
    window.requestAnimationFrame(() => document.getElementById(`rubber-bills-${nextView}-tab`)?.focus());
  }

  return (
    <section className="space-y-4">
      <div role="tablist" aria-label="ประเภทเอกสารในโมดูลบิลยาง" className="flex flex-wrap gap-2 rounded-md border border-black/10 bg-white p-2 shadow-panel">
        {([
          ["purchase", "บิลรับซื้อยาง"],
          ["wex", "บิลรถส่งออก (WEX)"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            id={`rubber-bills-${value}-tab`}
            type="button"
            role="tab"
            aria-selected={billsView === value}
            aria-controls={`rubber-bills-${value}-panel`}
            onClick={() => selectBillsView(value)}
            onKeyDown={moveBillsViewFocus}
            className={cn(
              "focus-ring rounded-md px-4 py-2 text-sm font-semibold",
              billsView === value ? "bg-leaf text-white" : "bg-field text-ink hover:bg-mint/60",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {billsView === "wex" ? (
        <div id="rubber-bills-wex-panel" role="tabpanel" aria-labelledby="rubber-bills-wex-tab">
          <ExportVehicleWeighBillsModal selectedLocation={selectedLocation} online={isOnline} />
        </div>
      ) : (
        <div id="rubber-bills-purchase-panel" role="tabpanel" aria-labelledby="rubber-bills-purchase-tab" className="space-y-4">
      <div className="flex flex-col items-start gap-3 rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div>
          <h2 className="text-balance text-lg font-bold text-ink">รายการบิลยาง · {selectedLocation.name}</h2>
          <p className="text-pretty text-sm text-ink/60">ค้นหาและจัดการบิลของสาขาที่เลือก</p>
        </div>
        <input
          ref={ocrFileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          multiple
          className="sr-only"
          onChange={(event) => {
            const files = event.currentTarget.files;
            if (!files) return;
            const result = ocrQueue.addFiles(selectedLocation.id, files);
            event.currentTarget.value = "";
            if (result.rejected > 0) toast.error("รองรับเฉพาะรูป JPEG หรือ PNG");
            if (result.accepted > 0) setOcrQueueModalOpen(true);
          }}
        />
        <button
          type="button"
          disabled={!isOnline}
          title={isOnline ? "อ่านรูปใบชั่งเพื่อเพิ่มเป็นบิลยาง" : "อ่านใบชั่งใช้ได้เมื่อออนไลน์เท่านั้น"}
          onClick={() => ocrFileInputRef.current?.click()}
          className="focus-ring relative flex h-10 items-center justify-center gap-2 rounded-md bg-river px-3 text-sm font-semibold text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <FileScan size={18} aria-hidden="true" />
          อ่านใบชั่ง (OCR)
          {((ocrQueue.countByLocation[selectedLocation.id] ?? 0) > 0) && (
            <span aria-label={`มี ${ocrQueue.countByLocation[selectedLocation.id]} รายการในคิว`} className="min-w-5 rounded-full bg-amber px-1.5 py-0.5 text-center text-[10px] font-extrabold leading-none text-white tabular-nums">
              {ocrQueue.countByLocation[selectedLocation.id] > 99 ? "99+" : ocrQueue.countByLocation[selectedLocation.id]}
            </span>
          )}
        </button>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
           <button
            type="button"
            onClick={() => setQueueModalOpen(true)}
            className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-river px-3 text-sm font-semibold text-white hover:bg-river/90"
          >
            <Ticket size={18} />
            บัตรคิว
          </button>
          <button
            type="button"
            onClick={() => setAppointmentModalOpen(true)}
            className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-yellow-700 px-3 text-sm font-semibold text-white shadow-sm hover:bg-yellow-800"
          >
            <Clock3 size={17} />
            จับเวลา
          </button>
          {canManageApprovals && (
            <button
              type="button"
              onClick={() => {
                if (!isOnline) {
                  toast.error("ตั้งค่าและอนุมัติบิลยางใช้ได้เมื่อออนไลน์เท่านั้น");
                  return;
                }
                setApprovalModalOpen(true);
              }}
              disabled={!isOnline}
              aria-label={approvalButtonLabel}
              title={isOnline ? approvalButtonLabel : "ตั้งค่าและอนุมัติบิลยางใช้ได้เมื่อออนไลน์เท่านั้น"}
              className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-settings px-3 text-sm font-semibold text-white hover:bg-settings/90 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Settings size={18} />
              ตั้งค่าและอนุมัติบิลยาง
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
          <button
            type="button"
            onClick={() => setBranchReceiptModalOpen(true)}
            disabled={!isOnline}
            title={isOnline ? "เลือกรายการส่งออกยางจากต่างสาขาหรือสาขาปัจจุบัน" : "รับยางจากสาขาใช้ได้เมื่อออนไลน์เท่านั้น"}
            className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-river px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <PackagePlus size={18} />
            รับยางจากสาขา
          </button>
          <button
            type="button"
            onClick={openAdd}
            className="focus-ring flex h-10 w-full items-center justify-center gap-2 rounded-md bg-leaf px-4 text-sm font-semibold text-white sm:w-auto"
          >
            <Plus size={18} />
            เพิ่มบิลยาง
          </button>
          {(ocrQueue.countByLocation[selectedLocation.id] ?? 0) > 0 && (
            <button type="button" onClick={() => setOcrQueueModalOpen(true)} className="focus-ring h-10 rounded-md border border-river/30 bg-white px-3 text-sm font-semibold text-river hover:bg-river/5">
              ดูคิว OCR
            </button>
          )}
        </div>
      </div>

      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div className="mb-4 space-y-3">
          <div className="flex flex-wrap gap-2" aria-label="ตัวกรองงานบิลยาง">
            {([
              ["latest", "รายการล่าสุด", 0],
              ["unpriced", "ยังไม่กำหนดราคา", workCounts.data?.unpriced ?? 0],
              ...(canManageApprovals
                ? [["pending_approval", "รออนุมัติ", pendingApprovalCount] as const]
                : []),
              ["sync_problem", "ซิงก์มีปัญหา", workCounts.data?.syncProblem ?? 0],
            ] as const).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => selectMode(value)}
                className={mode === value
                  ? "focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-leaf px-3 text-sm font-semibold text-white"
                  : "focus-ring inline-flex h-10 items-center gap-2 rounded-md border border-black/15 bg-white px-3 text-sm font-semibold text-ink hover:bg-field"}
              >
                {label}
                {value !== "latest" && count > 0 && (
                  <span className="min-w-5 rounded-full bg-amber px-1.5 py-0.5 text-center text-[10px] font-extrabold leading-none text-white tabular-nums">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
            <TablePageSizeSelect
              pageSize={pageSize}
              onPageSizeChange={(size) => handlePageSize(String(size))}
            />
              <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                สถานะเอกสาร
                <select
                  value={documentStatus}
                  onChange={(event) => selectDocumentStatus(event.target.value as RubberBillDocumentStatus)}
                  className="focus-ring h-10 rounded-md border border-black/20 bg-white px-3"
                >
                  <option value="any">ไม่จำกัดสถานะ (ในข้อมูลที่โหลด)</option>
                  <option value="editable">แก้ไขได้</option>
                  <option value="report_locked">ล็อกโดยรายงาน</option>
                  <option value="in_transfer">อยู่ในรายการโอนเงิน</option>
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              ค้นหา:
              <input
                value={search}
                onChange={(event) => handleSearch(event.target.value)}
                className="focus-ring h-10 w-full rounded-md border border-black/20 bg-white px-3 sm:w-64"
              />
            </label>
          </div>
        </div>
        {list.error && (
          <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-danger">
            {list.error instanceof Error ? list.error.message : "โหลดรายการบิลยางไม่สำเร็จ"}
          </p>
        )}
        {!isOnline && (
          <p role="status" className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            ออฟไลน์: แสดงและค้นหาเฉพาะบิลล่าสุดที่เก็บไว้บนเครื่องกับรายการที่รอซิงก์
          </p>
        )}
        {list.isLoading && (
          <p role="status" className="mb-3 text-sm text-ink/60">กำลังโหลดรายการบิลยาง...</p>
        )}
        <RubberBillsTable
          bills={filteredBills}
          page={page}
          pageSize={pageSize}
          onPageChange={handlePageChange}
          onView={openView}
          onEvidence={(bill) => onOpenEvidence(bill.id)}
          onEdit={openEdit}
          onDelete={confirmDelete}
          deletingBillId={deletingBillId}
          onPrint={handlePrint}
          getActionBlockReason={getActionBlockReason}
          getPrintBlockReason={getPrintBlockReason}
          onRetry={retryFailedSync}
          onDiscardLocal={(bill) => void confirmDiscardSyncProblem(bill)}
          onOpenOcrSourceImage={(bill) => void openOcrSourceImage(bill)}
          retryDisabled={!isOnline || isRetrying}
          discardDisabled={!isOnline}
          evidenceOnline={isOnline}
          evidenceStatesByBillId={list.evidenceStatesByBillId}
          hasMore={list.hasMore}
          isLoadingMore={list.isFetchingNextPage || pendingTargetPage !== null}
        />
      </section>

      {modalOpen && (
        <RubberBillModal
          selectedLocation={selectedLocation}
          profile={profile}
          bill={editingBill}
          configuredPrice={approvalSettings?.configuredPrice}
          priceTimeExempt={approvalSettings?.priceTimeExempt}
          nonCurrentDateRequiresApproval={approvalSettings?.nonCurrentDateRequiresApproval}
          customers={customerOptions}
          initialOcrDraft={ocrReviewItem ? {
            uploadId: ocrReviewItem.uploadId!,
            ...ocrReviewItem.draft!,
          } satisfies RubberBillOcrInitialDraft : null}
          onClose={closeBillModal}
          onSave={async (bill) => {
            try {
              const isCreating = !editingBill;
              const savedBill = await (editingBill ? updateBill(bill) : addBill(bill));
              if (ocrReviewItem) ocrQueue.remove(ocrReviewItem.id);
              setOcrReviewItem(null);
              setModalOpen(false);
              if (isCreating) setPage(1);
              if (savedBill.netTotal > 0 && !savedBill.approvalPending) {
                void handlePrint(savedBill);
              }
              return true;
            } catch (error) {
              alert(error instanceof Error ? error.message : "เกิดข้อผิดพลาดในการบันทึกบิล");
              return false;
            }
          }}
        />
      )}

      {ocrQueueModalOpen && (
        <OcrQueueModal
          locationId={selectedLocation.id}
          items={ocrQueue.items.filter((item) => item.locationId === selectedLocation.id)}
          online={isOnline}
          onClose={() => setOcrQueueModalOpen(false)}
          onRetry={(id) => void ocrQueue.retry(id)}
          onReview={openOcrReview}
          onRemove={ocrQueue.remove}
        />
      )}

      {appointmentModalOpen && (
        <WeighingAppointmentModal onClose={() => setAppointmentModalOpen(false)} />
      )}

      {queueModalOpen && (
        <WeighingQueueModal
          deviceId={deviceId}
          locationId={selectedLocation.id}
          locationName={selectedLocation.name}
          liveCustomers={isOnline && !customersError ? liveCustomerOptions : []}
          liveCustomersLoaded={isOnline && !customersLoading && !customersError}
          onClose={() => setQueueModalOpen(false)}
        />
      )}

      {approvalModalOpen && (
        <RubberBillApprovalModal
          locationId={selectedLocation.id}
          profile={profile}
          onClose={() => setApprovalModalOpen(false)}
        />
      )}
      {branchReceiptModalOpen && (
        <BranchRubberReceiptModal
          destinationLocationId={selectedLocation.id}
          destinationLocationName={selectedLocation.name}
          onClose={() => setBranchReceiptModalOpen(false)}
          onReceived={async (result) => {
            setBranchReceiptModalOpen(false);
            setPage(1);
            await invalidateMoneyFlowLocation(queryClient, {
              ownerUserId: profile.id,
              locationId: selectedLocation.id,
            });
            toast.success(`รับยางเข้าสาขาแล้ว · บิล ${result.billNo}`);
          }}
        />
      )}
      {viewingBranchReceipt && (
        <BranchRubberReceiptDetailModal
          bill={viewingBranchReceipt}
          onClose={() => setViewingBranchReceipt(null)}
        />
      )}
      <SharePdfWaitingModal open={pdfShare.waiting} onCancel={pdfShare.cancel} />
        </div>
      )}
    </section>
  );
}

function OcrQueueModal({
  locationId,
  items,
  online,
  onClose,
  onRetry,
  onReview,
  onRemove,
}: {
  locationId: string;
  items: RubberBillOcrQueueItem[];
  online: boolean;
  onClose: () => void;
  onRetry: (id: string) => void;
  onReview: (item: RubberBillOcrQueueItem) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <ModalShell title="คิวอ่านใบชั่ง" subtitle="1 รูปต่อ 1 บิลยาง · คิวนี้หายเมื่อปิดหรือรีโหลดหน้า" onClose={onClose} closeOnEscape nativeModal>
        <ul className="divide-y divide-black/10" aria-label={`รายการ OCR สาขา ${locationId}`}>
          {items.map((item) => (
            <li key={item.id} className="flex gap-3 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.previewUrl} alt={`ตัวอย่างรูปใบชั่ง ${item.file.name}`} className="size-16 rounded border border-black/10 object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">{item.file.name}</p>
                <p role="status" className="text-sm text-ink/60">
                  {item.status === "pending" ? "รอประมวลผล" : item.status === "processing" ? "กำลังอ่านข้อมูล" : item.status === "ready" ? "พร้อมตรวจและเพิ่มบิล" : item.status === "reviewing" ? "กำลังตรวจข้อมูลบิล" : item.errorMessage || "อ่านใบชั่งไม่สำเร็จ"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {item.status === "ready" && <button type="button" onClick={() => onReview(item)} className="focus-ring h-10 rounded-md bg-commit px-3 text-sm font-semibold text-white hover:bg-commit/90">ตรวจและเพิ่มบิล</button>}
                {item.status === "error" && <button type="button" disabled={!online} title={!online ? "ลองใหม่ได้เมื่อออนไลน์" : "ลองอ่านรูปอีกครั้ง"} onClick={() => onRetry(item.id)} className="focus-ring inline-flex size-10 items-center justify-center rounded-md bg-river text-white disabled:cursor-not-allowed disabled:bg-slate-300" aria-label="ลองอ่านใบชั่งอีกครั้ง"><RefreshCw size={17} aria-hidden="true" /></button>}
                {item.status !== "processing" && <button type="button" onClick={() => onRemove(item.id)} className="focus-ring h-10 rounded-md border border-black/15 px-3 text-sm font-semibold text-ink hover:bg-field">เอาออก</button>}
              </div>
            </li>
          ))}
          {items.length === 0 && <li className="p-8 text-center text-sm text-ink/60">ไม่มีรายการในคิว</li>}
        </ul>
    </ModalShell>
  );
}
