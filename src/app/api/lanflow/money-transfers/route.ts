import { NextRequest, NextResponse } from "next/server";
import { getMoneyTransfers, saveMoneyTransfer, deleteMoneyTransfer, getUsedSourceIds } from "@/lib/server/lanflow-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const locationId = request.nextUrl.searchParams.get("locationId");
    if (!locationId) {
      return NextResponse.json({ error: "locationId is required" }, { status: 400 });
    }

    const includeUsedIds = request.nextUrl.searchParams.get("includeUsedIds") === "true";

    const transfers = await getMoneyTransfers(locationId);

    if (includeUsedIds) {
      const usedIds = await getUsedSourceIds();
      return NextResponse.json({ transfers, usedSourceIds: Array.from(usedIds) });
    }

    return NextResponse.json(transfers);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const saved = await saveMoneyTransfer(body);
    return NextResponse.json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
