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

type RubberPriceAdjustmentResult<T extends RubberWeighCalculationInput> =
  | {
      ok: true;
      actualIncrease: number;
      weighItems: T[];
    }
  | {
      ok: false;
      reason: "invalid-target" | "invalid-base-price" | "no-priced-items" | "target-too-small" | "price-limit";
      weighItems: T[];
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
const HUNDRED_THOUSAND = BigInt(100_000);
export const MAX_RUBBER_PRICE_ADJUSTMENT_TARGET = 999_999_999_999.99;
const MAX_RUBBER_ITEM_PRICE_SCALED = 999_999_999_999_999;
export const MAX_RUBBER_ITEM_PRICE = MAX_RUBBER_ITEM_PRICE_SCALED / 100_000;

export function isValidRubberPriceAdjustmentTarget(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= MAX_RUBBER_PRICE_ADJUSTMENT_TARGET
    && Number(value.toFixed(2)) === value;
}

function toHundredths(value: number) {
  if (!Number.isFinite(value)) return ZERO;
  return BigInt(Math.round(value * 100));
}

function toHundredThousandths(value: number) {
  if (!Number.isFinite(value)) return ZERO;
  return BigInt(Math.round(value * 100_000));
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
 * - input weight and ordinary money precision: 0.01
 * - weigh-row price precision: 0.00001
 * - bill net weight: floor to 0.01
 * - weigh-row, stock-deduction, and rubber values: floor to whole baht
 * - average price and direct debt deductions: precision 0.01
 * - payable total: floor to whole baht
 */
export function calculateRubberBill(input: RubberBillCalculationInput): RubberBillCalculation {
  const weighItems = input.weighItems.map((item) => ({
    weight: toHundredths(item.netWeight),
    price: toHundredThousandths(item.price),
  }));
  const totalWeightUnits = weighItems.reduce((sum, item) => sum + item.weight, ZERO);
  const deductWeightUnits = toHundredths(input.deductWeight);
  const netWeightUnits = totalWeightUnits > deductWeightUnits
    ? totalWeightUnits - deductWeightUnits
    : ZERO;
  const lineTotalBaht = weighItems.map((item) =>
    (item.weight * item.price) / (HUNDRED * HUNDRED_THOUSAND)
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

export function calculateRubberPriceAdjustment<T extends RubberWeighCalculationInput>({
  weighItems,
  deductWeight,
  targetAmount,
}: {
  weighItems: T[];
  deductWeight: number;
  targetAmount: number;
}): RubberPriceAdjustmentResult<T> {
  const targetIsValid = isValidRubberPriceAdjustmentTarget(targetAmount) && targetAmount > 0;
  if (!targetIsValid) {
    return { ok: false, reason: "invalid-target", weighItems };
  }

  const hasInvalidBasePrice = weighItems.some((item) => (
    item.price < 0
    || item.price > MAX_RUBBER_ITEM_PRICE
    || !hasAtMostFiveDecimalPlaces(item.price)
  ));
  if (hasInvalidBasePrice) {
    return { ok: false, reason: "invalid-base-price", weighItems };
  }

  const basePriceScaled = weighItems.map((item) => Number(toHundredThousandths(item.price)));
  const pricedIndexes = basePriceScaled.flatMap((price, index) => price > 0 ? [index] : []);
  if (pricedIndexes.length === 0) {
    return { ok: false, reason: "no-priced-items", weighItems };
  }

  const maxIncreaseScaled = pricedIndexes.reduce(
    (current, index) => Math.min(current, MAX_RUBBER_ITEM_PRICE_SCALED - basePriceScaled[index]),
    Number.MAX_SAFE_INTEGER,
  );
  if (maxIncreaseScaled < 1) {
    return { ok: false, reason: "price-limit", weighItems };
  }

  const baseRubberValue = calculateRubberBill({ weighItems, deductWeight }).rubberValue;
  const targetCents = Math.round(targetAmount * 100);
  const calculateAt = (increaseScaled: number) => {
    const adjustedItems = weighItems.map((item, index) => ({
      ...item,
      price: basePriceScaled[index] > 0
        ? (basePriceScaled[index] + increaseScaled) / 100_000
        : 0,
    }));
    const actualIncrease = calculateRubberBill({
      weighItems: adjustedItems,
      deductWeight,
    }).rubberValue - baseRubberValue;
    return { adjustedItems, actualIncrease };
  };

  let low = 1;
  let high = maxIncreaseScaled;
  let bestIncreaseScaled = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const actualCents = Math.round(calculateAt(middle).actualIncrease * 100);
    if (actualCents <= targetCents) {
      bestIncreaseScaled = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (bestIncreaseScaled === 0) {
    return { ok: false, reason: "target-too-small", weighItems };
  }
  const best = calculateAt(bestIncreaseScaled);
  if (best.actualIncrease <= 0) {
    return { ok: false, reason: "target-too-small", weighItems };
  }

  low = 1;
  high = bestIncreaseScaled;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (calculateAt(middle).actualIncrease >= best.actualIncrease) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  const smallestEquivalent = calculateAt(low);

  return {
    ok: true,
    actualIncrease: smallestEquivalent.actualIncrease,
    weighItems: smallestEquivalent.adjustedItems,
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

export function hasAtMostFiveDecimalPlaces(value: number) {
  return Number.isFinite(value)
    && Number(value.toFixed(5)) === value;
}

export function prorateMoneyHalfUp(
  value: number,
  numeratorWeight: number,
  denominatorWeight: number,
) {
  if (
    !Number.isFinite(value)
    || !Number.isFinite(numeratorWeight)
    || !Number.isFinite(denominatorWeight)
    || value <= 0
    || numeratorWeight <= 0
    || denominatorWeight <= 0
  ) {
    return 0;
  }
  const valueCents = toHundredths(value);
  const numeratorUnits = toHundredths(numeratorWeight);
  const denominatorUnits = toHundredths(denominatorWeight);
  return fromScaled(
    divideHalfUp(valueCents * numeratorUnits, denominatorUnits),
    100,
  );
}

export function multiplyMoneyFloorBaht(left: number, right: number) {
  return Number(
    (toHundredths(left) * toHundredThousandths(right)) / (HUNDRED * HUNDRED_THOUSAND),
  );
}
