import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";

function fixture(failure?: "claims" | "inactive" | "upstream") {
  const identities: string[] = [];
  let cookieReads = 0;
  function client(identity: string) {
    let profileId = identity;
    const query = {
      select: () => query,
      eq: (_field: string, id: string) => { profileId = id; return query; },
      maybeSingle: async () => ({ data: { id: profileId, role: "admin", is_active: failure !== "inactive" }, error: null }),
    };
    return {
      auth: { getClaims: async (token?: string) => {
        identities.push(`claims:${token ?? identity}`);
        return failure === "claims" || failure === "upstream"
          ? { data: null, error: { status: failure === "claims" ? 401 : 503 } }
          : { data: { claims: { sub: token ?? identity } }, error: null };
      } },
      from: () => query,
      rpc: async () => {
        identities.push(`rpc:${identity}`);
        return { data: [{ location_id: `branch-${identity}`, is_primary: true }], error: null };
      },
    };
  }
  const dependencies = {
    "@supabase/ssr": { createServerClient: () => client("cookie-user") },
    "@supabase/supabase-js": { createClient: (_url: string, _key: string, options: { global: { headers: { Authorization: string } } }) => {
      const authorization = options.global.headers.Authorization;
      expect(authorization).toBe("Bearer token-user");
      return client(authorization.slice(7));
    } },
    "next/headers": { cookies: async () => { cookieReads += 1; return { getAll: () => [] }; } },
    "@/lib/supabase/config": { getSupabaseUrl: () => "http://local", getSupabasePublishableKey: () => "fake" },
  };
  const auth = loadSourceModule<typeof import("../src/lib/server/auth")>("src/lib/server/auth.ts", dependencies);
  return { auth, identities, cookieReads: () => cookieReads };
}

for (const scheme of ["Bearer", "bearer", "BEARER", "bEaReR"]) {
  test(`${scheme} uses the header identity for both claims and branch RPC despite another cookie`, async () => {
    const f = fixture();
    const result = await f.auth.requireAuth(new Request("http://local/api/auth/me", {
      headers: { authorization: `${scheme} token-user` },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Authentication failed");
    expect(result.auth.sub).toBe("token-user");
    expect(result.auth.locationIds).toEqual(["branch-token-user"]);
    expect(f.identities).toEqual(["claims:token-user", "rpc:token-user"]);
    expect(f.cookieReads()).toBe(0);
  });
}

test("absent authorization keeps the existing cookie flow", async () => {
  const f = fixture();
  const result = await f.auth.requireAuth(new Request("http://local/api/auth/me"));
  expect(result.ok && result.auth.sub).toBe("cookie-user");
  expect(f.identities).toEqual(["claims:cookie-user", "rpc:cookie-user"]);
});

for (const header of ["", "Bearer", "Bearer   ", "Basic token-user", "Bearer token-user another", "Bearer token-user,Bearer other"]) {
  test(`malformed authorization ${JSON.stringify(header)} never falls back to cookies`, async () => {
    const f = fixture();
    const result = await f.auth.requireAuth(new Request("http://local/api/auth/me", { headers: { authorization: header } }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Unexpected authentication");
    expect(result.response.status).toBe(401);
    expect(f.identities).toEqual([]);
    expect(f.cookieReads()).toBe(0);
  });
}

for (const [failure, status] of [["claims", 401], ["inactive", 403], ["upstream", 503]] as const) {
  test(`preserves ${status} for ${failure}`, async () => {
    const f = fixture(failure);
    const result = await f.auth.requireAuth(new Request("http://local/api/auth/me", { headers: { authorization: "Bearer token-user" } }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Unexpected authentication");
    expect(result.response.status).toBe(status);
  });
}
