import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import {
  formatTelegramBadgeDigest,
  type TelegramBadgeCount,
  type TelegramBadgeKey,
} from "../_shared/telegram-badge.ts";

type BadgeCountRow = {
  badge_key: TelegramBadgeKey;
  location_id: string | null;
  branch_name: string;
  module_name: string;
  status_label: string;
  item_count: number;
  sort_order: number;
};

type ClaimResult = {
  claimed: boolean;
  claimToken?: string;
};

type DeliveryCredentials = {
  botToken: string | null;
  chatId: string | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const dispatchSecret = request.headers.get("x-lanflow-dispatch-secret");
  if (!supabaseUrl || !serviceRoleKey || !dispatchSecret) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: secretIsValid, error: secretError } = await supabase.rpc(
    "verify_telegram_badge_dispatch_secret",
    { p_secret: dispatchSecret },
  );
  if (secretError || secretIsValid !== true) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const { data: claimData, error: claimError } = await supabase.rpc(
    "claim_telegram_badge_dispatch",
  );
  if (claimError) {
    return jsonResponse({ error: "claim_failed" }, 500);
  }

  const claim = claimData as ClaimResult;
  if (!claim.claimed || !claim.claimToken) {
    return jsonResponse({ status: "not_due" });
  }

  try {
    const { data: countRows, error: countError } = await supabase.rpc(
      "get_telegram_badge_counts",
    );
    if (countError) throw new Error("count_failed");

    const counts: TelegramBadgeCount[] = (countRows as BadgeCountRow[]).map(
      (row) => ({
        key: row.badge_key,
        locationId: row.location_id,
        locationName: row.branch_name,
        moduleLabel: row.module_name,
        statusLabel: row.status_label,
        count: Number(row.item_count),
        sortOrder: row.sort_order,
      }),
    );
    const messages = formatTelegramBadgeDigest(counts);

    if (messages.length === 0) {
      const { error } = await supabase.rpc(
        "complete_telegram_badge_dispatch",
        {
          p_claim_token: claim.claimToken,
          p_outcome: "no_items",
          p_error: null,
        },
      );
      if (error) throw new Error("complete_failed");
      return jsonResponse({ status: "no_items" });
    }

    const { data: credentialData, error: credentialError } = await supabase.rpc(
      "get_telegram_badge_delivery_credentials",
    );
    if (credentialError) throw new Error("credentials_failed");
    const credentials = credentialData as DeliveryCredentials;
    if (!credentials.botToken || !credentials.chatId) {
      throw new Error("credentials_missing");
    }

    for (const text of messages) {
      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${credentials.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({
            chat_id: credentials.chatId,
            text,
            disable_web_page_preview: true,
          }),
        },
      );
      if (!telegramResponse.ok) {
        throw new Error(`telegram_http_${telegramResponse.status}`);
      }
    }

    const { error: completeError } = await supabase.rpc(
      "complete_telegram_badge_dispatch",
      {
        p_claim_token: claim.claimToken,
        p_outcome: "sent",
        p_error: null,
      },
    );
    if (completeError) throw new Error("complete_failed");
    return jsonResponse({ status: "sent", messageCount: messages.length });
  } catch (error) {
    const safeError =
      error instanceof Error ? error.message.slice(0, 120) : "dispatch_failed";
    await supabase.rpc("complete_telegram_badge_dispatch", {
      p_claim_token: claim.claimToken,
      p_outcome: "failed",
      p_error: safeError,
    });
    return jsonResponse({ error: "dispatch_failed" }, 502);
  }
});
