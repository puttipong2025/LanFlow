import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPassword, signToken } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone, password } = body as { phone?: string; password?: string };

    if (!phone || !password) {
      return NextResponse.json(
        { error: "กรุณากรอกเบอร์โทรและรหัสผ่าน" },
        { status: 400 }
      );
    }

    // Use service_role to query profiles (no auth yet)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    // Find profile by phone
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, phone, name, role, is_active, password_hash")
      .eq("phone", phone.trim())
      .maybeSingle();

    if (profileError) {
      console.error("Login query error", profileError);
      return NextResponse.json(
        { error: "เกิดข้อผิดพลาดในระบบ" },
        { status: 500 }
      );
    }

    if (!profile) {
      return NextResponse.json(
        { error: "เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง" },
        { status: 401 }
      );
    }

    if (!profile.is_active) {
      return NextResponse.json(
        { error: "บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ" },
        { status: 403 }
      );
    }

    if (!profile.password_hash) {
      return NextResponse.json(
        { error: "บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ" },
        { status: 403 }
      );
    }

    // Verify password
    const passwordValid = await verifyPassword(password, profile.password_hash);
    if (!passwordValid) {
      return NextResponse.json(
        { error: "เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง" },
        { status: 401 }
      );
    }

    // Get user's location IDs
    const { data: userLocations } = await supabase
      .from("user_locations")
      .select("location_id")
      .eq("user_id", profile.id);

    const locationIds = (userLocations ?? []).map((ul) => ul.location_id as string);

    // Sign JWT
    const token = await signToken({
      sub: profile.id,
      phone: profile.phone,
      name: profile.name,
      role: profile.role,
      locationIds,
    });

    return NextResponse.json({
      token,
      profile: {
        id: profile.id,
        phone: profile.phone,
        name: profile.name,
        role: profile.role,
        locationIds,
      },
    });
  } catch (error) {
    console.error("Login error", error);
    const message = error instanceof Error ? error.message : "เกิดข้อผิดพลาด";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
