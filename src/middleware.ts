import { NextResponse, type NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/login") {
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
    "/((?!_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$|icon\\.svg$|icons/icon\\.svg$|fonts/NotoSansThai-(?:Regular|Bold)\\.ttf$|fonts/NotoSansThai-OFL\\.txt$|manifest\\.json$|sw\\.js$|swe-worker-[0-9a-f]{16}\\.js$|workbox-[0-9a-f]{8}\\.js$|offline\\.html$).*)"
  ]
};
