declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

type DashboardRefreshSnapshot = {
  status: "dirty" | "queued" | "running" | "ready" | "failed";
  sourceVersion: number;
  snapshotVersion: number;
  requestedVersion?: number;
  claimedVersion?: number | null;
};

type RpcClient = {
  rpc<T>(name: string, body: Record<string, unknown>): Promise<T>;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function version(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function endpoint(baseUrl: string, path: string) {
  return baseUrl.replace(/\/+$/, "") + path;
}

function authHeaders(anonKey: string, authorization: string) {
  return {
    apikey: anonKey,
    authorization,
    "content-type": "application/json",
  };
}

async function isAuthenticated(
  supabaseUrl: string,
  anonKey: string,
  authorization: string,
) {
  const response = await fetch(endpoint(supabaseUrl, "/auth/v1/user"), {
    headers: authHeaders(anonKey, authorization),
  });
  return response.ok;
}

function createRpcClient(
  supabaseUrl: string,
  anonKey: string,
  authorization: string,
): RpcClient {
  const headers = authHeaders(anonKey, authorization);
  return {
    async rpc<T>(name: string, body: Record<string, unknown>) {
      const response = await fetch(
        endpoint(supabaseUrl, "/rest/v1/rpc/" + encodeURIComponent(name)),
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        throw new Error("dashboard_rpc_failed");
      }
      return await response.json() as T;
    },
  };
}

async function processRefresh(
  client: RpcClient,
  locationId: string,
  requestedVersion: number,
) {
  // Two passes cover the only legitimate hand-off case: a request arrives
  // while an older claim is finishing, then the requested version is claimed.
  for (let pass = 0; pass < 2; pass += 1) {
    const claim = await client.rpc<DashboardRefreshSnapshot>(
      "claim_dashboard_refresh_now",
      {
        p_location_id: locationId,
        p_requested_version: requestedVersion,
      },
    );
    if (Number(claim.snapshotVersion) >= requestedVersion) return;
    if (claim.status === "failed") return;

    const claimedVersion = version(claim.claimedVersion);
    if (!claimedVersion) throw new Error("dashboard_claim_missing");

    const rebuilt = await client.rpc<DashboardRefreshSnapshot>(
      "rebuild_dashboard_refresh_now",
      {
        p_location_id: locationId,
        p_claimed_version: claimedVersion,
      },
    );
    if (
      Number(rebuilt.snapshotVersion) >= requestedVersion ||
      rebuilt.status === "failed"
    ) {
      return;
    }
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = request.headers.get("authorization");
  if (!supabaseUrl || !anonKey || !authorization) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const body = (await request.json().catch(() => null)) as {
    locationId?: unknown;
  } | null;
  if (typeof body?.locationId !== "string") {
    return jsonResponse({ error: "invalid_location" }, 400);
  }

  if (!await isAuthenticated(supabaseUrl, anonKey, authorization)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const client = createRpcClient(supabaseUrl, anonKey, authorization);
  let queued: DashboardRefreshSnapshot;
  try {
    queued = await client.rpc<DashboardRefreshSnapshot>(
      "queue_dashboard_refresh",
      { p_location_id: body.locationId },
    );
  } catch {
    return jsonResponse({ error: "refresh_forbidden" }, 403);
  }

  const requestedVersion = version(queued.requestedVersion);
  if (!requestedVersion) {
    return jsonResponse({ error: "queue_failed" }, 500);
  }

  EdgeRuntime.waitUntil(
    processRefresh(client, body.locationId, requestedVersion).catch((error) => {
      console.error(
        "Dashboard refresh background task failed:",
        error instanceof Error ? error.message : "unknown_error",
      );
    }),
  );

  return jsonResponse(queued, 202);
});
