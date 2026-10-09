import { useRef, useState } from "react";

import { NumberField } from "@/components/shared/NumberField";
import {
  calculateRubberPriceAdjustment,
  MAX_RUBBER_PRICE_ADJUSTMENT_TARGET,
  type RubberBillCalculation,
} from "@/lib/rubber-bills/calculations";
import type { RubberBill } from "@/types";

type RubberWeighItem = NonNullable<RubberBill["weighItems"]>[number];

type AdjustmentSnapshot = {
  target: number;
  weighItems: RubberWeighItem[];
};

const adjustmentErrorMessage = {
  "invalid-target": "กรุณาระบุยอดมากกว่า 0 และทศนิยมไม่เกิน 2 ตำแหน่ง",
  "invalid-base-price": "กรุณาแก้ราคาสินค้าให้ถูกต้องก่อน",
  "no-priced-items": "ต้องกำหนดราคาสินค้าอย่างน้อย 1 รายการก่อน",
  "target-too-small": "ยอดน้อยเกินไปสำหรับการปรับราคา",
  "price-limit": "ไม่สามารถเพิ่มราคาได้อีกเนื่องจากถึงขอบเขตสูงสุด",
} as const;

export function RubberBillSummary({
  calculation,
  deductWeight,
  isPriceAdjustmentOpen,
  priceAdjustmentTarget,
  weighItems,
  onDeductWeightChange,
  onPriceAdjustmentOpenChange,
  onPriceAdjustmentApply,
}: {
  calculation: RubberBillCalculation;
  deductWeight: number;
  isPriceAdjustmentOpen: boolean;
  priceAdjustmentTarget: number;
  weighItems: RubberWeighItem[];
  onDeductWeightChange: (value: number) => void;
  onPriceAdjustmentOpenChange: (open: boolean) => void;
  onPriceAdjustmentApply: (items: RubberWeighItem[], target: number) => void;
}) {
  const [isWeightDeductManuallyOpen, setIsWeightDeductManuallyOpen] = useState(false);
  const [targetInput, setTargetInput] = useState(0);
  const [actualIncrease, setActualIncrease] = useState<number | null>(null);
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);
  const adjustmentSnapshotRef = useRef<AdjustmentSnapshot | null>(null);
  const isWeightDeductOpen = isWeightDeductManuallyOpen || deductWeight !== 0;
  const hasPositivePrice = weighItems.some((item) => item.price > 0);

  function openPriceAdjustment() {
    if (!hasPositivePrice) return;
    adjustmentSnapshotRef.current = {
      target: priceAdjustmentTarget,
      weighItems: weighItems.map((item) => ({ ...item })),
    };
    setTargetInput(0);
    setActualIncrease(null);
    setAdjustmentError(null);
    onPriceAdjustmentOpenChange(true);
  }

  function cancelPriceAdjustment() {
    const snapshot = adjustmentSnapshotRef.current;
    if (snapshot) onPriceAdjustmentApply(snapshot.weighItems, snapshot.target);
    setTargetInput(0);
    setActualIncrease(null);
    setAdjustmentError(null);
    onPriceAdjustmentOpenChange(false);
  }

  function updateTarget(value: number) {
    setTargetInput(value);
    const snapshot = adjustmentSnapshotRef.current;
    if (!snapshot) return;
    const result = calculateRubberPriceAdjustment({
      weighItems: snapshot.weighItems,
      deductWeight,
      targetAmount: value,
    });
    if (!result.ok) {
      onPriceAdjustmentApply(snapshot.weighItems, snapshot.target);
      setActualIncrease(null);
      setAdjustmentError(adjustmentErrorMessage[result.reason]);
      return;
    }
    onPriceAdjustmentApply(result.weighItems, value);
    setActualIncrease(result.actualIncrease);
    setAdjustmentError(null);
  }

  return (
    <section className="grid gap-3 p-3 sm:w-64 sm:p-4">
      <button
        type="button"
        aria-expanded={isWeightDeductOpen}
        aria-controls="rubber-weight-deduction-field"
        onClick={() => {
          if (isWeightDeductOpen) {
            onDeductWeightChange(0);
            setIsWeightDeductManuallyOpen(false);
            return;
          }
          setIsWeightDeductManuallyOpen(true);
        }}
        className="focus-ring h-11 w-fit rounded-md bg-clay px-3 text-sm font-semibold text-white hover:bg-clay/90"
      >
        {isWeightDeductOpen ? "ยกเลิกหักน้ำหนัก" : "หักน้ำหนักยาง"}
      </button>
      {isWeightDeductOpen && (
        <div id="rubber-weight-deduction-field">
          <NumberField
            label="หักน้ำหนักยาง (กก.)"
            value={deductWeight}
            onChange={onDeductWeightChange}
            autoFocus={deductWeight === 0}
          />
        </div>
      )}
      <NumberField label="น้ำหนักสุทธิ (กก.)" value={calculation.netWeight} readOnly />
      <NumberField label="ราคาเฉลี่ย (บาท/กก.)" value={calculation.averagePrice} readOnly />
      <button
        type="button"
        disabled={!hasPositivePrice}
        aria-expanded={isPriceAdjustmentOpen}
        aria-controls="rubber-price-adjustment-field"
        onClick={isPriceAdjustmentOpen ? cancelPriceAdjustment : openPriceAdjustment}
        className="focus-ring min-h-11 w-fit rounded-md bg-leaf px-3 py-2 text-sm font-semibold text-white hover:bg-leaf/90 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {isPriceAdjustmentOpen ? "ยกเลิกปรับราคา" : "ปรับราคาจากยอดเงิน"}
      </button>
      {isPriceAdjustmentOpen && (
        <div id="rubber-price-adjustment-field" className="grid gap-2">
          <NumberField
            label="ยอดที่ต้องการเพิ่ม (บาท)"
            value={targetInput}
            onChange={updateTarget}
            autoFocus={targetInput === 0}
            min={0.01}
            max={MAX_RUBBER_PRICE_ADJUSTMENT_TARGET}
            step={0.01}
            ariaDescribedBy="rubber-price-adjustment-feedback"
            ariaInvalid={Boolean(adjustmentError)}
          />
          <div id="rubber-price-adjustment-feedback" className="text-pretty text-sm">
            {adjustmentError ? (
              <p role="alert" className="text-clay">{adjustmentError}</p>
            ) : actualIncrease != null ? (
              <p role="status" className="tabular-nums text-ink/70">
                ยอดเพิ่มจริงหลังปัด: {actualIncrease.toLocaleString("th-TH", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })} บาท
              </p>
            ) : null}
          </div>
        </div>
      )}
      <NumberField label="มูลค่ายาง (บาท)" value={calculation.rubberValue} readOnly />
      <NumberField label="ยอดหักเงิน (บาท)" value={calculation.deductionTotal} readOnly />
      <NumberField label="ยอดที่ต้องจ่ายลูกค้า (บาท)" value={calculation.netTotal} readOnly />
    </section>
  );
}
