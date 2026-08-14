import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { AppRole } from "@/types";
import {
  type AuthAccessFailure,
  classifyAuthAccessFailure,
  classifyAuthClaimsFailure,
  summarizeUpstreamError,
} from "@/lib/server/auth-access-failure";
import { createSupabaseRequestClient } from "@/lib/supabase/server";

export type AuthTokenPayload = {
  sub: string;
  phone: string;
  name: string;
  role: AppRole;
  locationIds: string[];
  primaryLocationId: string | null;
  canAccessSystemManager: boolean;
  canAccessMoneyTransfer: boolean;
  canManageTimePayroll: boolean;
};

type AuthSuccess = {
  ok: true;
  auth: AuthTokenPayload;
  supabase: SupabaseClient;
};

type AuthFailure = {
  ok: false;
  response: NextResponse;
};

export type AuthResult = AuthSuccess | AuthFailure;

function authFailureResponse(failure: AuthAccessFailure) {
  return NextResponse.json(
    { error: failure.message },
    {
      status: failure.status,
      headers: failure.status === 503
        ? {
            "Cache-Control": "private, no-store, max-age=0",
            "Retry-After": "3",
          }
        : undefined,
    },
  );
}

export async function requireAuth(request?: Request): Promise<AuthResult> {
  const supabase = await createSupabaseRequestClient(request);
  const bearerToken = request?.headers.get("authorization")?.trim().match(/^Bearer\s+(.+)$/i)?.[1];
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(bearerToken);
  const userId = claimsData?.claims?.sub;

  const claimsFailure = classifyAuthClaimsFailure({
    claimsError,
    hasUserId: typeof userId === "string",
  });
  if (claimsFailure) {
    if (claimsFailure.status === 503) {
      console.error("Auth claims unavailable", summarizeUpstreamError(claimsError));
    }
    return {
      ok: false,
      response: authFailureResponse(claimsFailure),
    };
  }

  const [{ data: profile, error: profileError }, { data: assignments, error: assignmentsError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, phone, name, role, is_active, can_access_super_admin_features, can_access_money_transfer, can_manage_time_payroll")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("user_locations")
        .select("location_id, is_primary, locations!inner(is_active)")
        .eq("user_id", userId)
        .eq("locations.is_active", true)
    ]);

  const accessFailure = classifyAuthAccessFailure({
    assignmentsError,
    hasProfile: Boolean(profile),
    isActive: profile?.is_active === true,
    profileError,
  });
  if (accessFailure) {
    if (accessFailure.status === 503) {
      console.error("Auth profile lookup unavailable", {
        assignments: summarizeUpstreamError(assignmentsError),
        profile: summarizeUpstreamError(profileError),
      });
    }
    return {
      ok: false,
      response: authFailureResponse(accessFailure),
    };
  }
  const activeProfile = profile!;

  return {
    ok: true,
    auth: {
      sub: activeProfile.id,
      phone: activeProfile.phone,
      name: activeProfile.name,
      role: activeProfile.role as AppRole,
      locationIds: (assignments ?? []).map((item) => item.location_id as string),
      primaryLocationId:
        (assignments ?? []).find((item) => item.is_primary === true)?.location_id as string | undefined ?? null,
      canAccessSystemManager: activeProfile.role === "super_admin" || activeProfile.can_access_super_admin_features === true,
      canAccessMoneyTransfer:
        activeProfile.role === "super_admin" ||
        activeProfile.can_access_super_admin_features === true ||
        activeProfile.can_access_money_transfer === true,
      canManageTimePayroll:
        activeProfile.role === "super_admin" ||
        activeProfile.can_access_super_admin_features === true ||
        activeProfile.can_manage_time_payroll === true
    },
    supabase
  };
}

export function hasSystemManagerAccess(auth: AuthTokenPayload) {
  return auth.role === "super_admin" || auth.canAccessSystemManager === true;
}

export async function requireSystemManager(request: Request): Promise<AuthResult> {
  const result = await requireAuth(request);
  if (!result.ok) return result;

  if (!hasSystemManagerAccess(result.auth)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ไม่มีสิทธิ์เข้าถึง" },
        { status: 403 }
      )
    };
  }

  return result;
}

export async function requireRoleOrSystemManager(
  request: Request,
  roles: AppRole[]
): Promise<AuthResult> {
  const result = await requireAuth(request);
  if (!result.ok) return result;

  if (!roles.includes(result.auth.role) && !hasSystemManagerAccess(result.auth)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ไม่มีสิทธิ์เข้าถึง" },
        { status: 403 }
      )
    };
  }

  return result;
}

export async function requireRole(
  request: Request,
  roles: AppRole[]
): Promise<AuthResult> {
  const result = await requireAuth(request);
  if (!result.ok) return result;

  if (!roles.includes(result.auth.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ไม่มีสิทธิ์เข้าถึง" },
        { status: 403 }
      )
    };
  }

  return result;
}
