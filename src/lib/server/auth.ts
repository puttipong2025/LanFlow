import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { AppRole } from "@/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthTokenPayload = {
  sub: string;
  phone: string;
  name: string;
  role: AppRole;
  locationIds: string[];
  canAccessSystemManager: boolean;
  canAccessMoneyTransfer: boolean;
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

export async function requireAuth(_request?: Request): Promise<AuthResult> {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || typeof userId !== "string") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ไม่ได้เข้าสู่ระบบ หรือ session หมดอายุ" },
        { status: 401 }
      )
    };
  }

  const [{ data: profile, error: profileError }, { data: assignments, error: assignmentsError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, phone, name, role, is_active, can_access_super_admin_features, can_access_money_transfer")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("user_locations")
        .select("location_id")
        .eq("user_id", userId)
    ]);

  if (
    profileError ||
    assignmentsError ||
    !profile ||
    profile.is_active !== true
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "บัญชีถูกปิดใช้งาน หรือไม่มีสิทธิ์เข้าถึง" },
        { status: 403 }
      )
    };
  }

  return {
    ok: true,
    auth: {
      sub: profile.id,
      phone: profile.phone,
      name: profile.name,
      role: profile.role as AppRole,
      locationIds: (assignments ?? []).map((item) => item.location_id as string),
      canAccessSystemManager: profile.role === "super_admin" || profile.can_access_super_admin_features === true,
      canAccessMoneyTransfer:
        profile.role === "super_admin" ||
        profile.can_access_super_admin_features === true ||
        profile.can_access_money_transfer === true
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
