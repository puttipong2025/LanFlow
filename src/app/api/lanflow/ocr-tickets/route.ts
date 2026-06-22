import { NextRequest, NextResponse } from "next/server";
import { getOcrTickets, saveOcrTicket } from "@/lib/server/lanflow-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const locationId = request.nextUrl.searchParams.get("locationId");
    if (!locationId) {
      return NextResponse.json({ error: "locationId is required" }, { status: 400 });
    }
    const data = await getOcrTickets(locationId);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const saved = await saveOcrTicket(body);
    return NextResponse.json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
