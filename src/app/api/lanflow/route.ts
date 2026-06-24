import { NextRequest, NextResponse } from "next/server";
import { getLanFlowData } from "@/lib/server/lanflow-db";
import { requireAuth } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  try {
    const data = await getLanFlowData(result.supabase, result.auth.sub);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
