import { NextRequest, NextResponse } from "next/server";
import { requireSystemManager } from "@/lib/server/auth";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BRANCH_CODE = /^[A-Z0-9]{2,8}$/;

type ProvisionLocationResult = {
  location: {
    id: string;
    name: string;
    code: string;
    active: boolean;
  };
  replayed: boolean;
};

export async function POST(request: NextRequest) {
  const adminCheck = await requireSystemManager(request);
  if (!adminCheck.ok) return adminCheck.response;

  try {
    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      code?: unknown;
      requestId?: unknown;
    } | null;
    const name =
      typeof body?.name === "string"
        ? body.name.trim().replace(/\s+/g, " ")
        : "";
    const code =
      typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
    const requestId = body?.requestId;

    if (!name || name.length > 100) {
      return NextResponse.json(
        { error: "กรุณากรอกชื่อสาขาไม่เกิน 100 ตัวอักษร" },
        { status: 400 },
      );
    }
    if (!BRANCH_CODE.test(code)) {
      return NextResponse.json(
        { error: "รหัสสาขาต้องเป็น A–Z หรือ 0–9 จำนวน 2–8 ตัว" },
        { status: 400 },
      );
    }
    if (typeof requestId !== "string" || !UUID.test(requestId)) {
      return NextResponse.json(
        { error: "รหัสคำขอเพิ่มสาขาไม่ถูกต้อง" },
        { status: 400 },
      );
    }

    const { data, error } = await adminCheck.supabase.rpc("provision_location", {
      p_request_id: requestId,
      p_name: name,
      p_code: code,
    });
    if (error) {
      console.error("Provision location error:", {
        code: error.code,
        message: error.message,
      });
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "ชื่อหรือรหัสสาขานี้ถูกใช้แล้ว" },
          { status: 409 },
        );
      }
      if (error.message.includes("BRANCH_IDEMPOTENCY_CONFLICT")) {
        return NextResponse.json(
          { error: "คำขอนี้ถูกใช้กับชื่อหรือรหัสสาขาอื่นแล้ว" },
          { status: 409 },
        );
      }
      if (error.code === "42501" || error.message.includes("BRANCH_FORBIDDEN")) {
        return NextResponse.json(
          { error: "ไม่มีสิทธิ์เพิ่มสาขา" },
          { status: 403 },
        );
      }
      if (error.code === "22023" || error.message.includes("INVALID")) {
        return NextResponse.json(
          { error: "ชื่อ รหัสสาขา หรือรหัสคำขอไม่ถูกต้อง" },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: "เพิ่มสาขาไม่สำเร็จ" },
        { status: 500 },
      );
    }

    const result = data as ProvisionLocationResult | null;
    if (!result?.location) {
      return NextResponse.json(
        { error: "เพิ่มสาขาไม่สำเร็จ" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Add location error:", error);
    return NextResponse.json(
      { error: "เพิ่มสาขาไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
