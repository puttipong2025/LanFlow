function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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
  return round2(netWeightTotal * workRate + otherOperatingCost);
}

export function isValidCurrentWeight(originalWeight: number, currentWeight: number | null) {
  return currentWeight !== null
    && Number.isFinite(originalWeight)
    && Number.isFinite(currentWeight)
    && originalWeight > 0
    && currentWeight > 0
    && currentWeight <= originalWeight;
}
