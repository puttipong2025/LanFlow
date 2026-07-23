import type { Profile } from "@/types";

export function canManageSystemFeatures(profile: Profile | null | undefined) {
  return profile?.role === "super_admin" || profile?.canAccessSystemManager === true;
}

export function canManageFeatureAccess(profile: Profile | null | undefined) {
  return profile?.role === "super_admin";
}

export function canUseMoneyTransfer(profile: Profile | null | undefined) {
  return canManageSystemFeatures(profile) || profile?.canAccessMoneyTransfer === true;
}

export function canUseReports(profile: Profile | null | undefined) {
  return canManageSystemFeatures(profile) || profile?.role === "admin";
}

export function canAccessSourceLocation(profile: Profile | null | undefined, locationId: string) {
  return canManageSystemFeatures(profile) || profile?.locationIds.includes(locationId) === true;
}
