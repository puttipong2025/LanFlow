import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const result = await requireAuth(request);
    if (!result.ok) return result.response;

    return NextResponse.json({
      profile: {
        id: result.auth.sub,
        phone: result.auth.phone,
        name: result.auth.name,
        role: result.auth.role,
        locationIds: result.auth.locationIds,
        canAccessSystemManager: result.auth.canAccessSystemManager,
        canAccessMoneyTransfer: result.auth.canAccessMoneyTransfer
      }
    });
  } catch (error) {
    console.error("Auth me error", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาด" }, { status: 500 });
  }
}
