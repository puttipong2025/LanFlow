import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey =
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = process.env.LANFLOW_TEST_BASE_URL ?? "http://127.0.0.1:3002";

if (!url || !secretKey) {
  throw new Error("Supabase URL and secret key are required");
}

const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error("This verification script only runs against local Supabase");
}

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const suffix = Date.now().toString().slice(-8);
const id = randomUUID();
const phone = `07${suffix}`;
const password = `Http-${randomUUID()}`;

try {
  const { data: locations, error: locationError } = await admin
    .from("locations")
    .select("id")
    .order("created_at")
    .limit(1);
  if (locationError) throw locationError;
  if (!locations?.[0]) throw new Error("A location is required");

  const { error: authError } = await admin.auth.admin.createUser({
    id,
    phone: `+66${phone.slice(1)}`,
    phone_confirm: true,
    password
  });
  if (authError) throw authError;

  const { error: profileError } = await admin.from("profiles").insert({
    id,
    phone,
    name: "HTTP Auth Test",
    role: "user",
    is_active: true,
    password_hash: null
  });
  if (profileError) throw profileError;

  const { error: assignmentError } = await admin.from("user_locations").insert({
    user_id: id,
    location_id: locations[0].id,
    is_primary: true
  });
  if (assignmentError) throw assignmentError;

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password }),
    redirect: "manual"
  });
  if (!loginResponse.ok) {
    throw new Error(`Login route failed: ${loginResponse.status} ${await loginResponse.text()}`);
  }

  const setCookies =
    typeof loginResponse.headers.getSetCookie === "function"
      ? loginResponse.headers.getSetCookie()
      : [loginResponse.headers.get("set-cookie")].filter(Boolean);
  const cookieHeader = setCookies
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
  if (!cookieHeader) throw new Error("Login route did not issue session cookies");

  const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: cookieHeader },
    cache: "no-store"
  });
  if (!meResponse.ok) {
    throw new Error(`/api/auth/me failed: ${meResponse.status} ${await meResponse.text()}`);
  }
  const me = await meResponse.json();
  if (me.profile.id !== id) {
    throw new Error("Authenticated profile ID did not match the Supabase Auth user");
  }

  const dataResponse = await fetch(`${baseUrl}/api/lanflow`, {
    headers: { Cookie: cookieHeader },
    cache: "no-store"
  });
  if (!dataResponse.ok) {
    throw new Error(`/api/lanflow failed: ${dataResponse.status} ${await dataResponse.text()}`);
  }
  const data = await dataResponse.json();
  if (
    data.locations.length !== 1 ||
    data.locations[0].id !== locations[0].id
  ) {
    throw new Error("HTTP data route did not preserve branch isolation");
  }

  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          "phone username mapped to Supabase Auth",
          "SSR cookies issued",
          "authenticated profile loaded",
          "API branch isolation"
        ]
      },
      null,
      2
    )
  );
} finally {
  await admin.from("user_locations").delete().eq("user_id", id);
  await admin.from("profiles").delete().eq("id", id);
  await admin.auth.admin.deleteUser(id);
}

