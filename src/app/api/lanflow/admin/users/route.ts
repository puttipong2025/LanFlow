import { NextRequest, NextResponse } from "next/server";
import { requireRoleOrSystemManager } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import { normalizeThaiPhoneToE164 } from "@/lib/phone";
import type { AppRole } from "@/types";
import { deriveEffectiveCapabilities } from "@/lib/permissions";
import {
  isUuid,
  managementErrorResponse,
} from "@/lib/server/management-route-error";

export async function GET(request: NextRequest) {
  const adminCheck = await requireRoleOrSystemManager(request, ["super_admin", "admin"]);
  if (!adminCheck.ok) return adminCheck.response;

  try {
    const supabase = adminCheck.supabase;

    // Fetch all profiles
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, name, phone, role, is_active, can_access_super_admin_features, can_access_money_transfer, can_manage_time_payroll, can_manage_rubber_exports")
      .order("created_at", { ascending: true });

    if (profilesError) throw profilesError;

    // Fetch user_locations mapping
    const { data: userLocations, error: ulError } = await supabase
      .from("user_locations")
      .select("user_id, location_id, is_primary");

    if (ulError) throw ulError;

    // Group location IDs by user
    const locationMap = new Map<string, string[]>();
    for (const ul of userLocations) {
      if (!locationMap.has(ul.user_id)) {
        locationMap.set(ul.user_id, []);
      }
      locationMap.get(ul.user_id)!.push(ul.location_id);
    }

    // Map to Profile type
    const result = profiles.map(p => {
      const capabilities = deriveEffectiveCapabilities({
        role: p.role as AppRole,
        canAccessSystemManager: p.can_access_super_admin_features === true,
        canAccessMoneyTransfer: p.can_access_money_transfer === true,
        canManageTimePayroll: p.can_manage_time_payroll === true,
        canManageRubberExports: p.can_manage_rubber_exports === true,
      });
      return {
        id: p.id,
        name: p.name,
        phone: p.phone,
        role: p.role,
        isActive: p.is_active,
        locationIds: locationMap.get(p.id) || [],
        primaryLocationId: userLocations.find((ul) => ul.user_id === p.id && ul.is_primary === true)?.location_id ?? null,
        canAccessSystemManager: capabilities.canManageSystem,
        canAccessMoneyTransfer: capabilities.canUseMoneyTransfer,
        canManageTimePayroll: capabilities.canManageTimePayroll,
        canManageRubberExports: capabilities.canManageRubberExports,
      };
    });

    return NextResponse.json({ users: result });
  } catch (error: any) {
    console.error("Admin fetch users error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const adminCheck = await requireRoleOrSystemManager(request, ["super_admin", "admin"]);
  if (!adminCheck.ok) return adminCheck.response;

  const admin = createSupabaseAdminClient();
  let authUserId: string | null = null;

  try {
    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid request body" }, { status: 400 });
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "invalid request body" }, { status: 400 });
    }
    const body = parsed as {
      phone?: string;
      name?: string;
      password?: string;
      role?: AppRole;
      locationIds?: string[];
    };

    if (typeof body.phone !== "string"
        || typeof body.name !== "string"
        || typeof body.password !== "string"
        || !body.phone.trim()
        || !body.name.trim()
        || !body.password) {
      return NextResponse.json(
        { error: "phone, name and password are required" },
        { status: 400 }
      );
    }

    if (body.locationIds !== undefined
        && (!Array.isArray(body.locationIds) || body.locationIds.some((id) => !isUuid(id)))) {
      return NextResponse.json({ error: "invalid locationIds" }, { status: 400 });
    }

    if (body.password.length < 8) {
      return NextResponse.json(
        { error: "password must contain at least 8 characters" },
        { status: 400 }
      );
    }

    const role = body.role ?? "user";
    if (!["user", "admin"].includes(role)) {
      return NextResponse.json({ error: "invalid role" }, { status: 400 });
    }

    if (role === 'admin' && adminCheck.auth.role !== 'super_admin') {
      return NextResponse.json({ error: "Only super_admin can create admin accounts" }, { status: 403 });
    }

    const locationIds = [...new Set(body.locationIds ?? [])];
    if (locationIds.length > 0) {
      const { data: visibleLocations, error: locationError } = await adminCheck.supabase
        .from("locations")
        .select("id, is_active")
        .in("id", locationIds);
      if (locationError) throw locationError;
      if (visibleLocations.length !== locationIds.length) {
        return NextResponse.json(
          { error: "ไม่มีสิทธิ์กำหนดสาขานอกขอบเขตของ Admin" },
          { status: 403 },
        );
      }
      if (visibleLocations.some((location) => location.is_active !== true)) {
        return NextResponse.json({ error: "มีสาขาที่ไม่พร้อมใช้งาน" }, { status: 400 });
      }
    }

    const id = crypto.randomUUID();
    const passwordVersion = crypto.randomUUID();
    let phoneE164: string;
    try {
      phoneE164 = normalizeThaiPhoneToE164(body.phone);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง" },
        { status: 400 },
      );
    }
    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      id,
      phone: phoneE164,
      phone_confirm: true,
      password: body.password,
      user_metadata: {
        name: body.name.trim(),
        lanflow_password_copy_version: passwordVersion,
      },
      app_metadata: { lanflow_role: role }
    });

    if (authError || !authUser.user) {
      throw authError ?? new Error("Could not create auth user");
    }
    authUserId = authUser.user.id;

    const { error: profileError } = await adminCheck.supabase.rpc("create_admin_user_profile", {
      p_user_id: id,
      p_phone: body.phone.trim(),
      p_name: body.name.trim(),
      p_role: role,
      p_location_ids: locationIds,
      p_password_plaintext: body.password,
      p_password_auth_version: passwordVersion,
    });
    if (profileError) {
      const cleanup = await admin.auth.admin.deleteUser(authUserId);
      if (cleanup.error) throw cleanup.error;
      authUserId = null;
      return managementErrorResponse(profileError, "Could not create user");
    }

    const capabilities = deriveEffectiveCapabilities({
      role,
      canAccessSystemManager: false,
      canAccessMoneyTransfer: false,
      canManageTimePayroll: false,
      canManageRubberExports: false,
    });

    return NextResponse.json(
      {
        user: {
          id,
          phone: body.phone.trim(),
          name: body.name.trim(),
          role,
          isActive: true,
          locationIds,
          canAccessSystemManager: capabilities.canManageSystem,
          canAccessMoneyTransfer: capabilities.canUseMoneyTransfer,
          canManageTimePayroll: capabilities.canManageTimePayroll,
          canManageRubberExports: capabilities.canManageRubberExports,
          primaryLocationId: locationIds[0] ?? null
        }
      },
      { status: 201 }
    );
  } catch (error) {
    if (authUserId) {
      await admin.from("profiles").delete().eq("id", authUserId);
      await admin.auth.admin.deleteUser(authUserId);
    }

    const message = error instanceof Error ? error.message : "Could not create user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
