import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secretKey =
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !publishableKey || !secretKey) {
  throw new Error("Supabase URL, publishable key and secret key are required");
}

const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error("This verification script only runs against local Supabase");
}

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const suffix = Date.now().toString().slice(-8);
const users = [
  {
    id: randomUUID(),
    phone: `08${suffix}`,
    e164: `+668${suffix}`,
    password: `Rls-A-${randomUUID()}`
  },
  {
    id: randomUUID(),
    phone: `09${suffix}`,
    e164: `+669${suffix}`,
    password: `Rls-B-${randomUUID()}`
  }
];

let createdTransactionId;

try {
  const { data: locations, error: locationError } = await admin
    .from("locations")
    .select("id")
    .order("created_at")
    .limit(2);
  if (locationError) throw locationError;
  if (!locations || locations.length < 2) {
    throw new Error("At least two locations are required for RLS verification");
  }

  for (const user of users) {
    const { error } = await admin.auth.admin.createUser({
      id: user.id,
      phone: user.e164,
      phone_confirm: true,
      password: user.password
    });
    if (error) throw error;
  }

  const { error: profileError } = await admin.from("profiles").insert(
    users.map((user, index) => ({
      id: user.id,
      phone: user.phone,
      name: `RLS Test ${index + 1}`,
      role: "user",
      is_active: true,
      password_hash: null
    }))
  );
  if (profileError) throw profileError;

  const { error: assignmentError } = await admin.from("user_locations").insert([
    {
      user_id: users[0].id,
      location_id: locations[0].id,
      is_primary: true
    },
    {
      user_id: users[1].id,
      location_id: locations[1].id,
      is_primary: true
    }
  ]);
  if (assignmentError) throw assignmentError;

  const clientA = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { error: signInError } = await clientA.auth.signInWithPassword({
    phone: users[0].e164,
    password: users[0].password
  });
  if (signInError) throw signInError;

  const { data: visibleLocations, error: visibleError } = await clientA
    .from("locations")
    .select("id");
  if (visibleError) throw visibleError;
  if (
    visibleLocations.length !== 1 ||
    visibleLocations[0].id !== locations[0].id
  ) {
    throw new Error("User A did not receive exactly its assigned location");
  }

  const { data: crossLocation, error: crossReadError } = await clientA
    .from("locations")
    .select("id")
    .eq("id", locations[1].id);
  if (crossReadError) throw crossReadError;
  if (crossLocation.length !== 0) {
    throw new Error("Cross-location read was not blocked");
  }

  const transaction = {
    client_temp_id: randomUUID(),
    local_bill_no: `RLS-${suffix}`,
    idempotency_key: randomUUID(),
    sync_status: "synced",
    record_status: "active",
    location_id: locations[0].id,
    type: "expense",
    number: `RLS-${suffix}`,
    tx_date: new Date().toISOString().slice(0, 10),
    title: "RLS verification",
    cost: 1,
    created_by_user_id: users[0].id,
    created_by_name: "RLS Test 1",
    created_by_phone: users[0].phone
  };

  const { data: inserted, error: ownWriteError } = await clientA
    .from("income_expense")
    .insert(transaction)
    .select("id")
    .single();
  if (ownWriteError) throw ownWriteError;
  createdTransactionId = inserted.id;

  const { error: crossWriteError } = await clientA
    .from("income_expense")
    .insert({
      ...transaction,
      id: randomUUID(),
      client_temp_id: randomUUID(),
      idempotency_key: randomUUID(),
      number: `RLS-CROSS-${suffix}`,
      location_id: locations[1].id
    });
  if (!crossWriteError) {
    throw new Error("Cross-location write was not blocked");
  }

  const { data: otherProfile, error: otherProfileError } = await clientA
    .from("profiles")
    .select("id")
    .eq("id", users[1].id);
  if (otherProfileError) throw otherProfileError;
  if (otherProfile.length !== 0) {
    throw new Error("Cross-profile read was not blocked");
  }

  const { error: deactivateError } = await admin
    .from("profiles")
    .update({ is_active: false })
    .eq("id", users[0].id);
  if (deactivateError) throw deactivateError;

  const { data: afterDeactivate, error: deactivateReadError } = await clientA
    .from("locations")
    .select("id");
  if (deactivateReadError) throw deactivateReadError;
  if (afterDeactivate.length !== 0) {
    throw new Error("Inactive user retained database access");
  }

  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          "own location read",
          "cross-location read denied",
          "own-location write",
          "cross-location write denied",
          "cross-profile read denied",
          "inactive user denied"
        ]
      },
      null,
      2
    )
  );
} finally {
  if (createdTransactionId) {
    await admin.from("income_expense").delete().eq("id", createdTransactionId);
  }

  await admin.from("user_locations").delete().in("user_id", users.map((user) => user.id));
  await admin.from("profiles").delete().in("id", users.map((user) => user.id));
  for (const user of users) {
    await admin.auth.admin.deleteUser(user.id);
  }
}

