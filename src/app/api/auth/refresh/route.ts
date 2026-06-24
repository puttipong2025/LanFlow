import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthPayload, signToken } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) {
      return NextResponse.json(
        { error: "Token หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่" },
        { status: 401 }
      );
    }

    // Fetch fresh data from DB to include any role/location changes
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, phone, name, role, is_active")
      .eq("id", auth.sub)
      .maybeSingle();

    if (!profile || !profile.is_active) {
      return NextResponse.json(
        { error: "บัญชีไม่พบหรือถูกปิดใช้งาน" },
        { status: 403 }
      );
    }

    const { data: userLocations } = await supabase
      .from("user_locations")
      .select("location_id")
      .eq("user_id", profile.id);

    const locationIds = (userLocations ?? []).map((ul) => ul.location_id as string);

    // Issue new token with fresh data
    const token = await signToken({
      sub: profile.id,
      phone: profile.phone,
      name: profile.name,
      role: profile.role,
      locationIds,
    });

    return NextResponse.json({ token });
  } catch (error) {
    console.error("Token refresh error", error);
    return NextResponse.json(
      { error: "ไม่สามารถ refresh token ได้" },
      { status: 500 }
    );
  }
}
