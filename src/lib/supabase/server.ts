import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/config";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot always write cookies. Middleware refreshes them.
          }
        }
      }
    }
  );
}

// undefined means cookie auth; null means an explicitly invalid header.
export function parseBearerToken(request?: Request): string | null | undefined {
  const authorization = request?.headers.get("authorization");
  if (authorization == null) return undefined;
  return /^Bearer[ \t]+([^\s,]+)$/i.exec(authorization.trim())?.[1] ?? null;
}

export async function createSupabaseRequestClient(request?: Request) {
  const bearerToken = parseBearerToken(request);
  if (bearerToken === null) throw new Error("Invalid authorization header");
  if (bearerToken !== undefined) {
    return createClient(getSupabaseUrl(), getSupabasePublishableKey(), {
      global: { headers: { Authorization: `Bearer ${bearerToken}` } },
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
  }
  return createSupabaseServerClient();
}
