import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const bootstrapPassword = process.env.LANFLOW_BOOTSTRAP_PASSWORD;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !secretKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY are required"
  );
}

const supabase = createClient(url, secretKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

function normalizeThaiPhoneToE164(input) {
  const digits = String(input).replace(/\D/g, "");
  if (/^0\d{9}$/.test(digits)) return `+66${digits.slice(1)}`;
  if (/^66\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\d{10,15}$/.test(digits) && String(input).trim().startsWith("+")) {
    return `+${digits}`;
  }
  throw new Error(`Invalid phone format for profile ${input}`);
}

// Removed fake email generator

async function listAllAuthUsers() {
  const users = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000
    });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
    page += 1;
  }
}

const { data: profiles, error: profilesError } = await supabase
  .from("profiles")
  .select("id, phone, name, password_hash, role, is_active")
  .order("created_at", { ascending: true });

if (profilesError) throw profilesError;

const prepared = [];
const identityOwners = new Map();

for (const profile of profiles ?? []) {
  const phone = normalizeThaiPhoneToE164(profile.phone);
  const previousOwner = identityOwners.get(phone);
  if (previousOwner && previousOwner !== profile.id) {
    throw new Error(
      `Phone collision after E.164 normalization between ${previousOwner} and ${profile.id}`
    );
  }
  identityOwners.set(phone, profile.id);
  prepared.push({ ...profile, normalizedPhone: phone });
}

const existingUsers = await listAllAuthUsers();
const existingById = new Map(existingUsers.map((user) => [user.id, user]));
const existingByPhone = new Map(
  existingUsers.filter((user) => user.phone).map((user) => [user.phone, user])
);

let ready = 0;
let skipped = 0;
let conflicts = 0;

for (const profile of prepared) {
  const byId = existingById.get(profile.id);
  const byPhone = existingByPhone.get(profile.normalizedPhone);

  if (byId) {
    if (byId.phone !== profile.normalizedPhone) {
      console.error(
        `[conflict] ${profile.id}: auth identity does not match normalized profile phone`
      );
      conflicts += 1;
    } else {
      console.log(`[skip] ${profile.id}: auth user already exists`);
      skipped += 1;
    }
    continue;
  }

  if (byPhone && byPhone.id !== profile.id) {
    console.error(
      `[conflict] ${profile.id}: normalized phone identity belongs to auth user ${byPhone.id}`
    );
    conflicts += 1;
    continue;
  }

  const canBootstrapSuperAdmin =
    profile.role === "super_admin" &&
    typeof bootstrapPassword === "string" &&
    bootstrapPassword.length >= 8;

  if (!profile.password_hash && !canBootstrapSuperAdmin) {
    console.error(
      `[skip] ${profile.id}: no password hash; set LANFLOW_BOOTSTRAP_PASSWORD for the super admin or reset manually`
    );
    skipped += 1;
    continue;
  }

  ready += 1;
  if (!apply) {
    console.log(`[dry-run] ${profile.id}: ready to import`);
    continue;
  }

  const credential = profile.password_hash
    ? { password_hash: profile.password_hash }
    : { password: bootstrapPassword };

  const { error } = await supabase.auth.admin.createUser({
    id: profile.id,
    phone: profile.normalizedPhone,
    phone_confirm: true,
    ...credential,
    user_metadata: { name: profile.name },
    app_metadata: { lanflow_role: profile.role },
    ...(profile.is_active ? {} : { ban_duration: "876000h" })
  });

  if (error) {
    console.error(`[error] ${profile.id}: ${error.message}`);
    conflicts += 1;
    continue;
  }

  console.log(`[created] ${profile.id}`);
}

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      profiles: prepared.length,
      ready,
      skipped,
      conflicts
    },
    null,
    2
  )
);

if (conflicts > 0) {
  process.exitCode = 1;
}
