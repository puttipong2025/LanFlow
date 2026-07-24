function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateNetWeight(weight: number, deductWeight: number) {
  if (!Number.isFinite(weight) || !Number.isFinite(deductWeight)) return null;
  if (weight <= 0 || deductWeight < 0) return null;

  const netWeight = round2(weight - deductWeight);
  return netWeight > 0 ? netWeight : null;
}

export function calculateAveragePrice(paidTotal: number, netWeightTotal: number) {
  if (!Number.isFinite(paidTotal) || !Number.isFinite(netWeightTotal)) return null;
  if (paidTotal <= 0 || netWeightTotal <= 0) return null;

  return round2(paidTotal / netWeightTotal);
}

export function calculateWeightLossPercent(originalWeight: number, currentWeight: number) {
  if (!Number.isFinite(originalWeight) || !Number.isFinite(currentWeight)) return null;
  if (originalWeight <= 0 || currentWeight <= 0 || currentWeight > originalWeight) return null;
  return round2(((originalWeight - currentWeight) / originalWeight) * 100);
}

export function calculateWorkTotal(
  currentWeight: number | null,
  workRate: number | null,
  otherOperatingCost: number
) {
  if (currentWeight === null || workRate === null) return null;
  if (
    !Number.isFinite(currentWeight)
    || !Number.isFinite(workRate)
    || !Number.isFinite(otherOperatingCost)
  ) {
    return null;
  }
  if (currentWeight <= 0 || workRate < 0 || otherOperatingCost < 0) return null;
  return round2(currentWeight * workRate + otherOperatingCost);
}

export function isValidCurrentWeight(originalWeight: number, currentWeight: number | null) {
  return currentWeight !== null
    && Number.isFinite(originalWeight)
    && Number.isFinite(currentWeight)
    && originalWeight > 0
    && currentWeight > 0
    && currentWeight <= originalWeight;
}
