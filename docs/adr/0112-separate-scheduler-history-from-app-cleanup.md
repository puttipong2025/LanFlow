---
status: accepted
date: 2026-11-13
extends: ADR-0111
---

# Separate scheduler history cleanup from app history cleanup

Scheduler history checks have timed out inside the same transaction as app history cleanup. A manager's cleanup request now defines completion by eligible app history. Scheduler history uses the same retention policy and continues in its own bounded background work, with its progress reported separately.

The split lets app history cleanup finish while scheduler history catches up. Pending work, business data, permanent audits, and replay records retain their existing protection.

The rubber queue starts processing through the existing immediate path after durable admission. Use a 30-second scheduler interval for fallback and retries, and end a fallback tick after one check finds no due work. This reduces empty scheduler runs while allowing accepted work to continue after the originating browser closes. The interval is a normal fallback wait before processing can start. Backoff, load, and contention can delay completion.

The implementation passed fresh migration replay, 2,402 database assertions, real Cron and browser-context closure checks, and the application release gate. Supabase Cloud migrations `20261113040000` and `20261113050000` were applied on 2026-11-13. Their function definitions match the reviewed migration, the shared policy remains 10 days, and the installed fallback schedule is 30 seconds.
