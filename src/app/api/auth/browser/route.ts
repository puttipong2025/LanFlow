import { browserApprovalResponse } from "@/lib/server/browser-approval";

export async function GET(request: Request) { return browserApprovalResponse(request, "status"); }
export async function POST(request: Request) { return browserApprovalResponse(request, "mutation"); }
