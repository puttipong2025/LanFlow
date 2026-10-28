---
status: accepted
date: 2026-10-28
extends: ADR-0083
---

# Accept Rubber edits and deletions durably before awaiting submission

Synced Rubber edits/deletions keep their online context check. After the immutable
command is stored, the form closes and the existing app coordinator submits it.
Acceptance is not business success. Keep the authoritative row with a pending
label and prevent competing actions until the outcome is known. Creates retain
their existing behavior. Do not print an unconfirmed edit automatically.

Use the existing selected-location coordinator. Changing modules does not stop
submission. An already started request may finish in its original partition;
unsent work in an old location waits until that location is selected again.
Notifications are scoped to the active account and location, and each business
failure reason is recorded atomically in IndexedDB before notifying once.

Known success, superseded and cancelled receipts silently acknowledge matching
background commands. The user also chose to discard an update/delete draft when
the authenticated Server context positively confirms that the same physical bill
is deleted. This is a deliberate exception to ADR-0083's stale-draft retention.
Absence, authorization failure and network errors never constitute deletion proof.
An active bill's revision conflict retains its draft and is never rebased silently.

Queue removal, receipt removal and its bill-identity tombstone use one transaction
in the existing IndexedDB stores. A crash either retains the work or commits all
cleanup. Exact-event comparison preserves new work from another tab, and the
bill-specific tombstone prevents delayed receipt writes from resurrecting it.
There is no new database migration, worker framework or IndexedDB version.

The faster UX cannot eliminate the initial online context check. Closing the app
pauses unsent work until the next authenticated online session; no claim is made
that a closed browser continues processing.

See [the implementation and verification contract](../rubber-background-mutations.md).
