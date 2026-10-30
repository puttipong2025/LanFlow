import { calculateRubberBill } from "@/lib/rubber-bills/calculations";
import type { SyncEvent } from "@/lib/idb-queue";
import type { RubberBill } from "@/types";
import { isUnsubmittedRubberPreparationFailure } from "@/lib/rubber-bills/preparation-failure";

function pendingRubberMessage(event: SyncEvent & { centralAccepted?: boolean }) {
  if (event.errorMessage) return event.errorMessage;
  if (event.payload.centralQueue) return event.centralAccepted ? "เซิร์ฟเวอร์รับแล้ว รอประมวลผล"
    : event.serverSubmissionAttempted !== false ? "รอยืนยันการรับงานจากเซิร์ฟเวอร์" : "รอส่งจากเครื่อง";
  return event.operation === "delete" ? "กำลังส่งคำขอลบ" : event.operation === "create" ? "กำลังส่งบิลใหม่" : "กำลังส่งการแก้ไข";
}

export type RubberBillLocalMergeMode = "replace" | "suppress" | "server_authoritative";

export function scopeRubberBillLocalEventsToServerRows(
  serverBills: RubberBill[],
  events: SyncEvent[],
  includeLocalCreates: boolean,
) {
  const serverClientIds = new Set(serverBills.map((bill) => bill.clientTempId));
  return events.filter((event) => !event.payload.queueAction && (
    serverClientIds.has(event.id) || (includeLocalCreates && event.operation === "create")
  ));
}

function withAuthoritativeServerState(local: RubberBill, server: RubberBill): RubberBill {
  return {
    ...local,
    id: server.id,
    serverBillNo: server.serverBillNo,
    billNo: server.serverBillNo ?? server.billNo,
    approvalState: server.approvalState,
    approvalApprovedByName: server.approvalApprovedByName,
    approvalRevisionNo: server.approvalRevisionNo,
    approvalPending: server.approvalPending,
    approvalRequestId: server.approvalRequestId,
    approvalOperation: server.approvalOperation,
    approvalReasons: server.approvalReasons,
    approvalRequestedByName: server.approvalRequestedByName,
    approvalProposedSummary: server.approvalProposedSummary,
    reportLockNo: server.reportLockNo,
    transferLockId: server.transferLockId,
    sourceRubberExportId: server.sourceRubberExportId,
    sourceExportNo: server.sourceExportNo,
  };
}

function hasAuthoritativeActionLock(bill: RubberBill | undefined) {
  return Boolean(
    bill?.approvalPending
    || bill?.reportLockNo
    || bill?.transferLockId,
  );
}

export function rubberBillFromSyncEvent(event: SyncEvent & { centralAccepted?: boolean }, ownerUserId: string): RubberBill | null {
  if (event.payload.queueAction) return null;
  if (event.operation === "delete" && event.status === "pending" && !event.payload.background) return null;
  const payload = event.payload;
  const serverId = event.operation !== "create" && event.serverId ? event.serverId : undefined;
  const serverBillNo = event.operation !== "create" && event.serverBillNo
    ? event.serverBillNo
    : undefined;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const weighItems = items.filter((item: any) => item.itemType === "weigh").map((item: any) => ({
    id: String(item.sequenceNo), label: item.title, inWeight: Number(item.inWeight),
    outWeight: Number(item.outWeight), netWeight: Number(item.netWeight), price: Number(item.unitPrice),
    total: Number(item.totalAmount ?? 0),
  }));
  const acidItems = items.filter((item: any) => item.itemType === "acid" || item.itemType === "stock_deduction").map((item: any) => ({
    id: String(item.sequenceNo), name: item.title, stockProductId: item.stockProductId,
    quantity: Number(item.quantity), unit: item.unit, unitPrice: Number(item.unitPrice),
    total: Number(item.totalAmount ?? 0),
  }));
  const debtItems = items.filter((item: any) => item.itemType === "debt").map((item: any) => ({
    id: String(item.sequenceNo), title: item.title, amount: Number(item.totalAmount),
  }));
  const calculated = calculateRubberBill({
    weighItems,
    deductWeight: Number(payload.deductWeight ?? 0),
    stockDeductionItems: acidItems,
    debtItems,
  });
  return {
    id: serverId ?? payload.clientTempId,
    clientTempId: payload.clientTempId,
    localBillNo: payload.localBillNo,
    syncStatus: event.status === "conflict" ? "conflict" : event.status === "failed" ? "failed" : "pending",
    serverSubmissionAttempted: event.operation === "create" && payload.centralQueue === true
      ? event.centralAccepted === true ? true : event.serverSubmissionAttempted
      : (event.payload.background && event.status === "pending") || event.serverSubmissionAttempted === true,
    syncErrorMessage: event.status === "pending" && payload.background ? pendingRubberMessage(event) : event.errorMessage,
    canRestartDelete: event.operation === "delete" && (payload.contractVersion !== 2 || event.failureCode === "STALE_COMMAND_CONTEXT"),
    canCorrectSyncFailure: event.status === "failed" && event.failureHttpStatus === 400
      && event.operation !== "delete" && event.serverSubmissionAttempted !== true,
    canDiscardSyncFailure: event.payload.centralQueue !== true || isUnsubmittedRubberPreparationFailure(event),
    idempotencyKey: payload.idempotencyKey,
    locationId: payload.locationId,
    serverBillNo,
    billNo: serverBillNo ?? payload.localBillNo,
    billDate: payload.billDate,
    customerId: payload.customerId ?? null,
    customerName: payload.customerName ?? "",
    billType: payload.billType ?? "บิลเครื่องชั่งเล็ก",
    deductWeight: Number(payload.deductWeight ?? 0),
    weight: Number(payload.weight ?? 0),
    netWeight: Number(payload.netWeight ?? calculated.netWeight),
    weighValueTotal: Number(payload.rubberValue ?? calculated.weighValueTotal),
    rubberValue: Number(payload.netRubberValue ?? calculated.rubberValue),
    price: Number(payload.averagePrice ?? calculated.averagePrice),
    deductionTotal: Number(payload.deductionTotal ?? calculated.deductionTotal),
    payableBeforeRounding: Number(payload.payableBeforeRounding ?? calculated.payableBeforeRounding),
    netTotal: Number(payload.netTotal ?? calculated.netTotal),
    acidPackCount: Number(payload.acidPackCount ?? 0),
    configuredPriceSnapshot: payload.configuredPriceSnapshot ?? null,
    priceAdjustmentTarget: Number(payload.priceAdjustmentTarget ?? 0),
    approvalState: "not_required",
    approvalApprovedByName: null,
    approvalRevisionNo: null,
    approvalPending: false,
    weighItems,
    acidItems,
    debtItems,
    debtItem: debtItems[0],
    createdByUserId: payload.createdByUserId ?? ownerUserId,
    createdByName: payload.createdByName ?? "",
    createdByPhone: payload.createdByPhone ?? "",
    clientCreatedAt: payload.clientCreatedAt,
    serverCreatedAt: payload.clientCreatedAt,
    clientRecordedAt: payload.clientRecordedAt,
    revisionNo: Number(payload.expectedRevisionNo ?? 0) + 1,
    recordStatus: "active",
    inputMethod: payload.inputMethod === "ocr" ? "ocr" : "manual",
  };
}

export function mergeRubberBillLocalEvents(
  serverBills: RubberBill[],
  events: SyncEvent[],
  ownerUserId: string,
  mode: RubberBillLocalMergeMode = "replace",
) {
  const byClientId = new Map(serverBills.map((bill) => [bill.clientTempId, bill]));
  for (const event of events) {
    const serverBill = byClientId.get(event.id);
    if (event.payload.background && event.operation !== "create") {
      const draft = rubberBillFromSyncEvent(event, ownerUserId);
      if (serverBill) byClientId.set(event.id, { ...serverBill, syncStatus: draft!.syncStatus,
        approvalProposedSummary: event.operation === "update" && event.status === "pending"
          && !serverBill.approvalPending && serverBill.revisionNo === event.payload.expectedRevisionNo ? {
          customerName: draft!.customerName, billDate: draft!.billDate, billType: draft!.billType,
          netWeight: draft!.netWeight, averagePrice: draft!.price, netRubberValue: draft!.rubberValue,
          deductionTotal: draft!.deductionTotal, netTotal: draft!.netTotal,
        } : serverBill.approvalPending ? serverBill.approvalProposedSummary : undefined,
        syncErrorMessage: event.status === "pending" ? pendingRubberMessage(event) : event.errorMessage,
        serverSubmissionAttempted: event.status === "pending" || event.serverSubmissionAttempted,
        canCorrectSyncFailure: draft!.canCorrectSyncFailure, canRestartDelete: draft!.canRestartDelete,
        canDiscardSyncFailure: draft!.canDiscardSyncFailure });
      continue;
    }
    if (mode === "server_authoritative" && !serverBill) continue;
    if (event.operation === "delete") {
      if (event.status === "pending"
          && mode !== "server_authoritative"
          && !hasAuthoritativeActionLock(serverBill)) {
        byClientId.delete(event.id);
      }
      continue;
    }
    if (mode === "suppress") {
      byClientId.delete(event.id);
      continue;
    }
    const local = rubberBillFromSyncEvent(event, ownerUserId);
    if (local) {
      byClientId.set(event.id, serverBill
        ? withAuthoritativeServerState(local, serverBill)
        : local);
    }
  }
  return [...byClientId.values()].sort((a, b) =>
    b.clientRecordedAt.localeCompare(a.clientRecordedAt) || b.id.localeCompare(a.id));
}
