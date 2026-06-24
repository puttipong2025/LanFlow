import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { phoneToAuthEmail } from "@/lib/phone";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { phone?: string; password?: string };
    if (!body.phone || !body.password) {
      return NextResponse.json(
        { error: "กรุณากรอกเบอร์โทรและรหัสผ่าน" },
        { status: 400 }
      );
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: phoneToAuthEmail(body.phone),
      password: body.password
    });

    if (error) {
      return NextResponse.json(
        { error: "เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง" },
        { status: 401 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "ไม่สามารถเข้าสู่ระบบได้"
      },
      { status: 400 }
    );
  }
}
