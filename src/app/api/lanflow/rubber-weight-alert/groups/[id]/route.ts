import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import {
  isUuid,
  managementAuthFailure,
  managementErrorResponse,
} from "@/lib/server/management-route-error";
import { parseRubberWeightAlertGroupBody } from "@/lib/server/rubber-weight-alert-groups";

export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
type RouteContext = { params: Promise<{ id: string }> };

function groupErrorResponse(error: { message?: string } | null, fallback: string) {
  const response = managementErrorResponse(error, fallback);
  response.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
  return response;
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ errorMessage: "รหัสกลุ่มไม่ถูกต้อง" }, { status: 400, headers: NO_STORE_HEADERS });
  try {
    const parsed = parseRubberWeightAlertGroupBody(await request.json());
    if ("errorMessage" in parsed) {
      return NextResponse.json({ errorMessage: parsed.errorMessage }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const { data, error } = await authCheck.supabase.rpc("update_rubber_weight_alert_group", {
      p_group_id: id,
      p_location_ids: parsed.value.locationIds,
      p_threshold_kg: parsed.value.thresholdKg,
    });
    if (error) return groupErrorResponse(error, "แก้ไขกลุ่มไม่สำเร็จ");
    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ errorMessage: "ข้อมูลกลุ่มไม่ถูกต้อง" }, { status: 400, headers: NO_STORE_HEADERS });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ errorMessage: "รหัสกลุ่มไม่ถูกต้อง" }, { status: 400, headers: NO_STORE_HEADERS });
  const { data, error } = await authCheck.supabase.rpc("delete_rubber_weight_alert_group", {
    p_group_id: id,
  });
  if (error) return groupErrorResponse(error, "ลบกลุ่มไม่สำเร็จ");
  return NextResponse.json(data, { headers: NO_STORE_HEADERS });
}
