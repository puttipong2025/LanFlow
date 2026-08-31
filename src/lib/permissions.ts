import type { Profile } from "@/types";

type CapabilityProfile = Pick<
  Profile,
  "role" | "canAccessSystemManager" | "canAccessMoneyTransfer" | "canManageTimePayroll"
>;

export function deriveEffectiveCapabilities(profile: CapabilityProfile | null | undefined) {
  const isSuperAdmin = profile?.role === "super_admin";
  const isAdmin = profile?.role === "admin";
  const canManageSystem = isSuperAdmin || (isAdmin && profile?.canAccessSystemManager === true);

  return {
    canManageSystem,
    canUseMoneyTransfer:
      canManageSystem || (isAdmin && profile?.canAccessMoneyTransfer === true),
    canManageTimePayroll:
      canManageSystem || (isAdmin && profile?.canManageTimePayroll === true),
  };
}

export function canManageSystemFeatures(profile: Profile | null | undefined) {
  return deriveEffectiveCapabilities(profile).canManageSystem;
}

export function canManageFeatureAccess(profile: Profile | null | undefined) {
  return profile?.role === "super_admin";
}

export function canUseMoneyTransfer(profile: Profile | null | undefined) {
  return deriveEffectiveCapabilities(profile).canUseMoneyTransfer;
}

export function canManageTimePayroll(profile: Profile | null | undefined) {
  return deriveEffectiveCapabilities(profile).canManageTimePayroll;
}

export function canUseReports(profile: Profile | null | undefined) {
  return canManageSystemFeatures(profile) || profile?.role === "admin";
}

export function canAccessSourceLocation(profile: Profile | null | undefined, locationId: string) {
  return canManageSystemFeatures(profile) || profile?.locationIds.includes(locationId) === true;
}
