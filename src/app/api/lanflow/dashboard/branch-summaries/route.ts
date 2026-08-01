import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/server/auth";
import type { DashboardBranchSummary } from "@/types/dashboard";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  const { data, error } = await result.supabase.rpc(
    "get_dashboard_branch_summaries",
  );
  if (error) {
    console.error("Dashboard branch summaries error:", error.message);
    return NextResponse.json(
      { error: "โหลดสรุปภาพรวมสาขาไม่สำเร็จ" },
      { status: 500 },
    );
  }

  return NextResponse.json((data ?? []) as DashboardBranchSummary[], {
    headers: NO_STORE_HEADERS,
  });
}
