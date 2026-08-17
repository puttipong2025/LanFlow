import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import {
  formatDashboardAlertDigest,
  formatTelegramBadgeDigest,
  formatWeightEvidenceDigest,
  type DashboardTelegramAlert,
  type TelegramBadgeCount,
  type TelegramBadgeKey,
  type WeightEvidenceDigestBill,
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

type DashboardAlertRow = {
  location_id: string;
  branch_name: string;
  alert_key: string;
  metric_label: string;
  current_value: number;
  minimum_value: number;
  unit: string;
  detail: string;
};

type EvidenceDigestRow = {
  location_id: string;
  branch_name: string;
  bill_id: string;
  bill_recorded_at: string;
  weigh_row_count: number;
  manual_correction_count: number;
  digest_kind: "incomplete" | "corrected";
};

type DispatchResult = {
  status: string;
  messageCount?: number;
  error?: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function sendMessages(
  credentials: DeliveryCredentials,
  messages: string[],
) {
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
}

async function deliveryCredentials(
  supabase: ReturnType<typeof createClient>,
) {
  const { data, error } = await supabase.rpc(
    "get_telegram_badge_delivery_credentials",
  );
  if (error) throw new Error("credentials_failed");
  return data as DeliveryCredentials;
}

async function dispatchBadges(
  supabase: ReturnType<typeof createClient>,
): Promise<DispatchResult> {
  const { data: claimData, error: claimError } = await supabase.rpc(
    "claim_telegram_badge_dispatch",
  );
  if (claimError) return { status: "failed", error: "badge_claim_failed" };
  const claim = claimData as ClaimResult;
  if (!claim.claimed || !claim.claimToken) {
    return { status: "not_due" };
  }

  try {
    const [countResult, dashboardResult] = await Promise.all([
      supabase.rpc("get_telegram_badge_counts"),
      supabase.rpc("get_dashboard_alerts_for_telegram"),
    ]);
    if (countResult.error) throw new Error("count_failed");
    if (dashboardResult.error) throw new Error("dashboard_alert_failed");

    const counts: TelegramBadgeCount[] = (countResult.data as BadgeCountRow[])
      .map((row) => ({
        key: row.badge_key,
        locationId: row.location_id,
        locationName: row.branch_name,
        moduleLabel: row.module_name,
        statusLabel: row.status_label,
        count: Number(row.item_count),
        sortOrder: row.sort_order,
      }));
    const dashboardAlerts: DashboardTelegramAlert[] = (
      dashboardResult.data as DashboardAlertRow[]
    ).map((row) => ({
      locationId: row.location_id,
      locationName: row.branch_name,
      key: row.alert_key,
      label: row.metric_label,
      currentValue: Number(row.current_value),
      minimumValue: Number(row.minimum_value),
      unit: row.unit,
      detail: row.detail,
    }));
    const messages = [
      ...formatTelegramBadgeDigest(counts),
      ...formatDashboardAlertDigest(dashboardAlerts),
    ];
    if (messages.length > 0) {
      await sendMessages(await deliveryCredentials(supabase), messages);
    }

    const { error } = await supabase.rpc("complete_telegram_badge_dispatch", {
      p_claim_token: claim.claimToken,
      p_outcome: messages.length === 0 ? "no_items" : "sent",
      p_error: null,
    });
    if (error) throw new Error("complete_failed");
    return {
      status: messages.length === 0 ? "no_items" : "sent",
      messageCount: messages.length,
    };
  } catch (error) {
    const safeError = error instanceof Error
      ? error.message.slice(0, 120)
      : "badge_dispatch_failed";
    await supabase.rpc("complete_telegram_badge_dispatch", {
      p_claim_token: claim.claimToken,
      p_outcome: "failed",
      p_error: safeError,
    });
    return { status: "failed", error: "badge_dispatch_failed" };
  }
}

async function dispatchEvidence(
  supabase: ReturnType<typeof createClient>,
): Promise<DispatchResult> {
  const { data: claimData, error: claimError } = await supabase.rpc(
    "claim_telegram_evidence_dispatch",
  );
  if (claimError) return { status: "failed", error: "evidence_claim_failed" };
  const claim = claimData as ClaimResult;
  if (!claim.claimed || !claim.claimToken) return { status: "not_due" };

  try {
    const { data, error } = await supabase.rpc("get_weight_evidence_digest");
    if (error) throw new Error("evidence_count_failed");
    const bills: WeightEvidenceDigestBill[] = (
      data as EvidenceDigestRow[]
    ).map((row) => ({
      locationId: row.location_id,
      locationName: row.branch_name,
      billId: row.bill_id,
      billRecordedAt: row.bill_recorded_at,
      weighRowCount: Number(row.weigh_row_count),
      manualCorrectionCount: Number(row.manual_correction_count),
      digestKind: row.digest_kind,
    }));
    const generatedAt = new Date();
    const messages = formatWeightEvidenceDigest(bills, generatedAt);

    if (messages.length > 0) {
      const { data: stillEnabled, error: enabledError } = await supabase.rpc(
        "is_telegram_evidence_dispatch_enabled",
      );
      if (enabledError) throw new Error("evidence_toggle_check_failed");
      if (stillEnabled !== true) {
        const { error: completeError } = await supabase.rpc(
          "complete_telegram_evidence_dispatch",
          { p_claim_token: claim.claimToken },
        );
        if (completeError) throw new Error("evidence_complete_failed");
        return { status: "disabled" };
      }
      await sendMessages(await deliveryCredentials(supabase), messages);
    }

    const { error: completeError } = await supabase.rpc(
      "complete_telegram_evidence_dispatch",
      { p_claim_token: claim.claimToken },
    );
    if (completeError) throw new Error("evidence_complete_failed");
    return {
      status: messages.length === 0 ? "no_items" : "sent",
      messageCount: messages.length,
    };
  } catch {
    await supabase.rpc("complete_telegram_evidence_dispatch", {
      p_claim_token: claim.claimToken,
    });
    return { status: "failed", error: "evidence_dispatch_failed" };
  }
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

  const [badge, evidence] = await Promise.all([
    dispatchBadges(supabase),
    dispatchEvidence(supabase),
  ]);
  const failed = badge.status === "failed" && evidence.status === "failed";
  return jsonResponse({ badge, evidence }, failed ? 502 : 200);
});
