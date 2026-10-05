---
status: accepted
---

# Use a device-local daily counter for weighing appointments

LanFlow will assign each weighing-appointment PDF a sequential number from 1 to 9,999. The sequence is scoped to one browser storage bucket and location and resets on the `Asia/Bangkok` calendar day. It is deliberately separate from the existing weighing queue, is not a transaction record, and is not synchronized to Supabase. Clearing browser site data may therefore reset the sequence.

The browser stores one versioned counter record per location inside the device-local storage bucket. The record contains the active Bangkok date, the last committed number, and at most one pending reservation. A strict parser rejects corrupt, unknown-version, or out-of-range data; unavailable or unreadable storage fails closed instead of guessing a number. The counter and lock keys intentionally do not include the separately initialized legacy device ID, because two first-use tabs can race while creating that ID; the shared storage bucket is already the device boundary. If that legacy identity is unavailable, appointment tickets remain usable while the separate device-local weighing queue is blocked before opening rather than being placed under a shared fallback identity.

Issuing a PDF uses a fail-fast Web Lock scoped to the same storage bucket and location. While holding that lock, the client checks the previewed number, creates a token-bound pending reservation, performs the Web Share or download handoff, and then commits the reservation. A normal cancellation or PDF-generation failure rolls back the matching reservation. A crash may leave a pending reservation; the next successful lock holder consumes it as an intentional gap before issuing another number. This favors never issuing a duplicate over keeping the sequence gap-free.

Selecting a wait duration only creates a draft and does not consume a number. The draft records its issue time so the appointment time cannot drift while the user reviews it. A draft that crosses into another Bangkok day is invalidated. If another tab changes the counter after preview, the UI refreshes the number and requires a second explicit share action.

The appointment name is optional, trimmed, limited to 100 characters, and included only in the generated PDF. It is not stored in the counter or any history. This decision adds no history, reorder, re-share, or central uniqueness service.
