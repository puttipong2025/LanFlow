import { NextResponse, type NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/login" || pathname.startsWith("/_next/")) {
    return NextResponse.next();
  }

  const { response, claims } = await refreshSupabaseSession(request);

  if (
    !claims &&
    !pathname.startsWith("/api/")
  ) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|icons|fonts|manifest\\.json|sw\\.js|swe-worker|workbox|fallback|offline\\.html).*)"
  ]
};
