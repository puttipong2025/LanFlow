import { NextRequest } from "next/server";
import { thresholdAlertGroupRoutes } from "@/lib/server/threshold-alert-group-routes";

export const dynamic = "force-dynamic";
const routes = thresholdAlertGroupRoutes("cash");
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return routes.PUT(request, context);
}
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return routes.DELETE(request, context);
}
