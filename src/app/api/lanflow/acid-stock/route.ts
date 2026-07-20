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

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ status: "failed", errorMessage: "Invalid JSON payload" }, { status: 400 });
    }

    const action = (payload as { action?: string }).action;
    if (action === "create_product") {
      const approvalPayload = {
        ...(payload as Record<string, unknown>),
        requestType: "create_product",
      };
      const { data, error } = await supabase.rpc(
        "create_stock_product_approval_request",
        { payload: approvalPayload }
      );

      if (error) {
        console.error("create_stock_product_approval_request error:", error);
        return NextResponse.json({ status: "failed", errorMessage: error.message }, { status: 500 });
      }

      const status = (data as Record<string, unknown> | null)?.status || "failed";
      if (status === "pending") {
        return NextResponse.json(data, { status: 200 });
      }
      return NextResponse.json(data || { status: "failed", errorMessage: "No response from RPC" }, { status: 400 });
    }

    const rpcName =
      action === "transfer"
          ? "transfer_stock"
          : "sync_stock_entry";
    const { data, error } = await supabase.rpc(rpcName, { payload });

    if (error) {
      console.error(`${rpcName} error:`, error);
      return NextResponse.json({ status: "failed", errorMessage: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ status: "failed", errorMessage: "No response from RPC" }, { status: 500 });
    }

    const status = (data as Record<string, unknown>).status || "failed";
    if (status === "synced") {
      return NextResponse.json(data, { status: 200 });
    }
    if (status === "conflict") {
      return NextResponse.json(data, { status: 409 });
    }

    return NextResponse.json(data, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Stock API error:", message);
    return NextResponse.json({ status: "failed", errorMessage: message }, { status: 500 });
  }
}
