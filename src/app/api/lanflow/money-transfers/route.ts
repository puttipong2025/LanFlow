import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { getMoneyTransfers, saveMoneyTransfer, deleteMoneyTransfer, getUsedSourceIds } from "@/lib/server/lanflow-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  try {
    const locationId = request.nextUrl.searchParams.get("locationId");
    if (!locationId) {
      return NextResponse.json({ error: "locationId is required" }, { status: 400 });
    }

    const includeUsedIds = request.nextUrl.searchParams.get("includeUsedIds") === "true";

    const transfers = await getMoneyTransfers(result.supabase, locationId);

    if (includeUsedIds) {
      const usedIds = await getUsedSourceIds(result.supabase);
      return NextResponse.json({ transfers, usedSourceIds: Array.from(usedIds) });
    }

    return NextResponse.json(transfers);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  try {
    const input = await request.json();
    const body = {
      ...input,
      createdByUserId: result.auth.sub,
      createdByName: result.auth.name,
      createdByPhone: result.auth.phone
    };
    const saved = await saveMoneyTransfer(result.supabase, body, result.auth.sub);
    return NextResponse.json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
