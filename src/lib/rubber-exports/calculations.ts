function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function hasTwoDecimalPrecision(value: number) {
  return Number.isFinite(value) && Number(value.toFixed(2)) === value;
}

function toCents(value: number) {
  if (!hasTwoDecimalPrecision(value)) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? BigInt(cents) : null;
}

export function calculateWeightLossPercent(originalWeight: number, currentWeight: number) {
  if (!Number.isFinite(originalWeight) || !Number.isFinite(currentWeight)) return null;
  if (originalWeight <= 0 || currentWeight <= 0 || currentWeight > originalWeight) return null;
  const originalCents = toCents(originalWeight), currentCents = toCents(currentWeight);
  if (originalCents === null || currentCents === null) return null;
  // Match PostgreSQL numeric half-up rounding without binary subtraction at a half tie.
  const lossBasisPoints = ((originalCents - currentCents) * BigInt(10000) + originalCents / BigInt(2)) / originalCents;
  return Number(lossBasisPoints) / 100;
}

export function calculateCurrentWeight(originalWeight: number, lossPercent: number) {
  if (!Number.isFinite(originalWeight) || originalWeight <= 0
    || !hasTwoDecimalPrecision(lossPercent) || lossPercent < 0 || lossPercent >= 100) return null;
  const originalCents = toCents(originalWeight), lossBasisPoints = toCents(lossPercent);
  if (originalCents === null || lossBasisPoints === null) return null;
  const weightCents = (originalCents * (BigInt(10000) - lossBasisPoints) + BigInt(5000)) / BigInt(10000);
  return weightCents > BigInt(0) ? Number(weightCents) / 100 : null;
}

export function calculateWorkTotal(
  netWeightTotal: number | null,
  workRate: number | null,
  otherOperatingCost: number
) {
  if (netWeightTotal === null || workRate === null) return null;
  if (
    !Number.isFinite(netWeightTotal)
    || !Number.isFinite(workRate)
    || !Number.isFinite(otherOperatingCost)
  ) {
    return null;
  }
  if (netWeightTotal <= 0 || workRate < 0 || otherOperatingCost < 0) return null;
  const weightCents = toCents(netWeightTotal);
  const rateCents = toCents(workRate);
  const otherCents = toCents(otherOperatingCost);
  if (weightCents === null || rateCents === null || otherCents === null) return null;
  const totalCents = (weightCents * rateCents + BigInt(50)) / BigInt(100) + otherCents;
  if (totalCents > BigInt("99999999999999")) return null;
  return Number(totalCents) / 100;
}

export function calculateExternalWorkTransferAmount(workTotal: number | null | undefined) {
  if (workTotal == null || !Number.isFinite(workTotal) || workTotal <= 0) return 0;
  return Math.floor(workTotal);
}

export function calculateRubberExportItemPricePerKg(
  rubberValueAmount: number,
  netWeight: number,
) {
  if (
    !Number.isFinite(rubberValueAmount)
    || !Number.isFinite(netWeight)
    || rubberValueAmount < 0
    || netWeight <= 0
  ) {
    return null;
  }
  return rubberValueAmount / netWeight;
}

export function calculatePurchaseCostIncludingWork(
  rubberValueTotal: number,
  workTotal: number | null | undefined,
  currentWeight: number | null | undefined,
  originalWeightTotal: number,
) {
  if (
    workTotal == null
    || !Number.isFinite(rubberValueTotal)
    || !Number.isFinite(workTotal)
    || rubberValueTotal < 0
    || workTotal < 0
  ) {
    return { total: null, average: null };
  }
  const total = round2(rubberValueTotal + workTotal);
  if (
    currentWeight == null
    || !isValidCurrentWeight(originalWeightTotal, currentWeight)
  ) {
    return { total, average: null };
  }
  return { total, average: round2(total / currentWeight) };
}

export function isValidCurrentWeight(originalWeight: number, currentWeight: number | null) {
  return currentWeight !== null
    && Number.isFinite(originalWeight)
    && hasTwoDecimalPrecision(currentWeight)
    && originalWeight > 0
    && currentWeight > 0
    && currentWeight <= originalWeight;
}
