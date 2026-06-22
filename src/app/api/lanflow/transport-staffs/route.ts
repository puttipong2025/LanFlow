import { NextRequest, NextResponse } from "next/server";
import { saveTransportStaff, getTransportStaffsPaginated } from "@/lib/server/lanflow-db";
import type { TransportStaff } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "50", 10);
    
    const result = await getTransportStaffsPaginated(page, pageSize);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const staff = await request.json() as TransportStaff;
    const saved = await saveTransportStaff(staff);
    return NextResponse.json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    const status = message.startsWith("Validation Error") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
