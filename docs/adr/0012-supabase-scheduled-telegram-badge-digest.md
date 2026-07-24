# Schedule Telegram badge digests inside Supabase

LanFlow sends one configurable Telegram digest from server-owned pending data. Supabase Cron invokes a Supabase Edge Function, while Postgres owns schedule claims, retry/idempotency state, badge aggregation, and the Bot Token stored in Supabase Vault. This keeps secrets and global counts out of browsers, reuses the existing Supabase operational boundary, and avoids depending on an open client or a Vercel plan-specific cron interval.

The trade-off is one Supabase-specific deployment step: production must configure the deployed Edge Function URL in Vault before the cron job can invoke it. The Edge Function remains deliberately thin and Telegram-specific; changing delivery providers later requires a new sender, not a rewrite of the pending-count contract.
