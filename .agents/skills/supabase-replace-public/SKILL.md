---
name: supabase-replace-public
description: >-
  Safely replace the LanFlow Supabase Cloud public schema and local
  customer/transport master data while preserving auth.users, identities,
  sessions, refresh tokens, profiles, locations, and user-location assignments.
  Use when the user asks to reset, rebuild, redeploy, or replace the Cloud
  database from local migrations; copy local customers or transport staff to
  Cloud; preserve Supabase Auth during a destructive public-schema replacement;
  recover an interrupted replacement; or verify migration, RLS, Auth, and row
  hashes after deployment. ภาษาไทย: ใช้เมื่อต้องล้างหรือสร้าง public schema บน
  Supabase Cloud ใหม่จาก migration ในเครื่อง โดยรักษา Auth และแทนที่ข้อมูล
  ลูกค้า/ขนส่ง/พนักงานจาก local
---

# Supabase Replace Public

Use `scripts/replace-public-cloud.ps1` as the execution path. Read [references/runbook-th.md](references/runbook-th.md) before a production write or recovery.

## Workflow

Run read-only preflight from the repository root:

```powershell
& ".agents\skills\supabase-replace-public\scripts\replace-public-cloud.ps1" -Mode Preflight
```

Report the resolved project ref, Pooler, Auth state, local master state, and migrations. Stop on any connection or prerequisite failure.

After explicit approval for the exact project ref, run:

```powershell
& ".agents\skills\supabase-replace-public\scripts\replace-public-cloud.ps1" `
  -Mode All `
  -ConfirmProjectRef "<project-ref>"
```

Never invent `-ConfirmProjectRef`. It must exactly match the resolved production target.

## Safety gates

- Back up Auth, public, migration history, the Cloud profile/location bridge, and local master data before reset.
- Verify every backup SHA-256 before destructive work.
- Restore and verify Auth immediately after reset, before restoring public data.
- Exclude only `auth.schema_migrations` from the restorable Auth dump because the normal database role cannot write it.
- Compare full-row hashes for Auth, the profile/location bridge, and every master table.
- Require Cloud migrations to equal the backed-up local migration state.
- Require RLS on every public table.
- Keep and report the backup directory; never commit its contents.
- Never print a database password or password-bearing URL.

## Recovery

If `All` stops after reset, reuse the printed backup directory:

```powershell
$script = ".agents\skills\supabase-replace-public\scripts\replace-public-cloud.ps1"
& $script -Mode RestoreAuth -BackupDirectory "<backup>" -ConfirmProjectRef "<ref>"
& $script -Mode RestorePublic -BackupDirectory "<backup>" -ConfirmProjectRef "<ref>"
& $script -Mode Verify -BackupDirectory "<backup>"
```

Do not rerun reset merely because restore or verification failed.

## Completion receipt

Report the backup path and manifest hash, Git commit, migration state, Auth counts, bridge counts, master hash result, empty transaction result, RLS result, and any DB lint findings.
