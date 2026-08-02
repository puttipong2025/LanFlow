# Wake manual Dashboard refresh immediately

## Status

Accepted on 2026-08-02.

The global 10–1,440 minute interval continues to control automatic dirty and failed work, but a manual “คำนวณสาขานี้ใหม่” request must wake an asynchronous worker within five seconds instead of waiting for the next one-minute cron ticks. An authenticated Supabase Edge Function queues the selected branch, records the requested source version, returns promptly, and uses a background task to call branch-targeted claim and rebuild RPCs; the existing cron jobs remain the recovery path. The browser reports success only when `snapshot_version` covers the requested version, preserves the latest successful snapshot on failure, deduplicates queued/running work, and warns without cancelling when a run exceeds two minutes. System managers may request any active branch, while an Admin may request only an assigned active branch; this narrow permission does not grant access to the global interval, Telegram thresholds, or any other manager capability.

## Considered options

- Waiting for cron was rejected because separate one-minute claim and rebuild jobs can delay a manual request by roughly one to two minutes or longer under backlog.
- Calculating inside the Next.js request was rejected because historical aggregation would share the request timeout and make retries and disconnects part of calculation correctness.
- Treating Admin as a system manager was rejected because it would also expose unrelated global configuration and management APIs.

## Consequences

The database migration must be applied before deploying the Edge Function and web application. Manual and cron workers must share the same per-branch concurrency guard, and production deployment must verify the five-second start target, grants, failure preservation, and cron fallback.
