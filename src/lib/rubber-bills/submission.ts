import type { RubberBill } from "@/types";
import {
  applyRubberBillCalculation,
  multiplyMoneyFloorBaht,
} from "@/lib/rubber-bills/calculations";

export function buildRubberBillRpcPayload(
  bill: RubberBill,
  operation: "create" | "update" | "delete",
  configuredPriceSnapshot?: number | null,
  deletedByName?: string,
  deletedByPhone?: string,
) {
  const calculatedBill = applyRubberBillCalculation({
    ...bill,
    weighItems: bill.weighItems ?? [],
  });
  const items = [
    ...calculatedBill.weighItems.map((item, index) => ({
      itemType: "weigh",
      title: item.label,
      description: item.label,
      inWeight: item.inWeight,
      outWeight: item.outWeight,
      netWeight: item.netWeight,
      unitPrice: item.price,
      totalAmount: item.total ?? multiplyMoneyFloorBaht(item.netWeight, item.price),
      sequenceNo: index + 1,
    })),
    ...(calculatedBill.acidItems ?? []).map((item, index) => ({
      itemType: "stock_deduction",
      title: item.name,
      description: item.name,
      stockProductId: item.stockProductId,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      totalAmount: item.total ?? multiplyMoneyFloorBaht(item.quantity, item.unitPrice),
      sequenceNo: calculatedBill.weighItems.length + index + 1,
    })),
    ...(calculatedBill.debtItems ?? (calculatedBill.debtItem ? [calculatedBill.debtItem] : []))
      .map((item, index) => ({
        itemType: "debt",
        title: item.title,
        description: item.title,
        totalAmount: item.amount,
        sequenceNo: calculatedBill.weighItems.length + (calculatedBill.acidItems?.length ?? 0) + index + 1,
      })),
  ];

  return {
    calculatedBill,
    payload: {
      operation,
      formulaVersion: 2,
      expectedRevisionNo: calculatedBill.revisionNo,
      clientTempId: calculatedBill.clientTempId,
      idempotencyKey: `${operation}:${calculatedBill.clientTempId}:${calculatedBill.revisionNo}`,
      locationId: calculatedBill.locationId,
      recordStatus: operation === "delete" ? "deleted" : calculatedBill.recordStatus,
      localBillNo: calculatedBill.localBillNo,
      billDate: calculatedBill.billDate,
      customerId: calculatedBill.customerId ?? null,
      customerName: calculatedBill.customerName,
      configuredPriceSnapshot: operation === "create"
        ? configuredPriceSnapshot
        : calculatedBill.configuredPriceSnapshot ?? null,
      billType: calculatedBill.billType,
      deductWeight: calculatedBill.deductWeight,
      weight: calculatedBill.weight,
      netWeight: calculatedBill.netWeight,
      rubberValue: calculatedBill.weighValueTotal,
      netRubberValue: calculatedBill.rubberValue,
      averagePrice: calculatedBill.price,
      deductionTotal: calculatedBill.deductionTotal,
      payableBeforeRounding: calculatedBill.payableBeforeRounding,
      netTotal: calculatedBill.netTotal,
      acidPackCount: calculatedBill.acidPackCount,
      createdByUserId: calculatedBill.createdByUserId,
      createdByName: calculatedBill.createdByName,
      createdByPhone: calculatedBill.createdByPhone,
      clientRecordedAt: calculatedBill.clientRecordedAt || new Date().toISOString(),
      clientCreatedAt: calculatedBill.clientCreatedAt || new Date().toISOString(),
      ...(operation === "create" ? {
        inputMethod: calculatedBill.inputMethod ?? "manual",
        ...(calculatedBill.inputMethod === "ocr" && calculatedBill.ocrUploadId
          ? { ocrUploadId: calculatedBill.ocrUploadId }
          : {}),
      } : {}),
      deletedByName,
      deletedByPhone,
      items,
    },
  };
}
