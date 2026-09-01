import type { Location, Profile } from "@/types";

type BootstrapCacheData = {
  locations: Location[];
  profile: Profile;
  selectedLocationId: string;
};

function lastLocationPreferenceKey(userId: string) {
  return `lanflow:last-location:${userId}`;
}

export function writeLastLocationPreference(userId: string, locationId: string) {
  if (!userId || !locationId) return;
  try {
    localStorage.setItem(lastLocationPreferenceKey(userId), locationId);
  } catch { /* skip */ }
}

export function readLastLocationPreference(userId: string) {
  if (!userId) return null;
  try {
    return localStorage.getItem(lastLocationPreferenceKey(userId));
  } catch {
    return null;
  }
}

export function resolveSelectedLocationId(
  locations: Array<Pick<Location, "id" | "active">>,
  allowedLocationIds: string[],
  preferredLocationId: string | null,
) {
  const allowed = new Set(allowedLocationIds);
  const accessibleLocations = locations.filter(
    (location) => location.active && allowed.has(location.id)
  );
  const preferredLocation = accessibleLocations.find(
    (location) => location.id === preferredLocationId
  );
  return preferredLocation?.id ?? accessibleLocations[0]?.id ?? "";
}

export function writeBootstrapCache(userId: string, data: BootstrapCacheData) {
  try {
    localStorage.setItem(`lanflow_bootstrap_cache:${userId}`, JSON.stringify(data));
  } catch { /* skip */ }
}

export function readBootstrapCache(userId: string): BootstrapCacheData | null {
  try {
    const raw = localStorage.getItem(`lanflow_bootstrap_cache:${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    
    // Strict validation
    if (!parsed.profile || parsed.profile.id !== userId) return null;
    if (!Array.isArray(parsed.locations) || parsed.locations.length === 0) return null;
    
    // Only keep locations the user has access to
    const allowedLocations = parsed.locations.filter(
      (l: any) => l.active === true && parsed.profile.locationIds.includes(l.id)
    );
    if (allowedLocations.length === 0) return null;

    // Fallback selectedLocationId if invalid
    const validSelected = allowedLocations.some((l: any) => l.id === parsed.selectedLocationId);

    return {
      locations: allowedLocations,
      profile: parsed.profile,
      selectedLocationId: validSelected ? parsed.selectedLocationId : allowedLocations[0].id
    };
  } catch {
    return null;
  }
}

export function clearBusinessBootstrapCache(userId: string) {
  if (!userId) return;
  try {
    localStorage.removeItem(`lanflow_bootstrap_cache:${userId}`);
    localStorage.removeItem(lastLocationPreferenceKey(userId));
  } catch { /* skip */ }
}
