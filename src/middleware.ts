import { NextResponse, type NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = [
  "/login",
  "/offline.html",
  "/manifest.json",
  "/sw.js",
  "/icons"
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname.startsWith(path));
}

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/swe-worker") ||
    pathname.startsWith("/fallback") ||
    pathname.startsWith("/workbox")
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  const { response, claims } = await refreshSupabaseSession(request);

  if (
    !claims &&
    !isPublicPath(pathname) &&
    !pathname.startsWith("/api/")
  ) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icons|manifest\\.json|sw\\.js|swe-worker|workbox|fallback|offline\\.html).*)"
  ]
};
