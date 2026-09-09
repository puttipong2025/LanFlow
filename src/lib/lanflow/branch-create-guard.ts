export type BranchCreateGuardContext = {
  primaryLocationId: string | null;
  activeLocationId: string;
};

export const BRANCH_CONFIRMATION_MIN_MINUTES = 1;
export const BRANCH_CONFIRMATION_MAX_MINUTES = 120;
export const BRANCH_CONFIRMATION_DEFAULT_MINUTES = 15;

export function validBranchConfirmationMinutes(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= BRANCH_CONFIRMATION_MIN_MINUTES
    && value <= BRANCH_CONFIRMATION_MAX_MINUTES;
}

export function resolveBranchConfirmationMinutes(
  freshValue: unknown,
  cachedValue: unknown,
) {
  if (validBranchConfirmationMinutes(freshValue)) return freshValue;
  if (validBranchConfirmationMinutes(cachedValue)) return cachedValue;
  return BRANCH_CONFIRMATION_DEFAULT_MINUTES;
}

export type BranchCreateGuardState = BranchCreateGuardContext & {
  version: 3;
  acknowledgedAt: number | null;
};

export type BranchCreateChoice = {
  id: string;
  name: string;
};

function storageKey(userId: string) {
  return `lanflow:branch-create-guard:v3:${userId}`;
}

function legacyStorageKeys(userId: string) {
  return [
    `lanflow:branch-create-guard:v1:${userId}`,
    `lanflow:branch-create-guard:v2:${userId}`,
  ];
}

export function parseBranchCreateGuardState(
  value: string | null,
): BranchCreateGuardState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<BranchCreateGuardState>;
    if (
      parsed.version !== 3
      || typeof parsed.activeLocationId !== "string"
      || !parsed.activeLocationId
      || (parsed.primaryLocationId !== null
        && (typeof parsed.primaryLocationId !== "string" || !parsed.primaryLocationId))
      || (parsed.acknowledgedAt !== null
        && (typeof parsed.acknowledgedAt !== "number"
          || !Number.isFinite(parsed.acknowledgedAt)))
    ) return null;
    return {
      version: 3,
      primaryLocationId: parsed.primaryLocationId,
      activeLocationId: parsed.activeLocationId,
      acknowledgedAt: parsed.acknowledgedAt,
    };
  } catch {
    return null;
  }
}

export function reconcileBranchCreateGuardState(
  stored: BranchCreateGuardState | null,
  context: BranchCreateGuardContext,
): BranchCreateGuardState {
  const sameContext = stored?.activeLocationId === context.activeLocationId
    && stored.primaryLocationId === context.primaryLocationId;
  return {
    version: 3,
    ...context,
    acknowledgedAt: sameContext ? stored.acknowledgedAt : null,
  };
}

export function acknowledgeBranchCreateGuardState(
  state: BranchCreateGuardState,
  nowMs: number = Date.now(),
) {
  return { ...state, acknowledgedAt: nowMs } satisfies BranchCreateGuardState;
}

export function requiresBranchCreateConfirmation(
  state: BranchCreateGuardState,
  context: BranchCreateGuardContext,
  managedLocationIds: string[],
  confirmationMinutes: number = BRANCH_CONFIRMATION_DEFAULT_MINUTES,
  nowMs: number = Date.now(),
) {
  if (!managedLocationIds.includes(context.activeLocationId)) return true;
  if (managedLocationIds.length === 1) return false;
  if (state.activeLocationId !== context.activeLocationId
    || state.primaryLocationId !== context.primaryLocationId) return true;
  if (state.acknowledgedAt === null
    || !Number.isFinite(state.acknowledgedAt)
    || state.acknowledgedAt > nowMs) return true;
  const minutes = validBranchConfirmationMinutes(confirmationMinutes)
    ? confirmationMinutes
    : BRANCH_CONFIRMATION_DEFAULT_MINUTES;
  return nowMs - state.acknowledgedAt >= minutes * 60_000;
}

function shuffled<T>(values: T[], random: () => number) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function buildBranchCreateChoices(
  locations: BranchCreateChoice[],
  activeLocationId: string,
  random: () => number = Math.random,
) {
  const uniqueLocations = [...new Map(
    locations.filter((location) => location.id && location.name)
      .map((location) => [location.id, location]),
  ).values()];
  const activeLocation = uniqueLocations.find((location) => location.id === activeLocationId);
  if (!activeLocation) return [];

  const choices = uniqueLocations.length <= 3
    ? uniqueLocations
    : [
        activeLocation,
        ...shuffled(
          uniqueLocations.filter((location) => location.id !== activeLocationId),
          random,
        ).slice(0, 2),
      ];
  return shuffled(choices, random);
}

export function readBranchCreateGuardState(userId: string) {
  if (!userId) return null;
  try {
    for (const key of legacyStorageKeys(userId)) localStorage.removeItem(key);
    return parseBranchCreateGuardState(localStorage.getItem(storageKey(userId)));
  } catch {
    return null;
  }
}

export function writeBranchCreateGuardState(userId: string, state: BranchCreateGuardState) {
  if (!userId) return false;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearBranchCreateGuardState(userId: string) {
  if (!userId) return;
  try {
    localStorage.removeItem(storageKey(userId));
    for (const key of legacyStorageKeys(userId)) localStorage.removeItem(key);
  } catch { /* best effort */ }
}
