import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import {
  managementAuthFailure,
  managementErrorResponse,
} from "@/lib/server/management-route-error";
import { parseRubberWeightAlertGroupBody } from "@/lib/server/rubber-weight-alert-groups";

export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function groupErrorResponse(error: { message?: string } | null, fallback: string) {
  const response = managementErrorResponse(error, fallback);
  response.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
  return response;
}

export async function GET(request: NextRequest) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const { data, error } = await authCheck.supabase.rpc("list_rubber_weight_alert_groups");
  if (error) return groupErrorResponse(error, "โหลดกลุ่มแจ้งเตือนน้ำหนักไม่สำเร็จ");
  return NextResponse.json(data, { headers: NO_STORE_HEADERS });
}

export async function POST(request: NextRequest) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  try {
    const parsed = parseRubberWeightAlertGroupBody(await request.json());
    if ("errorMessage" in parsed) {
      return NextResponse.json({ errorMessage: parsed.errorMessage }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const { data, error } = await authCheck.supabase.rpc("create_rubber_weight_alert_group", {
      p_location_ids: parsed.value.locationIds,
      p_threshold_kg: parsed.value.thresholdKg,
    });
    if (error) return groupErrorResponse(error, "สร้างกลุ่มไม่สำเร็จ");
    return NextResponse.json(data, { status: 201, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ errorMessage: "ข้อมูลกลุ่มไม่ถูกต้อง" }, { status: 400, headers: NO_STORE_HEADERS });
  }
}
