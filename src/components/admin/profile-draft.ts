export function isPrimaryLocationLocked(canManageSystem: boolean, primaryLocationId: string | null) {
  return !canManageSystem && primaryLocationId !== null;
}
