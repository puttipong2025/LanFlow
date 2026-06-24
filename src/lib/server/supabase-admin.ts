import { createClient } from "@supabase/supabase-js";
import { getSupabaseUrl } from "@/lib/supabase/config";

export function createSupabaseAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey) {
    throw new Error("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  return createClient(getSupabaseUrl(), secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

