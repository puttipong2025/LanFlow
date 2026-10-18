import { NextRequest } from "next/server";
import { thresholdAlertGroupRoutes } from "@/lib/server/threshold-alert-group-routes";

export const dynamic = "force-dynamic";
const routes = thresholdAlertGroupRoutes("weight");
export async function GET(request: NextRequest) {
  return routes.GET(request);
}
export async function POST(request: NextRequest) {
  return routes.POST(request);
}
