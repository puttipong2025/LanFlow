import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hashPassword, getAuthPayload } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    // อนุญาตให้สมัครเองได้ (แต่จะยังไม่เห็นข้อมูลสาขาจนกว่า admin จะกำหนดให้)

    const body = await request.json();
    const { phone, name, password } = body as {
      phone?: string;
      name?: string;
      password?: string;
    };

    if (!phone || !name || !password) {
      return NextResponse.json(
        { error: "กรุณากรอกเบอร์โทร ชื่อ และรหัสผ่าน" },
        { status: 400 }
      );
    }

    if (password.length < 4) {
      return NextResponse.json(
        { error: "รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร" },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    // Check if phone already exists
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("phone", phone.trim())
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "เบอร์โทรนี้ถูกใช้งานแล้ว" },
        { status: 409 }
      );
    }

    // Hash password and create profile
    const passwordHash = await hashPassword(password);

    const { data: profile, error } = await supabase
      .from("profiles")
      .insert({
        phone: phone.trim(),
        name: name.trim(),
        password_hash: passwordHash,
        role: "user",
        is_active: true,
      })
      .select("id, phone, name, role, is_active")
      .single();

    if (error) {
      console.error("Register error", error);
      return NextResponse.json(
        { error: "ไม่สามารถสร้างบัญชีได้" },
        { status: 500 }
      );
    }

    return NextResponse.json({ profile });
  } catch (error) {
    console.error("Register error", error);
    const message = error instanceof Error ? error.message : "เกิดข้อผิดพลาด";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
