import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
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

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ errorMessage: "รหัสพนักงานไม่ถูกต้อง" }, { status: 400 });

  let body: Partial<AdminPasswordResetRequest>;
  try {
    body = await request.json() as Partial<AdminPasswordResetRequest>;
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
      const response: AdminPasswordResetResponse = {
        success: true,
        auditStatus: "succeeded",
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

  try {
    const changed = await admin.auth.admin.updateUserById(id, { password: body.newPassword });
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
  };
  return NextResponse.json(response);
}
