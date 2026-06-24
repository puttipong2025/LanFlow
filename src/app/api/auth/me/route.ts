import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthPayload } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) {
      return NextResponse.json(
        { error: "ไม่ได้เข้าสู่ระบบ" },
        { status: 401 }
      );
    }

    // Fetch fresh profile data from DB
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, phone, name, role, is_active")
      .eq("id", auth.sub)
      .maybeSingle();

    if (error || !profile) {
      return NextResponse.json(
        { error: "ไม่พบข้อมูลผู้ใช้" },
        { status: 404 }
      );
    }

    if (!profile.is_active) {
      return NextResponse.json(
        { error: "บัญชีถูกปิดใช้งาน" },
        { status: 403 }
      );
    }

    // Get user's locations
    const { data: userLocations } = await supabase
      .from("user_locations")
      .select("location_id")
      .eq("user_id", profile.id);

    const locationIds = (userLocations ?? []).map((ul) => ul.location_id as string);

    return NextResponse.json({
      profile: {
        id: profile.id,
        phone: profile.phone,
        name: profile.name,
        role: profile.role,
        locationIds,
      },
    });
  } catch (error) {
    console.error("Auth me error", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาด" }, { status: 500 });
  }
}
