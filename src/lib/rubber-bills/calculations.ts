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
 * - average price and monetary results: half-up to 0.01
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
  const weighValueUnits = weighItems.reduce(
    (sum, item) => sum + (item.weight * item.price),
    ZERO,
  );

  const lineTotalCents = weighItems.map((item) =>
    divideHalfUp(item.weight * item.price, HUNDRED)
  );
  const averagePriceCents = totalWeightUnits > ZERO
    ? divideHalfUp(weighValueUnits, totalWeightUnits)
    : ZERO;
  const rubberValueCents = totalWeightUnits > ZERO
    ? divideHalfUp(
        weighValueUnits * netWeightUnits,
        HUNDRED * totalWeightUnits,
      )
    : ZERO;

  const stockDeductionUnits = (input.stockDeductionItems ?? []).reduce(
    (sum, item) =>
      sum + (toHundredths(item.quantity) * toHundredths(item.unitPrice)),
    ZERO,
  );
  const debtDeductionUnits = (input.debtItems ?? []).reduce(
    (sum, item) => sum + (toHundredths(item.amount) * HUNDRED),
    ZERO,
  );
  const deductionTotalCents = divideHalfUp(
    stockDeductionUnits + debtDeductionUnits,
    HUNDRED,
  );
  const payableBeforeRoundingCents = rubberValueCents > deductionTotalCents
    ? rubberValueCents - deductionTotalCents
    : ZERO;
  const payableBaht = payableBeforeRoundingCents / HUNDRED;

  return {
    totalWeight: fromScaled(totalWeightUnits, 100),
    netWeight: fromScaled(netWeightUnits, 100),
    weighValueTotal: fromScaled(weighValueUnits, 10_000),
    averagePrice: fromScaled(averagePriceCents, 100),
    rubberValue: fromScaled(rubberValueCents, 100),
    deductionTotal: fromScaled(deductionTotalCents, 100),
    payableBeforeRounding: fromScaled(payableBeforeRoundingCents, 100),
    netTotal: Number(payableBaht),
    lineTotals: lineTotalCents.map((value) => fromScaled(value, 100)),
  };
}

export function hasAtMostTwoDecimalPlaces(value: number) {
  return Number.isFinite(value)
    && Math.abs((value * 100) - Math.round(value * 100)) < 1e-8;
}

export function multiplyMoneyHalfUp(left: number, right: number) {
  return fromScaled(
    divideHalfUp(toHundredths(left) * toHundredths(right), HUNDRED),
    100,
  );
}
