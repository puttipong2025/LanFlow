import { Plus, Settings } from "lucide-react";
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
import { RubberBillModal } from "./RubberBillModal";
import { RubberBillApprovalModal } from "./RubberBillApprovalModal";
import {
  buildRubberBillReceiptModel,
  getRubberBillPrintBlockReason,
  renderRubberBillReceiptHtml,
  resolveReceiptCustomer
} from "./bill-display";
import { printReceiptHtml } from "@/lib/rubber-bills/print-receipt";

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
    customerType: payload.customerType === "สาขาใหญ่จ่าย" ? "สาขาใหญ่จ่าย" : "สาขานี้จ่าย",
    billType: String(payload.billType ?? "บิลเครื่องชั่งเล็ก"),
    deductWeight: Number(payload.deductWeight ?? 0),
    weight: Number(payload.weight ?? 0),
    price: Number(payload.averagePrice ?? 0),
    deductionTotal: Number(payload.deductionTotal ?? 0),
    netTotal: Number(payload.netTotal ?? 0),
    cashPayment: Number(payload.cashPayment ?? 0),
    transferPayment: Number(payload.transferPayment ?? 0),
    acidPackCount: Number(payload.acidPackCount ?? 0),
    printStatus: "ยังไม่ได้ปริ้น",
    weighItems,
    acidItems,
    debtItem: debtItems[0],
    debtItems,
    createdByUserId: "",
    createdByName: "",
    createdByPhone: "",
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
  const canManageApprovals = canManageSystemFeatures(profile);
  const {
    settings: approvalSettings,
    markers: approvalMarkers,
    pendingCount,
  } = useRubberBillApprovals({
    locationId: selectedLocation.id,
    includeRequests: canManageApprovals,
  });
  const { bills, addBill, updateBill, deleteBill, markPrinted, isMarkingPrinted } = useRubberBills(
    selectedLocation.id,
    profile.id,
    approvalSettings?.configuredPrice
  );
  const { customers, addCustomer, updateCustomer } = useCustomers();
  const { transfers } = useMoneyTransfers(selectedLocation.id);
  const isOnline = useOnlineStatus();
  const { retrySyncEvent, isRetrying } = usePerRecordSyncRetry(selectedLocation.id, profile.id);
  const [modalOpen, setModalOpen] = useState(false);
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
      bill.customerType,
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
    return getRubberBillPrintBlockReason(bill, isOnline, isMarkingPrinted);
  }

  async function handlePrint(bill: RubberBill) {
    const blockReason = getPrintBlockReason(bill);
    if (blockReason) {
      toast.error(blockReason);
      return;
    }

    try {
      const customer = resolveReceiptCustomer(bill, customers);
      const html = renderRubberBillReceiptHtml(buildRubberBillReceiptModel(bill, customer));
      await printReceiptHtml(html);
      if (!window.confirm("เครื่องพิมพ์ออกกระดาษเรียบร้อยแล้วใช่หรือไม่?")) {
        toast.info("ยังไม่ได้เปลี่ยนสถานะการพิมพ์");
        return;
      }
      await markPrinted(bill.id);
      toast.success("บันทึกสถานะปริ้นแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "พิมพ์บิลไม่สำเร็จ");
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
          {canManageApprovals && (
            <button
              type="button"
              onClick={() => setApprovalModalOpen(true)}
              className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-amber px-4 font-semibold text-ink"
            >
              <Settings size={18} />
              ตั้งค่าและอนุมัติบิลยาง
              {pendingCount > 0 && (
                <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs text-white">{pendingCount}</span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={openAdd}
            className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-leaf px-4 font-semibold text-white"
          >
            <Plus size={18} />
            เพิ่มบิลยาง
          </button>
        </div>
      </div>

      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="rounded-md bg-amber px-4 py-2 text-sm font-bold text-ink">
              จับเวลา เท็กรับน้ำ
            </button>
            <button type="button" onClick={openAdd} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white">
              เพิ่มข้อมูล
            </button>
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
          customers={customers}
          onClose={() => setModalOpen(false)}
          onSave={(bill) => {
            const promise = editingBill ? updateBill(bill) : addBill(bill);
            promise
              .then(() => setModalOpen(false))
              .catch((err: any) => alert(err.message || "เกิดข้อผิดพลาดในการบันทึกบิล"));
          }}
          onAddCustomer={addCustomer.mutate}
          onUpdateCustomer={updateCustomer.mutate}
        />
      )}

      {approvalModalOpen && (
        <RubberBillApprovalModal
          locationId={selectedLocation.id}
          onClose={() => setApprovalModalOpen(false)}
        />
      )}
    </section>
  );
}
