import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Paths that don't require authentication
const PUBLIC_PATHS = ["/login", "/api/auth", "/offline.html", "/manifest.json", "/sw.js", "/icons"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname.startsWith(path));
}

function isStaticAsset(pathname: string): boolean {
  return pathname.startsWith("/_next/") || pathname.startsWith("/swe-worker") || pathname.startsWith("/fallback") || pathname.startsWith("/workbox");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths and static assets
  if (isPublicPath(pathname) || isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  // For API routes (non-auth): pass through in Phase 1
  // They still use service_role, auth enforcement comes in Phase 2
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // For page routes: check for auth token
  // Try cookie first, then check if token exists in a custom header
  const tokenFromCookie = request.cookies.get("lanflow-token")?.value;

  // On server-side, we can also check Authorization header
  const tokenFromHeader = request.headers.get("authorization")?.replace("Bearer ", "");

  const token = tokenFromCookie || tokenFromHeader;

  if (!token) {
    // No token found — redirect to login
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Verify JWT
  try {
    const secret = new TextEncoder().encode(process.env.LANFLOW_JWT_SECRET || "");
    await jwtVerify(token, secret, { issuer: "lanflow" });
    return NextResponse.next();
  } catch {
    // Invalid or expired token
    const loginUrl = new URL("/login", request.url);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete("lanflow-token");
    return response;
  }
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico
     * - public files (icons, manifest, sw)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|icons|manifest\\.json|sw\\.js|swe-worker|workbox|fallback|offline\\.html).*)",
  ],
};
