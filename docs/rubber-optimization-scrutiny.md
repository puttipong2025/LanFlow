# Queue/feed scrutiny — 2026-10-30

Scope: the queue/actor/feed optimization working tree, its Rubber API Routes,
client reconciliation, immediate worker and reachable database business calls.
No code attachment was supplied; this uses the task's existing scope. Prior
Cloud SQL releases remain separate from the new Route-only fixes below.

## Intent and simpler-alternative check

Preserve immutable command/receipt/permission boundaries while reducing SQL
work. The existing scheduler/worker and a bounded page projection meet that
goal; no new queue, cache or worker service is needed. For findings below,
use existing Route guards and small boundary changes rather than changing
business functions or migrating data again.

## Trace

- Client outbox → command-context → authenticated queue admission → protected
  original actor → existing business core → committed exact receipt → local
  acknowledgement. Existing callgraph tool finds70reachable functions,15with
  explicit locks across9roots; this is static reachability, not proof of every
  implicit trigger/FK behavior. No legacy wrapper is removed merely for its name.
- Feed Route → auth/branch/cursor checks → paged feed RPC → payload validation
  → evidence RPC → validation → JSON → client mapping. Filters and selection
  stay inside the authoritative SQL snapshot before visible-row decoration.
- Immediate accelerator retains one active attempt per server instance,
  certificate verification, statement/lock deadlines and cron fallback.

## Reproduction/hypothesis ledger

| Finding / prediction | Red experiment | Differential / disproof | Minimal fix |
|---|---|---|---|
| Feed has no outer exception boundary; rejected auth/RPC promises escape | Real source-handler test rejects with injected private upstream detail instead of returning a Response | Existing valid/error-object cases pass; new loop isolates auth, first RPC and evidence RPC throws independently | Catch at exported GET boundary; return generic private/no-store503JSON, no raw exception/log payload |
| Queue compares request UUID spelling against canonical DB UUID text | Uppercase valid branch/command query returns503 with the same otherwise-valid admitted receipt | Existing lowercase receipt remains200 and wrong-branch/count validation remains intact | Canonicalize UUID query fields for GET; keep immutable POST payload untouched |
| Evidence validation accepts wrong JSON types through String coercion | review_status:[outside] returns200 | Same exact valid string outside returns200, so membership itself is valid and only type differs | Require string before checking the existing status allowlist |

The three hypotheses concern independent boundaries; each was reproduced
before its production fix. The injected errors do not imply a real credential
leak was observed: the fix prevents rejected Route responses and keeps the
failure contract opaque. Malformed evidence rejection is defense at the API
contract, not a claim that normal PostgreSQL output contains arrays.

## Findings fixed

- P2 feed rejection handling: `src/app/api/lanflow/rubber-bills/feed/route.ts`
  exported GET now contains failures from auth, feed and evidence lookup.
- P2 canonical queue lookup: `src/app/api/lanflow/rubber-bills/queue/route.ts`
  GET canonicalizes location/command/draft/before UUID fields, avoiding a false
  unavailable response for valid case variations. Authorization still runs.
- P2 malformed evidence response: feed validation rejects non-string review
  states instead of emitting invalid typed data to the client.

## Dead code and verification

Strict TypeScript noUnusedLocals/noUnusedParameters finds no unused imports,
parameters or locals. Reachable business wrappers remain in use; none removed.
No new debug probes/logging remain in product code. Scope does not claim that
all exported symbols anywhere in the repository are unused-free.

- Focused queue/feed/context/immediate/client tests:90passed.
- Before fixes: route regression2fail/44pass; malformed evidence1fail with
  array incorrectly accepted. After fixes all focused cases pass.
- Full verification exit0:878passed/2existing skips; lint/type/source-size/
  import/auth-outage/build/offline/service-worker/bundle passed,282.3/320kB.
- No SQL/schema changes are introduced by this scan; the1591SQL/14concurrency/
  browser5 evidence of the earlier release is historical and not rerun to
  pretend these new Route changes were deployed.
- Logs: output/rubber-scrutiny-{route-red,evidence-red,focused,unused-final,verify}.log.

Verdict: ship; all three reproduced boundary failures have passing regressions
and full verification. Keep this Route patch separate
from the already deployed SQL optimization. No new Cloud release is asserted.
