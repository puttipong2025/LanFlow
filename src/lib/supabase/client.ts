"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/config";
import { abortableFetch } from "@/lib/network-abort";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function createSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(
      getSupabaseUrl(),
      getSupabasePublishableKey(),
      {
        isSingleton: true,
        global: {
          fetch: abortableFetch,
        },
      }
    );
  }

  return browserClient;
}
