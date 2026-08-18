import { Clock3, PackagePlus, Plus, Settings, Ticket } from "lucide-react";
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
import type { Location, Profile, RubberBill, RubberBillApprovalMarker } from "@/types";
import { RubberBillsTable } from "./RubberBillsTable";
import { TablePageSizeSelect } from "@/components/shared/TablePagination";
import { RubberBillModal, type RubberBillCustomerOption } from "./RubberBillModal";
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
import { getDeviceId } from "@/lib/format";
import { getRubberBillReceiptSnapshot } from "@/lib/idb-queue";
import {
  loadCustomerCache,
  saveCustomerCache,
  type WeighingQueueCustomer,
} from "@/lib/rubber-bills/weighing-queue";
import { calculateRubberBill } from "@/lib/rubber-bills/calculations";
import { runBlockingAction } from "@/lib/swal";
import {
  BranchRubberReceiptDetailModal,
  BranchRubberReceiptModal,
} from "./BranchRubberReceiptModal";

function pendingCreateBill(marker: RubberBillApprovalMarker): RubberBill | null {
  const payload = marker.proposedCreatePayload;
  if (!payload) return null;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const weighItems = items
    .filter((item: any) => item.itemType === "weigh")
    .map((item: any) => ({
      id: String(item.sequenceNo),
      label: item.title,
      inWeight: Number(item.inWeight),
      outWeight: Number(item.outWeight),
      netWeight: Number(item.netWeight),
      price: Number(item.unitPrice),
    }));
  const acidItems = items
    .filter((item: any) => item.itemType === "acid" || item.itemType === "stock_deduction")
    .map((item: any) => ({
      id: String(item.sequenceNo),
      name: item.title,
      stockProductId: item.stockProductId,
      quantity: Number(item.quantity),
      unit: item.unit,
      unitPrice: Number(item.unitPrice),
    }));
  const debtItems = items
    .filter((item: any) => item.itemType === "debt")
    .map((item: any) => ({
      id: String(item.sequenceNo),
      title: item.title,
      amount: Number(item.totalAmount),
    }));
  const calculation = calculateRubberBill({
    weighItems,
    deductWeight: Number(payload.deductWeight ?? 0),
    stockDeductionItems: acidItems,
    debtItems,
  });

  return {
    id: `approval:${marker.requestId}`,
    clientTempId: marker.clientTempId,
    localBillNo: String(payload.localBillNo ?? "รอเลขบิล"),
    syncStatus: "synced",
    idempotencyKey: String(payload.idempotencyKey ?? marker.requestId),
    locationId: String(payload.locationId),
    billNo: "รออนุมัติ",
    billDate: String(payload.billDate),
    customerId: payload.customerId ? String(payload.customerId) : null,
    customerName: String(payload.customerName ?? ""),
    billType: String(payload.billType ?? "บิลเครื่องชั่งเล็ก"),
    deductWeight: Number(payload.deductWeight ?? 0),
    weight: Number(payload.weight ?? 0),
    netWeight: Number(payload.netWeight ?? calculation.netWeight),
    weighValueTotal: Number(payload.rubberValue ?? calculation.weighValueTotal),
    rubberValue: Number(payload.netRubberValue ?? calculation.rubberValue),
    price: Number(payload.averagePrice ?? 0),
    deductionTotal: Number(payload.deductionTotal ?? 0),
    payableBeforeRounding: Number(
      payload.payableBeforeRounding ?? calculation.payableBeforeRounding
    ),
    netTotal: Number(payload.netTotal ?? 0),
    acidPackCount: Number(payload.acidPackCount ?? 0),
    configuredPriceSnapshot:
      payload.configuredPriceSnapshot == null
        ? null
        : Number(payload.configuredPriceSnapshot),
    approvalState: "not_required",
    approvalApprovedByName: null,
    approvalRevisionNo: null,
    weighItems,
    acidItems,
    debtItem: debtItems[0],
    debtItems,
    createdByUserId: String(payload.createdByUserId ?? ""),
    createdByName: String(payload.createdByName ?? ""),
    createdByPhone: String(payload.createdByPhone ?? ""),
    clientCreatedAt: String(payload.clientCreatedAt),
    clientRecordedAt: String(payload.clientRecordedAt),
    revisionNo: 0,
    recordStatus: "active",
    approvalPending: true,
    approvalRequestId: marker.requestId,
    approvalOperation: "create",
    approvalReasons: marker.matchedReasons,
    operationalSortAt: marker.requestedAt,
  };
}

export function RubberBillsModule({
  selectedLocation,
  profile,
  initialSearch,
  onInitialSearchHandled,
  onOpenEvidence,
}: {
  selectedLocation: Location;
  profile: Profile;
  initialSearch?: string | null;
  onInitialSearchHandled?: () => void;
  onOpenEvidence: (billId: string) => void;
}) {
  const queryClient = useQueryClient();
  const pdfShare = useSharePdf();
  const canManageApprovals = canManageSystemFeatures(profile);
  const {
    settings: approvalSettings,
    markers: approvalMarkers,
  } = useRubberBillApprovals({
    locationId: selectedLocation.id,
  });
  const { addBill, updateBill, deleteBill } = useRubberBillMutations(
    selectedLocation.id,
    profile.id,
    approvalSettings
  );
  const { customers, isLoading: customersLoading, error: customersError } = useCustomers();
  const isOnline = useOnlineStatus();
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
  const pendingApprovalCount = workCounts.data?.pendingApproval ?? approvalMarkers.length;
  const approvalButtonLabel = isOnline && pendingApprovalCount > 0
    ? `ตั้งค่าและอนุมัติบิลยาง รออนุมัติ ${pendingApprovalCount} รายการ`
    : "ตั้งค่าและอนุมัติบิลยาง";
  const { retrySyncEvent, isRetrying } = usePerRecordSyncRetry(selectedLocation.id, profile.id);
  const [deviceId] = useState(getDeviceId);
  const [cachedCustomers, setCachedCustomers] = useState<WeighingQueueCustomer[]>(() => (
    loadCustomerCache(deviceId)
  ));
  const [modalOpen, setModalOpen] = useState(false);
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

  const displayedBills = useMemo(() => {
    const markersByBillId = new Map(
      approvalMarkers
        .filter((marker) => marker.billId)
        .map((marker) => [marker.billId as string, marker])
    );
    const markedBills = list.bills.map((bill) => {
      const marker = markersByBillId.get(bill.id);
      if (!marker) return bill;
      return {
        ...bill,
        approvalPending: true,
        approvalRequestId: marker.requestId,
        approvalOperation: marker.operation,
        approvalReasons: marker.matchedReasons,
      };
    });
    const pendingCreates = approvalMarkers
      .filter((marker) => marker.operation === "create")
      .map(pendingCreateBill)
      .filter((bill): bill is RubberBill => bill !== null);
    const visibleCreates = (mode === "latest" || mode === "pending_approval")
      && (documentStatus === "any" || documentStatus === "editable")
      ? pendingCreates
      : [];
    const rows = [...visibleCreates, ...markedBills];
    if (mode !== "pending_approval") return rows;
    return rows.sort((a, b) => (
      (a.operationalSortAt ?? a.clientCreatedAt).localeCompare(b.operationalSortAt ?? b.clientCreatedAt)
      || a.id.localeCompare(b.id)
    ));
  }, [approvalMarkers, documentStatus, list.bills, mode]);

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
    setEditingBill(null);
    setModalOpen(true);
  }

  function openEdit(bill: RubberBill) {
    const blockReason = getActionBlockReason(bill);
    if (blockReason) {
      toast.error(blockReason);
      return;
    }
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
        || (approvalSettings && elapsedMinutes > approvalSettings.editWindowMinutes)
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

  return (
    <section className="space-y-4">
      <div className="flex flex-col items-start gap-3 rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div>
          <h2 className="text-balance text-lg font-bold text-ink">รายการบิลยาง · {selectedLocation.name}</h2>
          <p className="text-pretty text-sm text-ink/60">ค้นหาและจัดการบิลของสาขาที่เลือก</p>
        </div>
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
          retryDisabled={!isOnline || isRetrying}
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
          nonCurrentDateRequiresApproval={approvalSettings?.nonCurrentDateRequiresApproval}
          customers={customerOptions}
          onClose={() => setModalOpen(false)}
          onSave={async (bill) => {
            try {
              const isCreating = !editingBill;
              const savedBill = await (editingBill ? updateBill(bill) : addBill(bill));
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
    </section>
  );
}
