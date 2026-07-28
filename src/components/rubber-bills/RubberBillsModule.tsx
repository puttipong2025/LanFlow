import { Clock3, Plus, Settings, Ticket } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useRubberBills } from "@/hooks/useRubberBills";
import { useCustomers } from "@/hooks/useCustomers";
import { useMoneyTransfers } from "@/hooks/useMoneyTransfers";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePerRecordSyncRetry } from "@/hooks/usePerRecordSyncRetry";
import { useRubberBillApprovals } from "@/hooks/useRubberBillApprovals";
import { canManageSystemFeatures } from "@/lib/permissions";
import {
  getOfflineSyncedActionBlockReason,
  RUBBER_BILL_TRANSFER_LOCK_MESSAGE
} from "@/lib/record-action-locks";
import type { Location, Profile, RubberBill, RubberBillApprovalMarker } from "@/types";
import { RubberBillsTable } from "./RubberBillsTable";
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
  };
}

export function RubberBillsModule({
  selectedLocation,
  profile,
  initialSearch,
  onInitialSearchHandled
}: {
  selectedLocation: Location;
  profile: Profile;
  initialSearch?: string | null;
  onInitialSearchHandled?: () => void;
}) {
  const pdfShare = useSharePdf();
  const canManageApprovals = canManageSystemFeatures(profile);
  const {
    settings: approvalSettings,
    markers: approvalMarkers,
  } = useRubberBillApprovals({
    locationId: selectedLocation.id,
  });
  const pendingApprovalCount = approvalMarkers.length;
  const { bills, addBill, updateBill, deleteBill } = useRubberBills(
    selectedLocation.id,
    profile.id,
    approvalSettings
  );
  const { customers, isLoading: customersLoading, error: customersError } = useCustomers();
  const { transfers } = useMoneyTransfers(selectedLocation.id);
  const isOnline = useOnlineStatus();
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
  const [editingBill, setEditingBill] = useState<RubberBill | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!initialSearch) return;
    setSearch(initialSearch);
    setPage(1);
    onInitialSearchHandled?.();
  }, [initialSearch, onInitialSearchHandled]);

  useEffect(() => {
    if (customersLoading || customersError) return;
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
  }, [customers, customersError, customersLoading, deviceId]);

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
    const markedBills = bills.map((bill) => {
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
    return [...pendingCreates, ...markedBills];
  }, [approvalMarkers, bills]);

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
  const lockedRubberBillIds = useMemo(() => {
    const ids = new Set<string>();
    for (const transfer of transfers) {
      for (const item of transfer.items ?? []) {
        if (item.sourceType === "rubber_bill") ids.add(item.sourceId);
      }
    }
    return ids;
  }, [transfers]);

  function getActionBlockReason(bill: RubberBill) {
    return (bill.approvalPending ? "บิลนี้กำลังรออนุมัติการเปลี่ยนแปลง" : null)
      ?? (bill.reportLockNo ? `ล็อกโดยรายงาน ${bill.reportLockNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน` : null)
      ?? getOfflineSyncedActionBlockReason(bill, isOnline)
      ?? (lockedRubberBillIds.has(bill.id) ? RUBBER_BILL_TRANSFER_LOCK_MESSAGE : null);
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

  function confirmDelete(bill: RubberBill) {
    const blockReason = getActionBlockReason(bill);
    if (blockReason) {
      toast.error(blockReason);
      return;
    }
    if (confirm("ต้องการลบบิลนี้ใช่หรือไม่?")) {
      deleteBill({ id: bill.id, clientTempId: bill.clientTempId, deletedByName: profile.name, deletedByPhone: profile.phone, revisionNo: bill.revisionNo })
        .catch((err) => alert(err.message));
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
    setSearch(value);
    setPage(1);
  }

  function handlePageSize(value: string) {
    setPageSize(Number(value));
    setPage(1);
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-md border border-black/10 bg-white p-4 shadow-panel sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-ink">CRUD บิลยาง · {selectedLocation.name}</h2>
          <p className="text-sm text-ink/60">เพิ่ม แก้ไข ลบ และตรวจรายการบิลของสาขาที่เลือก</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
              onClick={() => setApprovalModalOpen(true)}
              aria-label={approvalButtonLabel}
              title={approvalButtonLabel}
              className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-settings px-3 text-sm font-semibold text-white hover:bg-settings/90"
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
            onClick={openAdd}
            className="focus-ring flex h-10 w-full items-center justify-center gap-2 rounded-md bg-leaf px-4 text-sm font-semibold text-white sm:w-auto"
          >
            <Plus size={18} />
            เพิ่มบิลยาง
          </button>
        </div>
      </div>

      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={pageSize}
              onChange={(event) => handlePageSize(event.target.value)}
              className="focus-ring h-10 rounded-md border border-black/20 bg-white px-3"
            >
              {[10, 25, 50].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
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
        <RubberBillsTable
          bills={filteredBills}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onEdit={openEdit}
          onDelete={confirmDelete}
          onPrint={handlePrint}
          getActionBlockReason={getActionBlockReason}
          getPrintBlockReason={getPrintBlockReason}
          onRetry={retryFailedSync}
          retryDisabled={!isOnline || isRetrying}
        />
      </section>

      {modalOpen && (
        <RubberBillModal
          selectedLocation={selectedLocation}
          profile={profile}
          bill={editingBill}
          configuredPrice={approvalSettings?.configuredPrice}
          customers={customerOptions}
          onClose={() => setModalOpen(false)}
          onSave={async (bill) => {
            try {
              const savedBill = await (editingBill ? updateBill(bill) : addBill(bill));
              setModalOpen(false);
              if (savedBill.netTotal > 0 && !savedBill.approvalPending) {
                await handlePrint(savedBill);
              }
            } catch (error) {
              alert(error instanceof Error ? error.message : "เกิดข้อผิดพลาดในการบันทึกบิล");
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
      <SharePdfWaitingModal open={pdfShare.waiting} onCancel={pdfShare.cancel} />
    </section>
  );
}
