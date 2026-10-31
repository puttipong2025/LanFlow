# Device base numbers with a server-assigned final suffix

Status: Accepted by the user on 2026-10-31; implemented and verified locally. This supersedes the earlier same-number-before-and-after-sync proposal. No Cloud rollout is implied.

## Decision

Format amendment confirmed on 2026-10-31: move the existing sequence to the front, separated from the date: `0015-261031-D03`. This changes presentation for newly allocated bases; it does not restart counters, replace registrations or rewrite issued numbers/queued commands. The previous `2610310015-D03` layout remains valid for existing work. Both layouts use the same metadata contract because the immutable base itself distinguishes them.

Apply the two-layout validator migration `20261031023000` before the new formatter. Retain that validator when rolling back a client so that both generations of queued work remain accepted.

For new small-scale weighing bills entered manually or through OCR, the browser allocates a base such as `0015-261031-D03` once, at the first durable local save. When the business create commits centrally, including after approval when required, the server appends a suffix: `0015-261031-D03-1`. Different bill identities may share a base and receive `-1`, `-2`, etc. Exact retries return the original final number. The server does not recompute the date or local sequence using the legacy date-based allocator for these bills.

The user explicitly accepted that an offline PDF contains the base, and a later confirmed PDF contains a different, final number. Previously shared files are frozen; central completion does not automatically share another PDF. The interface and new-format PDFs show one field labelled `เลขที่บิล`, with pending status while the final suffix is unknown, and do not add a second visible local-reference field.

## Issuer and local allocation

One browser/profile and branch is one issuer scope, independent of accounts using that profile. Tabs and account switches share a durable counter, while bill authors, permissions, drafts and queued commands remain account-scoped. The central registry allocates nonrecycled codes `D01`, `D02`, through `D100` and beyond. Registration uses full UUID installation/generation identities, not the older four-digit local device label.

Local counters are keyed by the bill date selected at first save. That date is formatted `YYMMDD` using the Gregorian year, and is frozen in the number even if the business date is later edited. A single IndexedDB transaction commits the counter, bill-number reservation and outbox event before local acceptance or a frozen PDF is handed off. Issued bases are not recycled after cancellation or deletion; gaps are allowed. Missing or inconsistent required allocator state requires a fresh online registration rather than resetting an old code. IndexedDB version 9 retains existing queue and receipt stores and fences older uploaders.

## Central persistence and replay

`local_bill_no` stores the device base. `server_bill_no` and `bill_no` store the final number after central creation. `numbering_metadata` identifies the explicit version, issuer, original number date and local sequence. New-format bases may repeat; legacy base uniqueness is retained with a partial index, and final numbers are unique per branch independently of editable dates. Private suffix counters and client-identity bindings survive deletion of business rows and queue-history compaction. Allocation occurs in the existing business transaction, with the existing financial, stock, approval and relation-lock rules.

The accepted command payload retains its base and metadata through reconnect, issuer replacement, updates and approval. A final suffix is a result, not a mutation of an already submitted request. Numbered admission/direct-sync RPCs form an explicit backend capability fence: an old backend cannot silently turn a numbered proposal into a legacy-numbered create. Clients accept only a final number matching the frozen base plus a positive suffix. A bound numbering rejection is disclosed and retained as failed local work, without automatic retries, payload replacement or unsafe deletion of an uncertain submission.

## Admin lifecycle

The existing Admin surface has an issuer-management view with branch/status filters, search, paging and a confirmation dialog. Only Super Admin and accounts with effective system-manager access may list or retire issuers; normal authorized bill operators may register their own issuer scope. Browser/platform labels and last contact describe reported browser information, not physical hardware or real-time online presence.

Retirement preserves history and does not revoke login. A disconnected browser may continue using its old code until it learns of retirement. On reconnection an authorized browser receives a fresh code for new bills; queued bills retain their old bases and any already-issued finals, and still pass the existing central business checks.

## Compatibility and trade-off

Historical bills and branch-to-branch Rubber receipts retain their previous numbering. The backend expands first; legacy outbox commands remain compatible, while the new browser requires the numbered RPCs and registration. Rollback must retain support for already-issued bases, suffixes and metadata, and must not clear queues, downgrade IndexedDB or recycle numbers.

Central final-number uniqueness is enforced, but cloned or restored offline storage can still produce identical bases on documents issued before reconnect. The user chose server suffixes as the reconciliation mechanism and accepted that those offline documents cannot be retroactively changed.

Evidence and rollout limits: `docs/rubber-device-numbering-verification.md`. Source: `src/lib/rubber-bills/numbering-idb.ts`, `numbering-contract.ts`, `src/components/rubber-bills/bill-display.ts`, `src/components/admin/RubberBillIssuers.tsx`, and migrations `20261031020000`, `20261031021000`, `20261031022000`.
