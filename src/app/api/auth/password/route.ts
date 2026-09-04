import { NextRequest, NextResponse } from "next/server";

import { normalizeThaiPhoneToE164 } from "@/lib/phone";
import { requireAuth } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import type {
  SelfPasswordChangeRequest,
  SelfPasswordChangeResponse,
} from "@/types";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: NextRequest) {
  const authCheck = await requireAuth(request);
  if (!authCheck.ok) return authCheck.response;

  let body: Partial<SelfPasswordChangeRequest>;
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid JSON object");
    }
    body = parsed as Partial<SelfPasswordChangeRequest>;
  } catch {
    return NextResponse.json(
      { errorMessage: "ข้อมูลเปลี่ยนรหัสผ่านไม่ถูกต้อง" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (typeof body.currentPassword !== "string"
      || typeof body.newPassword !== "string"
      || typeof body.confirmPassword !== "string") {
    return NextResponse.json(
      { errorMessage: "กรุณากรอกรหัสผ่านให้ครบ" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (body.newPassword.length < 8) {
    return NextResponse.json(
      { errorMessage: "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (body.newPassword !== body.confirmPassword) {
    return NextResponse.json(
      { errorMessage: "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let reauthenticationError: unknown;
  let currentUserMetadata: Record<string, unknown> = {};
  try {
    const reauthenticated = await authCheck.supabase.auth.signInWithPassword({
      phone: normalizeThaiPhoneToE164(authCheck.auth.phone),
      password: body.currentPassword,
    });
    reauthenticationError = reauthenticated.error;
    currentUserMetadata = reauthenticated.data.user?.user_metadata ?? {};
  } catch {
    return NextResponse.json(
      { errorMessage: "ระบบยืนยันรหัสผ่านชั่วคราวไม่พร้อมใช้งาน" },
      { status: 503, headers: { ...NO_STORE_HEADERS, "Retry-After": "3" } },
    );
  }
  if (reauthenticationError) {
    return NextResponse.json(
      { errorMessage: "รหัสผ่านปัจจุบันไม่ถูกต้อง" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const admin = createSupabaseAdminClient();
  let readablePasswordCleared = false;
  try {
    const cleared = await admin
      .from("profiles")
      .update({
        current_password_plaintext: null,
        current_password_auth_version: null,
      })
      .eq("id", authCheck.auth.sub)
      .select("id")
      .maybeSingle();
    readablePasswordCleared = cleared.error === null && cleared.data !== null;
  } catch {
    // The Auth password has not changed yet, so this attempt can fail safely.
  }
  if (!readablePasswordCleared) {
    return NextResponse.json(
      { errorMessage: "เตรียมเปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองใหม่" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  let changeError: unknown;
  const passwordVersion = crypto.randomUUID();
  try {
    const changed = await authCheck.supabase.auth.updateUser({
      password: body.newPassword,
      data: {
        ...currentUserMetadata,
        lanflow_password_copy_version: passwordVersion,
      },
    });
    changeError = changed.error;
  } catch {
    return NextResponse.json(
      { errorMessage: "ไม่สามารถยืนยันผลการเปลี่ยนรหัสผ่าน กรุณาลองเข้าสู่ระบบด้วยรหัสใหม่ก่อน" },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }
  if (changeError) {
    return NextResponse.json(
      { errorMessage: "เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองใหม่" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let readablePasswordAvailable = false;
  try {
    const stored = await admin
      .from("profiles")
      .update({
        current_password_plaintext: body.newPassword,
        current_password_auth_version: passwordVersion,
      })
      .eq("id", authCheck.auth.sub)
      .select("id")
      .maybeSingle();
    readablePasswordAvailable = stored.error === null && stored.data !== null;
  } catch {
    // Auth already changed. Keep the response successful so the client does not retry with stale credentials.
  }
  const response: SelfPasswordChangeResponse = {
    success: true,
    readablePasswordAvailable,
  };
  return NextResponse.json(response, { headers: NO_STORE_HEADERS });
}
