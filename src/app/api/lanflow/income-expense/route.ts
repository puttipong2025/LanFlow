import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ status: "failed", errorMessage: "Unauthorized" }, { status: 401 });
    }

    const raw = await request.text();
    if (!raw) {
      return NextResponse.json({ status: "failed", errorMessage: "Empty sync payload" }, { status: 400 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return NextResponse.json({ status: "failed", errorMessage: "Invalid JSON payload" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("sync_income_expense", { payload });

    if (error) {
      console.error("RPC sync_income_expense error:", error);
      return NextResponse.json({ status: "failed", errorMessage: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ status: "failed", errorMessage: "No response from RPC" }, { status: 500 });
    }

    const status = (data as Record<string, unknown>).status || "failed";

    if (status === "synced") {
      return NextResponse.json(data, { status: 200 });
    } else if (status === "failed") {
      return NextResponse.json(data, { status: 400 });
    } else if (status === "conflict") {
      return NextResponse.json(data, { status: 409 });
    }

    return NextResponse.json(
      { status: "failed", errorMessage: `Unexpected RPC status: ${String(status)}` },
      { status: 500 }
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Sync income-expense API error:", message);
    return NextResponse.json({ status: "failed", errorMessage: message }, { status: 500 });
  }
}
