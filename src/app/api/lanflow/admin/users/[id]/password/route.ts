import { NextRequest, NextResponse } from "next/server";

import {
  requireCurrentSessionActive,
  requireRole,
  requireSystemManager,
} from "@/lib/server/auth";
import {
  isUuid,
  managementAuthFailure,
  managementErrorResponse,
} from "@/lib/server/management-route-error";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import type {
  AdminPasswordAuditStatus,
  AdminPasswordResetRequest,
  AdminPasswordResetResponse,
} from "@/types";

type RouteContext = { params: Promise<{ id: string }> };
type BeginResult = { auditId: string; status: AdminPasswordAuditStatus; created: boolean };

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

type CurrentPasswordLookup =
  | { status: "available"; password: string }
  | { status: "unavailable" | "not_found" | "error" };

async function lookupCurrentPassword(userId: string): Promise<CurrentPasswordLookup> {
  try {
    const admin = createSupabaseAdminClient();
    const [profile, authUser] = await Promise.all([
      admin
        .from("profiles")
        .select("current_password_plaintext, current_password_auth_version")
        .eq("id", userId)
        .maybeSingle(),
      admin.auth.admin.getUserById(userId),
    ]);
    if (profile.error || authUser.error) return { status: "error" };
    if (!profile.data || !authUser.data.user) return { status: "not_found" };

    const password = profile.data.current_password_plaintext;
    const storedAuthVersion = profile.data.current_password_auth_version;
    if (typeof password === "string"
        && typeof storedAuthVersion === "string"
        && storedAuthVersion === authUser.data.user.user_metadata?.lanflow_password_copy_version) {
      return { status: "available", password };
    }

    if (password !== null || storedAuthVersion !== null) {
      let clear = admin
        .from("profiles")
        .update({
          current_password_plaintext: null,
          current_password_auth_version: null,
        })
        .eq("id", userId);
      clear = typeof storedAuthVersion === "string"
        ? clear.eq("current_password_auth_version", storedAuthVersion)
        : clear.is("current_password_auth_version", null);
      await clear;
    }
    return { status: "unavailable" };
  } catch {
    return { status: "error" };
  }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const authCheck = await requireRole(request, ["super_admin"]);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const sessionFailure = await requireCurrentSessionActive(authCheck.supabase);
  if (sessionFailure) return sessionFailure;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json(
      { errorMessage: "รหัสพนักงานไม่ถูกต้อง" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const current = await lookupCurrentPassword(id);
  if (current.status === "error") {
    return NextResponse.json(
      { errorMessage: "โหลดรหัสผ่านปัจจุบันไม่สำเร็จ" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
  if (current.status === "not_found") {
    return NextResponse.json(
      { errorMessage: "ไม่พบบัญชีพนักงาน" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    current.status === "available"
      ? { available: true, password: current.password }
      : { available: false },
    { headers: NO_STORE_HEADERS },
  );
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const sessionFailure = await requireCurrentSessionActive(authCheck.supabase);
  if (sessionFailure) return sessionFailure;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ errorMessage: "รหัสพนักงานไม่ถูกต้อง" }, { status: 400 });

  let body: Partial<AdminPasswordResetRequest>;
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid JSON object");
    }
    body = parsed as Partial<AdminPasswordResetRequest>;
  } catch {
    return NextResponse.json({ errorMessage: "ข้อมูลรีเซ็ตรหัสผ่านไม่ถูกต้อง" }, { status: 400 });
  }
  if (typeof body.newPassword !== "string"
      || typeof body.confirmPassword !== "string"
      || !isUuid(body.requestId)) {
    return NextResponse.json({ errorMessage: "ข้อมูลรีเซ็ตรหัสผ่านไม่ถูกต้อง" }, { status: 400 });
  }
  if (body.newPassword !== body.confirmPassword) {
    return NextResponse.json({ errorMessage: "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน" }, { status: 400 });
  }
  if (body.newPassword.length < 8) {
    return NextResponse.json({ errorMessage: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" }, { status: 400 });
  }

  const begun = await authCheck.supabase.rpc("begin_admin_password_reset", {
    p_target_user_id: id,
    p_request_id: body.requestId,
  });
  if (begun.error) return managementErrorResponse(begun.error, "เริ่มรีเซ็ตรหัสผ่านไม่สำเร็จ");
  const audit = begun.data as BeginResult;
  if (!audit.created) {
    if (audit.status === "succeeded") {
      const current = await lookupCurrentPassword(id);
      const response: AdminPasswordResetResponse = {
        success: true,
        auditStatus: "succeeded",
        readablePasswordAvailable: current.status === "available",
      };
      return NextResponse.json(response);
    }
    return NextResponse.json(
      { errorMessage: "คำขอนี้ยังไม่ยืนยันผลสำเร็จ กรุณาตรวจสอบและสร้างคำขอใหม่" },
      { status: 409 },
    );
  }

  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return NextResponse.json(
      { errorMessage: "ไม่สามารถยืนยันผลการรีเซ็ตรหัสผ่าน กรุณาตรวจสอบก่อนทำรายการใหม่" },
      { status: 409 },
    );
  }

  let readablePasswordCleared = false;
  try {
    const cleared = await admin
      .from("profiles")
      .update({
        current_password_plaintext: null,
        current_password_auth_version: null,
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    readablePasswordCleared = cleared.error === null && cleared.data !== null;
  } catch {
    // Complete the audit as failed below; Auth has not changed yet.
  }
  if (!readablePasswordCleared) {
    try {
      await admin.rpc("complete_admin_password_reset", {
        p_audit_id: audit.auditId,
        p_status: "failed",
        p_error_code: "readable_password_clear_failed",
      });
    } catch {
      // The audit remains pending and replay is blocked until manually reviewed.
    }
    return NextResponse.json({ errorMessage: "เตรียมรีเซ็ตรหัสผ่านไม่สำเร็จ" }, { status: 500 });
  }

  const passwordVersion = crypto.randomUUID();
  try {
    const currentAuth = await admin.auth.admin.getUserById(id);
    if (currentAuth.error || !currentAuth.data.user) {
      try {
        await admin.rpc("complete_admin_password_reset", {
          p_audit_id: audit.auditId,
          p_status: "failed",
          p_error_code: "auth_user_lookup_failed",
        });
      } catch {
        // The audit remains pending and replay is blocked until manually reviewed.
      }
      return NextResponse.json({ errorMessage: "รีเซ็ตรหัสผ่านไม่สำเร็จ" }, { status: 400 });
    }
    const changed = await admin.auth.admin.updateUserById(id, {
      password: body.newPassword,
      user_metadata: {
        ...currentAuth.data.user.user_metadata,
        lanflow_password_copy_version: passwordVersion,
      },
    });
    if (changed.error) {
      try {
        await admin.rpc("complete_admin_password_reset", {
          p_audit_id: audit.auditId,
          p_status: "failed",
          p_error_code: "auth_rejected",
        });
      } catch {
        // The audit remains pending and replay is blocked until manually reviewed.
      }
      return NextResponse.json({ errorMessage: "รีเซ็ตรหัสผ่านไม่สำเร็จ" }, { status: 400 });
    }
  } catch {
    try {
      await admin.rpc("complete_admin_password_reset", {
        p_audit_id: audit.auditId,
        p_status: "unknown",
        p_error_code: "auth_result_unknown",
      });
    } catch {
      // The audit remains pending and replay is blocked until manually reviewed.
    }
    return NextResponse.json(
      { errorMessage: "ไม่สามารถยืนยันผลการรีเซ็ตรหัสผ่าน กรุณาตรวจสอบก่อนทำรายการใหม่" },
      { status: 409 },
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
      .eq("id", id)
      .select("id")
      .maybeSingle();
    readablePasswordAvailable = stored.error === null && stored.data !== null;
  } catch {
    // Auth already changed. Keep the response successful so the client does not repeat the reset.
  }

  let auditStatus: AdminPasswordResetResponse["auditStatus"] = "pending";
  try {
    const completed = await admin.rpc("complete_admin_password_reset", {
      p_audit_id: audit.auditId,
      p_status: "succeeded",
      p_error_code: null,
    });
    if (!completed.error) auditStatus = "succeeded";
  } catch {
    // Auth succeeded but the audit write is ambiguous; do not ask the client to retry the password change.
  }
  const response: AdminPasswordResetResponse = {
    success: true,
    auditStatus,
    readablePasswordAvailable,
  };
  return NextResponse.json(response);
}
