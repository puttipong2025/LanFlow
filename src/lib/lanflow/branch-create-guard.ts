export type BranchCreateGuardContext = {
  primaryLocationId: string | null;
  activeLocationId: string;
};

export type BranchCreateGuardState = BranchCreateGuardContext & {
  version: 2;
  acknowledged: boolean;
};

export type BranchCreateChoice = {
  id: string;
  name: string;
};

function storageKey(userId: string) {
  return `lanflow:branch-create-guard:v2:${userId}`;
}

function legacyStorageKey(userId: string) {
  return `lanflow:branch-create-guard:v1:${userId}`;
}

export function parseBranchCreateGuardState(
  value: string | null,
): BranchCreateGuardState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<BranchCreateGuardState>;
    if (
      parsed.version !== 2
      || typeof parsed.activeLocationId !== "string"
      || !parsed.activeLocationId
      || (parsed.primaryLocationId !== null
        && (typeof parsed.primaryLocationId !== "string" || !parsed.primaryLocationId))
      || typeof parsed.acknowledged !== "boolean"
    ) return null;
    return {
      version: 2,
      primaryLocationId: parsed.primaryLocationId,
      activeLocationId: parsed.activeLocationId,
      acknowledged: parsed.acknowledged,
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
    version: 2,
    ...context,
    acknowledged: sameContext ? stored.acknowledged : false,
  };
}

export function acknowledgeBranchCreateGuardState(state: BranchCreateGuardState) {
  return { ...state, acknowledged: true } satisfies BranchCreateGuardState;
}

export function requiresBranchCreateConfirmation(
  state: BranchCreateGuardState,
  context: BranchCreateGuardContext,
  managedLocationIds: string[],
) {
  if (!managedLocationIds.includes(context.activeLocationId)) return true;
  if (managedLocationIds.length === 1) return false;
  if (state.activeLocationId !== context.activeLocationId
    || state.primaryLocationId !== context.primaryLocationId) return true;
  return !state.acknowledged;
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
    localStorage.removeItem(legacyStorageKey(userId));
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
    localStorage.removeItem(legacyStorageKey(userId));
  } catch { /* best effort */ }
}
