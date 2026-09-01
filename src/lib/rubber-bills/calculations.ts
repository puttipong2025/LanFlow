export type RubberWeighCalculationInput = {
  netWeight: number;
  price: number;
};

export type RubberStockDeductionCalculationInput = {
  quantity: number;
  unitPrice: number;
};

export type RubberDebtCalculationInput = {
  amount: number;
};

export type RubberBillCalculationInput = {
  weighItems: RubberWeighCalculationInput[];
  deductWeight: number;
  stockDeductionItems?: RubberStockDeductionCalculationInput[];
  debtItems?: RubberDebtCalculationInput[];
};

export type RubberBillCalculation = {
  totalWeight: number;
  netWeight: number;
  weighValueTotal: number;
  averagePrice: number;
  rubberValue: number;
  deductionTotal: number;
  payableBeforeRounding: number;
  netTotal: number;
  lineTotals: number[];
  stockDeductionLineTotals: number[];
};

type RubberBillCalculationSnapshotInput = {
  deductWeight: number;
  weighItems: Array<RubberWeighCalculationInput & { total?: number }>;
  acidItems?: Array<RubberStockDeductionCalculationInput & { total?: number }>;
  debtItems?: RubberDebtCalculationInput[];
  debtItem?: RubberDebtCalculationInput;
};

const ZERO = BigInt(0);
const TWO = BigInt(2);
const HUNDRED = BigInt(100);

function toHundredths(value: number) {
  if (!Number.isFinite(value)) return ZERO;
  return BigInt(Math.round(value * 100));
}

function fromScaled(value: bigint, scale: number) {
  return Number(value) / scale;
}

function divideHalfUp(numerator: bigint, denominator: bigint) {
  if (denominator <= ZERO || numerator <= ZERO) return ZERO;
  return ((numerator * TWO) + denominator) / (denominator * TWO);
}

/**
 * Calculates a rubber bill with integer sub-units so online and offline paths
 * do not depend on binary floating-point rounding.
 *
 * - input weight and money precision: 0.01
 * - bill net weight: floor to 0.01
 * - weigh-row, stock-deduction, and rubber values: floor to whole baht
 * - average price and direct debt deductions: precision 0.01
 * - payable total: floor to whole baht
 */
export function calculateRubberBill(input: RubberBillCalculationInput): RubberBillCalculation {
  const weighItems = input.weighItems.map((item) => ({
    weight: toHundredths(item.netWeight),
    price: toHundredths(item.price),
  }));
  const totalWeightUnits = weighItems.reduce((sum, item) => sum + item.weight, ZERO);
  const deductWeightUnits = toHundredths(input.deductWeight);
  const netWeightUnits = totalWeightUnits > deductWeightUnits
    ? totalWeightUnits - deductWeightUnits
    : ZERO;
  const lineTotalBaht = weighItems.map((item) =>
    (item.weight * item.price) / (HUNDRED * HUNDRED)
  );
  const weighValueBaht = lineTotalBaht.reduce((sum, value) => sum + value, ZERO);
  const weighValueUnits = weighValueBaht * HUNDRED * HUNDRED;
  const averagePriceCents = totalWeightUnits > ZERO
    ? divideHalfUp(weighValueUnits, totalWeightUnits)
    : ZERO;
  const rubberValueBaht = totalWeightUnits > ZERO
    ? (weighValueBaht * netWeightUnits) / totalWeightUnits
    : ZERO;

  const stockDeductionLineBaht = (input.stockDeductionItems ?? []).map(
    (item) => (
      toHundredths(item.quantity) * toHundredths(item.unitPrice)
    ) / (HUNDRED * HUNDRED),
  );
  const stockDeductionCents = stockDeductionLineBaht.reduce(
    (sum, value) => sum + (value * HUNDRED),
    ZERO,
  );
  const debtDeductionUnits = (input.debtItems ?? []).reduce(
    (sum, item) => sum + toHundredths(item.amount),
    ZERO,
  );
  const deductionTotalCents = stockDeductionCents + debtDeductionUnits;
  const rubberValueCents = rubberValueBaht * HUNDRED;
  const payableBeforeRoundingCents = rubberValueCents > deductionTotalCents
    ? rubberValueCents - deductionTotalCents
    : ZERO;
  const payableBaht = payableBeforeRoundingCents / HUNDRED;

  return {
    totalWeight: fromScaled(totalWeightUnits, 100),
    netWeight: fromScaled(netWeightUnits, 100),
    weighValueTotal: Number(weighValueBaht),
    averagePrice: fromScaled(averagePriceCents, 100),
    rubberValue: fromScaled(rubberValueCents, 100),
    deductionTotal: fromScaled(deductionTotalCents, 100),
    payableBeforeRounding: fromScaled(payableBeforeRoundingCents, 100),
    netTotal: Number(payableBaht),
    lineTotals: lineTotalBaht.map(Number),
    stockDeductionLineTotals: stockDeductionLineBaht.map(Number),
  };
}

export function applyRubberBillCalculation<T extends RubberBillCalculationSnapshotInput>(bill: T) {
  const calculation = calculateRubberBill({
    weighItems: bill.weighItems,
    deductWeight: bill.deductWeight,
    stockDeductionItems: bill.acidItems,
    debtItems: bill.debtItems ?? (bill.debtItem ? [bill.debtItem] : []),
  });

  return {
    ...bill,
    weight: calculation.totalWeight,
    netWeight: calculation.netWeight,
    weighValueTotal: calculation.weighValueTotal,
    rubberValue: calculation.rubberValue,
    price: calculation.averagePrice,
    deductionTotal: calculation.deductionTotal,
    payableBeforeRounding: calculation.payableBeforeRounding,
    netTotal: calculation.netTotal,
    weighItems: bill.weighItems.map((item, index) => ({
      ...item,
      total: calculation.lineTotals[index] ?? 0,
    })),
    acidItems: bill.acidItems?.map((item, index) => ({
      ...item,
      total: calculation.stockDeductionLineTotals[index] ?? 0,
    })),
  };
}

export function hasAtMostTwoDecimalPlaces(value: number) {
  return Number.isFinite(value)
    && Math.abs((value * 100) - Math.round(value * 100)) < 1e-8;
}

export function multiplyMoneyFloorBaht(left: number, right: number) {
  return Number(
    (toHundredths(left) * toHundredths(right)) / (HUNDRED * HUNDRED),
  );
}
