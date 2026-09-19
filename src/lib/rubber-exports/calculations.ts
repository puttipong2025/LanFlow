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
  return round2(((originalWeight - currentWeight) / originalWeight) * 100);
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
