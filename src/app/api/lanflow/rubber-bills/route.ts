import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    
    // Check session
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ status: "failed", errorMessage: "Unauthorized" }, { status: 401 });
    }

    const raw = await request.text();
    if (!raw) {
      return NextResponse.json({ status: "failed", errorMessage: "Empty sync payload" }, { status: 400 });
    }

    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return NextResponse.json({ status: "failed", errorMessage: "Invalid JSON payload" }, { status: 400 });
    }

    // The RPC sync_rubber_bill is executed with the user's session
    const { data, error } = await supabase.rpc("sync_rubber_bill", { payload });

    if (error) {
      console.error("RPC Error:", error);
      return NextResponse.json({ status: "failed", errorMessage: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ status: "failed", errorMessage: "No response from RPC" }, { status: 500 });
    }

    // data contains { status, id, serverBillNo, revisionNo, serverReceivedAt, errorMessage }
    const status = data.status || "failed";
    
    if (status === "failed") {
      return NextResponse.json(data, { status: 400 });
    } else if (status === "conflict") {
      return NextResponse.json(data, { status: 409 });
    }

    return NextResponse.json(data, { status: 200 });

  } catch (err: any) {
    console.error("Sync API Error:", err);
    return NextResponse.json({ status: "failed", errorMessage: err.message || "Unknown error" }, { status: 500 });
  }
}
