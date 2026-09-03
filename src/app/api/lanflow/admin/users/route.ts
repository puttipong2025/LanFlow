import { NextRequest, NextResponse } from "next/server";
import { requireRoleOrSystemManager } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import { normalizeThaiPhoneToE164 } from "@/lib/phone";
import type { AppRole } from "@/types";
import { deriveEffectiveCapabilities } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  const adminCheck = await requireRoleOrSystemManager(request, ["super_admin", "admin"]);
  if (!adminCheck.ok) return adminCheck.response;

  try {
    const supabase = adminCheck.supabase;

    // Fetch all profiles
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, name, phone, role, is_active, can_access_super_admin_features, can_access_money_transfer, can_manage_time_payroll")
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
    const body = await request.json() as {
      phone?: string;
      name?: string;
      password?: string;
      role?: AppRole;
      locationIds?: string[];
    };

    if (!body.phone || !body.name || !body.password) {
      return NextResponse.json(
        { error: "phone, name and password are required" },
        { status: 400 }
      );
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

    const id = crypto.randomUUID();
    const phoneE164 = normalizeThaiPhoneToE164(body.phone);
    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      id,
      phone: phoneE164,
      phone_confirm: true,
      password: body.password,
      user_metadata: { name: body.name.trim() },
      app_metadata: { lanflow_role: role }
    });

    if (authError || !authUser.user) {
      throw authError ?? new Error("Could not create auth user");
    }
    authUserId = authUser.user.id;

    const { error: profileError } = await admin.from("profiles").insert({
      id,
      phone: body.phone.trim(),
      name: body.name.trim(),
      role,
      is_active: true,
      password_hash: null
    });
    if (profileError) throw profileError;

    const locationIds = [...new Set(body.locationIds ?? [])];
    if (locationIds.length > 0) {
      const { error: assignmentError } = await admin.from("user_locations").insert(
        locationIds.map((locationId, index) => ({
          user_id: id,
          location_id: locationId,
          assigned_by: adminCheck.auth.sub,
          is_primary: index === 0
        }))
      );
      if (assignmentError) throw assignmentError;
    }

    const capabilities = deriveEffectiveCapabilities({
      role,
      canAccessSystemManager: false,
      canAccessMoneyTransfer: false,
      canManageTimePayroll: false,
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
