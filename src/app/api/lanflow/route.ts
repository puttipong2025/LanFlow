import { NextResponse } from "next/server";
import { getLanFlowData } from "@/lib/server/lanflow-db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getLanFlowData();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
