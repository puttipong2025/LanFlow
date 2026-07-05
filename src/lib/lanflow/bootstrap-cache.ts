import type { Location, Profile } from "@/types";

type BootstrapCacheData = {
  locations: Location[];
  profile: Profile;
  selectedLocationId: string;
};

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
    const allowedLocations = parsed.locations.filter((l: any) => parsed.profile.locationIds.includes(l.id));
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
