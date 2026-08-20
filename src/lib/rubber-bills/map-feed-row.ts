import type { RubberBill } from "@/types";
import { calculateRubberBill } from "@/lib/rubber-bills/calculations";

export function mapRubberBillFeedRow(row: any): RubberBill {
  const billItems = Array.isArray(row.items) ? row.items : [];
  const weighItems = billItems
    .filter((item: any) => item.item_type === "weigh")
    .map((item: any) => ({
      id: item.id,
      label: item.description ?? "ชั่ง",
      inWeight: Number(item.weight_in ?? 0),
      outWeight: Number(item.weight_out ?? 0),
      netWeight: Number(item.net_weight ?? 0),
      price: Number(item.price ?? 0),
      total: Number(item.total ?? 0),
    }));
  const acidItems = billItems
    .filter((item: any) => item.item_type === "acid" || item.item_type === "stock_deduction")
    .map((item: any) => ({
      id: item.id,
      name: item.description ?? "สินค้า",
      stockProductId: item.stock_product_id ?? "",
      quantity: Number(item.quantity ?? 0),
      unit: item.unit ?? "ชิ้น",
      unitPrice: Number(item.price ?? 0),
      total: Number(item.total ?? 0),
    }));
  const debtItems = billItems
    .filter((item: any) => item.item_type === "debt")
    .map((item: any) => ({
      id: item.id,
      title: item.description ?? "หักชำระหนี้",
      amount: Number(item.total ?? 0),
    }));
  const fallback = calculateRubberBill({
    weighItems,
    deductWeight: Number(row.deduct_weight ?? 0),
    stockDeductionItems: acidItems,
    debtItems,
  });

  return {
    id: row.id,
    clientTempId: row.client_temp_id ?? row.id,
    localBillNo: row.local_bill_no,
    serverBillNo: row.server_bill_no ?? undefined,
    syncStatus: "synced",
    idempotencyKey: row.idempotency_key ?? `server:${row.id}`,
    locationId: row.location_id,
    billNo: row.bill_no,
    billDate: row.bill_date,
    customerId: row.customer_id ?? null,
    customerName: row.customer_name ?? "",
    billType: row.bill_type === "weighing" ? "บิลเครื่องชั่งเล็ก" : row.bill_type,
    deductWeight: Number(row.deduct_weight ?? 0),
    weight: Number(row.weight ?? 0),
    netWeight: Number(row.net_weight ?? fallback.netWeight),
    weighValueTotal: Number(row.rubber_value ?? fallback.weighValueTotal),
    rubberValue: Number(row.net_rubber_value ?? fallback.rubberValue),
    price: Number(row.average_price ?? 0),
    deductionTotal: Number(row.deduction_total ?? 0),
    payableBeforeRounding: Number(row.payable_before_rounding ?? fallback.payableBeforeRounding),
    netTotal: Number(row.net_total ?? 0),
    acidPackCount: Number(row.acid_pack_count ?? 0),
    configuredPriceSnapshot: row.configured_price_snapshot == null
      ? null
      : Number(row.configured_price_snapshot),
    approvalState: row.approval_state === "approved" ? "approved" : "not_required",
    approvalApprovedByName: row.approved_by_name ?? null,
    approvalRevisionNo: row.approval_revision_no == null ? null : Number(row.approval_revision_no),
    approvalPending: row.approval_pending === true,
    approvalRequestId: row.approval_request_id ?? undefined,
    approvalOperation: row.approval_operation ?? undefined,
    approvalReasons: row.approval_reasons ?? undefined,
    weighItems,
    acidItems,
    debtItem: debtItems[0],
    debtItems,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdByPhone: row.created_by_phone,
    clientCreatedAt: row.client_created_at ?? row.created_at,
    serverCreatedAt: row.created_at,
    clientRecordedAt: row.client_recorded_at ?? row.created_at,
    serverReceivedAt: row.server_received_at ?? undefined,
    revisionNo: row.revision_no ?? 0,
    recordStatus: row.record_status,
    reportLockNo: row.report_lock_no ?? null,
    transferLockId: row.transfer_lock_id ?? null,
    operationalSortAt: row.operational_sort_at ?? row.created_at,
    sourceRubberExportId: row.source_rubber_export_id ?? null,
    sourceExportNo: row.source_export_no ?? null,
    receivedAt: row.received_at ?? null,
    receivedAgeHours: row.received_age_hours == null ? null : Number(row.received_age_hours),
    receivedAgeIsEstimated: row.received_age_is_estimated ?? null,
  };
}
