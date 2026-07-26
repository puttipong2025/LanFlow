import { config } from "dotenv";

const envFileArgument = process.argv.find((argument) =>
  argument.startsWith("--env-file="),
);
const envFile = envFileArgument?.slice("--env-file=".length) ||
  ".env.production.local";

config({ path: envFile, override: false, quiet: true });

const allowLocal = process.argv.includes("--allow-local");

const required = [
  {
    label: "Supabase URL",
    names: ["NEXT_PUBLIC_SUPABASE_URL"],
  },
  {
    label: "Supabase publishable key",
    names: [
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ],
  },
  {
    label: "Supabase server secret",
    names: ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
  },
  {
    label: "Google OAuth client ID",
    names: ["GOOGLE_CLIENT_ID"],
  },
  {
    label: "Google OAuth client secret",
    names: ["GOOGLE_CLIENT_SECRET"],
  },
  {
    label: "Google OAuth refresh token",
    names: ["GOOGLE_REFRESH_TOKEN"],
  },
  {
    label: "Google Drive folder",
    names: ["GOOGLE_DRIVE_FOLDER_ID"],
  },
  {
    label: "OpenRouter OCR key",
    names: ["OPENROUTER_API_KEY"],
  },
];

const missing = required.filter(({ names }) =>
  names.every((name) => !process.env[name]?.trim()),
);

const errors = [];
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

if (supabaseUrl) {
  try {
    const parsed = new URL(supabaseUrl);
    const isLocal =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";

    if (!allowLocal && isLocal) {
      errors.push(
        "NEXT_PUBLIC_SUPABASE_URL points to local Supabase; use the hosted project for deployment.",
      );
    }
    if (!allowLocal && parsed.protocol !== "https:") {
      errors.push("NEXT_PUBLIC_SUPABASE_URL must use HTTPS for deployment.");
    }
  } catch {
    errors.push("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  }
}

if (missing.length > 0) {
  errors.push(
    `Missing environment groups: ${missing.map(({ label }) => label).join(", ")}.`,
  );
}

if (errors.length > 0) {
  console.error("Deployment environment check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Deployment environment check passed for ${envFile} (${required.length} required groups; values were not printed).`,
);
