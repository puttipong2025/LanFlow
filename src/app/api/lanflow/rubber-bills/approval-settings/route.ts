import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";

export async function PUT(request: NextRequest) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return authCheck.response;

  try {
    const body = await request.json();
    const editWindowMinutes = Number(body?.editWindowMinutes);
    const configuredPrice =
      body?.configuredPrice === null || body?.configuredPrice === ""
        ? null
        : Number(body?.configuredPrice);

    if (!Number.isInteger(editWindowMinutes) || editWindowMinutes < 0) {
      return NextResponse.json(
        { errorMessage: "จำนวนนาทีต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป" },
        { status: 400 }
      );
    }

    if (
      configuredPrice !== null &&
      (!Number.isFinite(configuredPrice) ||
        configuredPrice <= 0 ||
        Math.round(configuredPrice * 100) !== configuredPrice * 100)
    ) {
      return NextResponse.json(
        { errorMessage: "ราคายางต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง" },
        { status: 400 }
      );
    }

    const { data, error } = await authCheck.supabase.rpc(
      "save_rubber_bill_approval_settings",
      {
        p_edit_window_minutes: editWindowMinutes,
        p_configured_price: configuredPrice,
      }
    );

    if (error) {
      return NextResponse.json({ errorMessage: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { errorMessage: error instanceof Error ? error.message : "บันทึกการตั้งค่าไม่สำเร็จ" },
      { status: 500 }
    );
  }
}
