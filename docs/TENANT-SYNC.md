# Catalog Engine — Tenant Intelligent Sync

Status: **Normative implementation contract**  
Scope: recurring tenant catalog synchronization, safety decisions, delta semantics, quarantine, last-known-good preservation and verified state promotion.  
Roadmap owner: **M7 — Intelligent Sync v2**.

## Goal

Recurring synchronization must keep a merchant catalog current **without allowing supplier outages, partial scans, malformed scans or implausible results to destroy a healthy published catalog**.

The sync system is not allowed to interpret every technically successful fetch as authoritative business truth.

Core safety model:

```text
previous last-known-good state
+
current normalized scan evidence
+
scope completeness
+
run health
+
versioned safety policy
→ sync safety decision
→ delta planning
→ detail work for affected products only
→ verification
→ state/cursor promotion
```

## Core invariants

1. **A partial scan may never infer deletion.**
2. `not observed` is not equivalent to `removed`.
3. Provider `complete=true` evidence is necessary but not sufficient to authorize destructive absence/removal progression when the result is implausible.
4. A suspicious run preserves the previous last-known-good public catalog until the run is resolved or a later healthy run supersedes it.
5. A product leaving one complete scope is detached from that scope; it is globally removed only when no other active scope owns it and the removal contract is satisfied.
6. Repeated-miss policy may confirm removal only after the run has first passed the sync safety decision.
7. Detail fetch is limited to NEW/CHANGED/CHANGED_MOVED/RESTORED or retry-required products; unchanged and MOVED-only products are not re-fetched by default.
8. Cursor/state promotion happens only after downstream verification. Planning or fetching alone is never authority to advance the last-known-good cursor.
9. Retry/replay is idempotent and may not duplicate catalog identity or corrupt another tenant.
10. Sync decisions and operational summaries use stable safe codes and opaque IDs. Supplier URLs/raw provider IDs remain private.
11. Sync orchestration is provider-neutral after normalized provider scan/detail evidence exists.
12. CEI reprocessing is limited to products/knowledge affected by a verified delta unless a deliberate classifier/Knowledge Pack migration requires broader work.

## Scope model

Every synchronized source view belongs to an explicit opaque scope.

Supported conceptual scope kinds include:

- `catalog`;
- `category`;
- `source`;
- compatibility `legacy` state during migration.

Pagination, provider routing flags and transient query parameters must not create duplicate logical scopes.

### Partial scope scan

A partial scan may add/refresh observations but cannot detach unobserved members.

```text
observed now      → may update membership/state
not observed now  → UNOBSERVED only
previous members  → preserved
removal            → forbidden
```

### Complete healthy scope scan

A complete, healthy and plausible scan may authoritatively reconcile that scope.

A missing product can be detached from the current scope. Global removal still requires no other active scope membership plus the applicable repeated-miss/removal policy.

## M7 sync safety decision contract

M7 introduces a provider-neutral decision boundary before absence/removal inference.

Contract owner in code:

`src/sync/sync-decision.js`

Current contract identity:

```text
SYNC_DECISION_CONTRACT_VERSION = 1
SYNC_SAFETY_POLICY_VERSION = 1
```

The decision receives only bounded source-neutral operational evidence:

```text
scope.id
scope.kind
previous.knownGoodCount
scan.complete
scan.observedCount
scan.disqualifyingFailureCount
```

It does not require provider URLs, raw source IDs, credentials or retail-domain vocabulary.

### Decision outcomes

#### `proceed`

The scan is complete, has no disqualifying failures and passes the current plausibility policy.

Effects:

- current scan can be treated as authoritative for its scope;
- missing inference may be passed to the existing delta planner;
- repeated-miss removal progression is eligible;
- last-known-good does not need preservation because of the safety gate itself;
- cursor promotion remains **after verification**, never immediate.

#### `preserve_last_known_good`

The run is not authoritative, for example because the scan is incomplete or contains disqualifying extraction failures.

Effects:

- no missing inference;
- no removal progression;
- no cursor promotion;
- existing last-known-good catalog stays active;
- normal positive observations may be inspected/retried by later slices only under an explicit safe publication contract.

#### `quarantine`

The run is structurally suspicious, such as an empty complete scan or a catastrophic volume collapse.

Effects:

- no missing inference;
- no removal progression;
- no cursor promotion;
- last-known-good remains active;
- the run must surface as an operational/review exception instead of silently mutating most of the catalog.

## Catastrophic-diff policy v1

The current v1 policy is a conservative launch safety policy, not an eternal business constant.

Default values:

```text
minimumBaselineItems = 100
minimumAbsoluteDrop = 100
minimumRemainingRatio = 0.50
```

A complete healthy run is considered a catastrophic volume drop only when **all** are true:

1. previous last-known-good count is at least `minimumBaselineItems`;
2. absolute drop is at least `minimumAbsoluteDrop`;
3. current observed count / previous known-good count is below `minimumRemainingRatio`.

Examples under policy v1:

```text
17,018 → 300  = quarantine
1,000  → 900  = proceed
```

An empty complete scan is quarantined independently of the ratio policy.

A first healthy non-empty scan with no previous baseline is allowed to proceed; lack of historical volume is not itself suspicious.

The policy is explicit, versioned, schema-validated and injectable in tests/runtime composition. Do not scatter equivalent magic numbers across sync consumers/workflows.

Changing production thresholds materially requires regression fixtures and a deliberate policy-version decision.

## Existing delta semantics retained

M7 builds on existing tested primitives rather than creating a competing second sync engine.

Current incremental planner already models:

- `NEW` — new stable item; detail required;
- `CHANGED` — listing/detail evidence changed or detail still pending; detail required;
- `MOVED` — source placement changed while listing content is stable; no detail fetch required;
- `CHANGED_MOVED` — both content and placement changed; detail required;
- `RESTORED` — previously missing/removed item observed again; detail required;
- `MISSING` — repeated complete authoritative absence has not yet reached removal threshold;
- `REMOVED` — repeated authoritative absence reached the configured threshold.

The safety decision does not replace these transitions. It decides whether absence-driven transitions are allowed to run at all.

Conceptual composition:

```text
safety = decideSyncRunSafety(...)

delta = planIncrementalDelta(..., {
  inferMissing: safety.allowMissingInference
})
```

A quarantined/partial run therefore cannot generate `MISSING`/`REMOVED` merely because a provider returned fewer rows.

## Last-known-good contract

Last-known-good means the most recent catalog/sync state that completed the required integrity verification and was eligible for cursor/state promotion.

A new run must not overwrite that authority merely because:

- listing scan completed at the network layer;
- some detail requests succeeded;
- an intermediate delta was generated;
- the provider returned `complete=true`;
- a job reached a non-verified terminal state.

Suspicious/incomplete runs remain operational evidence while the prior verified public catalog continues serving.

## Verification and cursor promotion

M7 uses a two-stage authority model:

```text
scan safety decision
→ eligible delta processing
→ verification
→ promote cursor/state
```

`cursorPromotion = after_verification` means the safety gate permits the run to continue, **not** that the cursor may be advanced immediately.

`cursorPromotion = blocked` means the current run cannot become the new source-of-truth cursor/state.

Future M7 slices must preserve this distinction when wiring tenant scheduling, Queue processing and persistent cursors.

## Failure health

`disqualifyingFailureCount` represents failures that make the scan unsuitable for destructive absence reasoning.

The exact mapping from provider/extraction failure categories to this count belongs to the provider/import runtime contract and must remain safe and testable.

A run with one or more disqualifying failures preserves last-known-good even if its scanner also reports `complete=true`.

Do not hide failures just to make a run authoritative.

## Privacy boundary

Sync safety state may contain safe operational fields such as:

- opaque tenant/scope/run IDs;
- counts;
- hashes/fingerprints;
- timestamps;
- stable event/reason codes;
- decision/outcome;
- retry/quarantine state.

It must not expose in public/admin-safe summaries by default:

- supplier URLs;
- raw supplier IDs;
- source credentials/tokens;
- raw HTML;
- private media origins;
- tenant-private evidence payloads.

## M7B recurring schedule foundation

M7B establishes the low-volume control-plane scheduler for recurring tenant sync without yet activating incremental Queue execution.

### Control-plane schedule state

`tenant_sync_schedules` owns one schedule per tenant/source and contains only bounded orchestration state:

- tenant ID and source key;
- schedule status (`active`, `paused`, `disabled`);
- incremental interval in minutes;
- next due time;
- last scheduling time;
- last opaque import/job ID.

High-cardinality listing fingerprints, item events, private provider IDs and source URLs remain in the tenant data plane. The schedule table must not become a copy of the supplier catalog.

### Eligibility

A schedule may be created/selected only when all of the following are true:

- tenant is active;
- source is active and uses the incremental strategy;
- tenant catalog instance/data plane is ready;
- store is `ready` or `published`;
- the same tenant/source has a successful initial import checkpoint;
- no existing schedule needs to be duplicated;
- no active import/sync job already owns the tenant/source when a due run is selected;
- no failed `incremental`/`recovery` execution remains unresolved for that tenant/source.

A failed recurring/recovery job is an exception to resolve, not permission to schedule a fresh independent execution over it. Retry/recovery/cancellation must make that state explicit before normal scheduling resumes.

The default/original catalog is not special-cased into or out of this rule. It follows the same durable eligibility evidence as any other tenant.

### Cadence policy

Launch scheduler defaults:

```text
default interval = 360 minutes
minimum interval = 15 minutes
maximum interval = 10080 minutes
```

These values are an operational launch policy, **not** a permanent commercial-plan entitlement contract. Pricing/plan cadence can later map into the same validated scheduler boundary without teaching the scheduler business-plan names.

Newly discovered schedules begin in the future rather than running immediately. After a due slot is claimed, the next due time is calculated from the actual scheduling time, preventing an outage or long pause from causing a catch-up storm of historical sync slots.

The cadence is interval-based UTC orchestration. It does not depend on the merchant browser timezone.

### Execution identity and overlap prevention

M7 reuses `tenant_import_jobs` rather than creating a competing execution table. Its existing `mode='incremental'` value represents recurring sync execution.

Each due slot derives a deterministic opaque `imp_...` identity from:

```text
tenant + source key + scheduled UTC slot + identity contract version
```

The raw source URL is never part of Queue/public state.

The existing unique active-job constraint for `(tenant_id, source_key)` prevents an initial/recovery/incremental job from overlapping another active job for the same source. Deterministic slot identity plus conflict-safe insertion makes cron retries/races idempotent. The scheduler additionally refuses a fresh due slot while an unresolved failed incremental/recovery execution exists.

### M7B activation boundary

The recurring scheduler has its own explicit gate:

`TENANT_SYNC_AUTOMATION_ENABLED`

Only the literal string `1` enables schedule discovery/job creation. Disabled state returns before control-plane D1 scheduling work.

**Production currently keeps this value at `0`.**

Therefore the schedule foundation can remain deployed without creating incremental jobs, producing Queue messages or changing commercial catalog data in production.

M7C1 established one shared provider-neutral listing-delta Core. M7C2 established read-only tenant LKG loading + normalized provider observation + safety/delta planning. Neither slice activated recurring execution.

## M7C3 staged LKG authority foundation

M7C3 introduces the private staging boundary required before the native incremental consumer can safely mutate a large tenant catalog.

The motivating constraint is architectural, not merely performance-related: the internal tenant D1 command accepts bounded batches, so a large scan cannot be promoted safely by issuing one canonical write per product across many independent batches. If such a sequence failed halfway through, the supposedly canonical LKG could become a mixture of old and new state.

Therefore the authority flow is:

```text
canonical private LKG
        ↓ remains unchanged
normalized provider observation
        ↓
M7A safety + shared delta plan
        ↓
run-scoped private staging
        ↓
affected detail/CEI work when required
        ↓
verification
        ↓
set-based gated promotion
        ↓
new canonical private LKG
```

### Stage state

The additive v5 schema owns run-scoped private tables for:

- stage run metadata;
- normalized supplier observations;
- delta events;
- normalized provider taxonomy for the run.

A stage run stores its opaque `scope_id` and bounded `scope_kind`; provider URL/query syntax is not authority for scope identity.

Healthy observations/events/categories are staged in bounded JSON chunks. This allows a 17k-product catalog to be assembled across resumable stage writes without changing `supplier_album_index` during the scan/staging phase.

Partial/quarantined decisions store only bounded run diagnostics in this foundation; they do not stage raw observations for promotion and cannot become LKG.

### Canonical run ledger

Staging does not create a competing operational run model. The existing private `supplier_sync_runs` ledger remains the durable sync-run identity.

The stage lifecycle opens/reuses the matching incremental run as `running`. A `preserved`, `quarantined` or staging-integrity failure closes that canonical run as `failed` with a stable safe code. A healthy run remains `running` until verified promotion closes it as `success`.

Durable `supplier_sync_events` are written only during gated promotion, after the canonical run ledger already exists. This preserves its foreign-key and audit boundary.

### Verification/promotion gate

A canonical source-index promotion requires all of the following in the current foundation:

- matching opaque run/tenant/source identity;
- safety outcome `proceed`;
- complete staged observation/event counts;
- explicit stage verification;
- transition into `promoting`;
- `expected_detail_count = 0`.

Every set-based canonical mutation is SQL-gated by the matching `promoting` stage run. Calling the promotion builder before verification is therefore a no-op, not an alternate bypass path.

For this foundation, only no-detail deltas can reach verified promotion. Runs containing NEW/CHANGED/CHANGED_MOVED/RESTORED work remain `details_pending`. A later M7 slice must stage affected detail/CEI evidence and verify it before expanding promotion authority to those runs.

The current promotion foundation updates **private source/index and sync ledger state only**. It is not permission to bypass downstream public catalog/CEI verification.

## M7C4 schema v5 fleet activation

M7C4 made the v5 staged-sync schema the tenant data-plane migration target at closure while keeping recurring sync execution independently disabled. M7D1 supersedes the active code target with additive v6 candidate storage; the v5 listing-stage contract remains unchanged and cumulative.

The migration runner has two explicit lifecycle kinds:

- `provisioning` for onboarding/in-flight schema work;
- `maintenance` for already-ready tenant data planes below the current schema target.

Maintenance discovery is allowed only for a ready tenant with an active private source/data plane and no active initial/incremental/recovery catalog job. This prevents additive schema DDL from racing an active catalog mutation.

A maintenance upgrade must **not**:

- move a ready catalog back to `provisioning`;
- replay or edit historical onboarding/provisioning steps;
- rebuild the catalog;
- change public catalog authority;
- create incremental Queue work.

Success updates schema metadata while preserving the current serving status. Failure records bounded retry/error evidence while preserving the prior serving state and LKG.

Migration application is version-aware and bounded. Fresh provisioning applies the additive line as one transactional D1 batch per version. Maintenance first idempotently refreshes the existing catalog User Worker with a closed internal migration capability, then reads, applies and verifies isolated state through `TENANT_DISPATCH`; from v4 it applies only the v5 statements plus the v5 identity/ledger completion writes. The command accepts a target version, never caller-provided SQL, and must not resend the cumulative v1-v5 schema as one remote batch. The control-plane schema version advances only after final tenant identity/source verification, so retrying a partially completed additive sequence remains idempotent while the prior LKG continues serving; an already-complete D1 can be reconciled after an interrupted control-plane completion write without replaying DDL. Retryable preparation/dispatch failures use bounded exponential backoff within an attempt and still fall back to the durable migration-job retry without changing LKG.

Maintenance transport failures are persisted with bounded phase-qualified codes for `inspect`, `apply` and `verify`. This preserves private provider details while distinguishing a failure before any schema work from an idempotent apply interruption or a post-apply verification failure.

The M7C4 automatic isolated import canary created its fixture on v5 so trusted-main evidence could not remain green by accidentally validating only the old v4 target. Its separate trusted-main fleet canary began with ready v4 data planes and waited for scheduler-owned maintenance. That proof covered success, safe failure and active-import exclusion while preserving LKG, merchant overrides, serving state and historical onboarding. It did not create migration jobs, produce Queue messages or purge evidence.

`TENANT_SYNC_AUTOMATION_ENABLED=0` remains the production activation boundary after the v5 fleet migration. Schema availability is therefore proven before the native incremental scan/detail path is allowed to run automatically.

## M7D1 candidate state schema v6

M7D1 adds storage authority only. It does not connect incremental dispatch, fetch affected detail, run affected-only CEI, verify candidates, promote candidates or advance a cursor. `TENANT_SYNC_AUTOMATION_ENABLED=0` remains mandatory.

Schema v6 adds a private relational candidate model rooted at `supplier_sync_stage_runs`:

- `supplier_sync_stage_catalog_categories`, `supplier_sync_stage_leagues`, `supplier_sync_stage_teams` and `supplier_sync_stage_facets` store candidate taxonomy and merchandising entities;
- `supplier_sync_stage_media_sources`, `supplier_sync_stage_product_details`, `supplier_sync_stage_product_media`, `supplier_sync_stage_product_categories` and `supplier_sync_stage_product_facets` store normalized affected-detail output without writing canonical product/media rows;
- `supplier_sync_stage_classification_state` records classifier identity plus the exact durable merchant-override version/timestamp used to derive the candidate;
- `supplier_sync_stage_intelligence_state` stores bounded domain-neutral CEI state and provenance;
- `supplier_sync_stage_catalog_meta` stores bounded classification, normalization, navigation and merchandising candidate metadata.

Every candidate row belongs to one opaque `run_id` and is removed by foreign-key cascade only when that exact stage run is deliberately deleted. Candidate products must match both the staged observation and staged event through the same `(run_id, album_source_id, public_product_id)` identity. Product/media/category/facet/classification/intelligence relationships are enforced relationally. Normalized evidence, detailed CEI state and catalog metadata retain bounded valid JSON only where the underlying contracts are structured documents; one opaque catalog JSON blob is not a candidate authority.

The canonical `catalog_*`, `media_sources`, `product_media`, private supplier index and merchant override tables are outside the candidate ownership tree. A candidate cleanup cannot delete or update them. Public runtime readers do not query `supplier_sync_stage_*`, and source URLs/evidence in candidate tables remain private.

The v5→v6 migration is strictly additive and idempotent. It creates tables/indexes, advances tenant identity to 6 and appends ledger version 6 in one transactional version batch. A failed batch leaves the complete v5 schema/LKG authoritative; down migrations and destructive cleanup are prohibited. Merely applying v6 creates no candidate rows.

The immutable User Worker migration map now requires migration-command capability v2. Trusted CI uploads the v6-capable Worker before promoting that marker, so a stale v5 Worker cannot become scheduler-eligible for target 6. The trusted fleet proof starts with ready v5 fixtures and must cover v5→v6 success, controlled failure, active-import exclusion, unrelated-tenant isolation, contiguous ledger `1,2,3,4,5,6`, preservation of v5 listing-stage evidence/LKG/override/onboarding and zero candidate rows produced by the migration itself. It remains scheduler-owned and produces no Queue message manually.

Retention duration for promoted, preserved, quarantined and failed candidate evidence remains an operational/product decision. Until that decision is explicit, failures retain evidence and cleanup must use an exact audited run/fixture list; schema v6 does not add automatic age-based deletion.

## Remaining M7 execution contract

The roadmap formally orders M7D2 through M7E. Each slice is a bounded safety claim; no slice may enable recurring sync before the activation-only M7E change.

### M7D2 — Controlled Enrollment and Scheduling Guard

Commercial outcome: start a future pilot without exposing every eligible merchant to the same operational risk.

Required contract:

- global activation **and** explicit tenant/source enrollment are both required;
- every existing tenant/source defaults to disabled;
- selection has a bounded per-cycle cap and deterministic reason codes for selected/blocked state;
- initial import, recurring sync, recovery and data-plane migration remain mutually exclusive for the same tenant/source;
- unresolved failed work blocks a conflicting fresh schedule;
- a kill switch can stop new claims without deleting jobs, stages or LKG.

This slice keeps `TENANT_SYNC_AUTOMATION_ENABLED=0`, creates no manual Queue evidence and does not connect the incremental consumer.

Implementation contract:

- `tenant_sync_enrollments` is low-cardinality control-plane authorization keyed by exact `(tenant_id, source_key)`; absence of a row is disabled and a newly inserted row defaults to `disabled`;
- an `enrolled` row requires a bounded lowercase `cohort_key`; merchant-facing APIs do not self-enroll a source, because pilot rollout authority is a platform operation;
- `TENANT_SYNC_ACTIVE_COHORT` must be a valid non-empty cohort and match the row exactly; unset/invalid configuration returns before D1 work;
- `TENANT_SYNC_MAX_JOBS_PER_TICK` is technically bounded to `1..10` and defaults to `1`. It is an operational backpressure control, not a plan entitlement;
- discovery and final job claim both re-check enrollment. Selection also re-checks tenant/source readiness, successful initial import, active/failing import work and tenant data-plane migration conflicts;
- tenant migration jobs in `pending`, `running` or unresolved `failed` state block every source for that tenant. Incremental/recovery failures block the affected source until recovery resolves them;
- one aggregate `decisionCounts` map reports only stable safe reason codes/counts. It contains no tenant/source/provider identifier or supplier evidence;
- the global flag and cohort enrollment are independent kill switches. Turning either off stops new claims without deleting schedules, jobs, stages or LKG;
- `migrations/0020_tenant_sync_controlled_enrollment.sql` is additive, creates no enrollment rows and has no down migration. Previous code can ignore the inert table.

Production deployment for this slice must prove after migration that the table exists, zero sources are enrolled, the active cohort is empty, the per-tick cap is `1` and recurring automation remains `0`. That is an inert control proof, not an Intelligent Sync canary and not permission to activate M7 early.

Production closure: PR `#129` merged as `f49ad81b6dbb64e07e5e7a6b5ab63b0433e00b16`. Trusted deploy run `32754985570` / job `97520332890` proved migration 0020, zero enrollment rows, empty cohort, cap `1` and recurring flag `0`; fleet regression run `32755082787` / job `97520639483` and automatic import/CEI regression run `32755082862` / job `97522279085` passed on that exact SHA with zero manual Queue messages. M7D2 is therefore production-proven as an inert control boundary; recurring Intelligent Sync remains pending and M7D3 is next.

### M7D3 — Incremental Dispatch and Scan-to-Stage

Commercial outcome: detect real supplier changes while preserving the merchant's store during outage or suspicious results.

Required contract:

- the dispatcher resolves tenant/source from control-plane authority rather than browser input;
- the consumer reads paginated private LKG, invokes the provider contract and applies safety before destructive delta semantics;
- observations, events and categories are staged idempotently in bounded chunks;
- partial, unhealthy, empty or implausible scans preserve/quarantine and cannot advance cursor;
- initial import behavior remains unchanged;
- no canonical catalog/index/product/media/CEI write occurs in this slice.

### M7D4 — Staged Affected Detail

Commercial outcome: cost and processing time become proportional to actual change.

Required contract:

- detail fan-out is exactly NEW, CHANGED, CHANGED_MOVED, RESTORED and explicit retries;
- MOVED-only and unchanged observations produce no detail fetch;
- normalized detail, media and evidence are written only to the matching private candidate run;
- delivery, counters and writes are deduplicated and idempotent under at-least-once Queue delivery;
- retry is bounded and an individual failed item prevents verification without damaging the healthy canonical product;
- cross-tenant/source/run payload mismatch fails closed.

### M7D5 — Affected-only CEI Candidate Processing

Commercial outcome: maintain intelligent organization without repeatedly classifying the entire catalog or losing merchant decisions.

Required contract:

- CEI runs only for candidates whose content requires it;
- MOVED-only and unchanged products reuse existing intelligence;
- Normalized Evidence and the generic Domain Runtime remain the Core boundary;
- Sports is selected through the production Knowledge Pack registry, never embedded into CEI Core;
- merchant override is durable truth and is reapplied to the candidate effective view;
- classifier/Knowledge Pack migrations remain explicit jobs, not hidden recurring-sync side effects;
- evidence, claims, confidence and provenance remain private and verifiable.

### M7D6 — Candidate Verification

Commercial outcome: a technically finished but incorrect or privacy-leaking update never reaches shoppers.

Verification must evaluate the complete proposed view — unchanged LKG plus candidates and removals — without mutating LKG. Blocking checks include:

- closed/deduplicated expected and received counts;
- stable identity, uniqueness and stage/run/source ownership;
- product, taxonomy, membership, media and referential integrity;
- required detail for every event that needs it;
- CEI state, claims, provenance, merchandising and merchant-override preservation;
- no supplier URL, raw provider ID, credentials, private media origin or private evidence in the public projection;
- safety-authorized MISSING/REMOVED semantics and no orphaned state.

Only zero blocking findings may transition a stage to `verified`. Repeated verification is idempotent and findings remain private/auditable.

### M7D7 — Promotion Authority Primitive

Commercial outcome: shoppers see the old verified catalog or the new verified catalog, never a half-updated mixture.

Architecture decision: **ACCEPTED — bounded set-based D1 transaction**. Real Cloudflare D1 evidence and the complete decision record live in `M7D7-PROMOTION-AUTHORITY-DECISION-2026-08-25.md`. The generation/version + active-pointer alternative is rejected for V1 at the measured launch envelope.

The serving-authority switch is the commit of one D1 batch transaction:

```text
verified private candidate
→ promotion-envelope + stale-base admission
→ one D1 transaction
   verified -> promoting
   + all canonical set-based mutations
   + promoting -> promoted
→ transaction commit = authority switch
```

Required contract:

- only an exact candidate in `verified` with `sync_candidate_verified_v1`, `verified_at`, safety `proceed` and zero blocking findings may enter;
- candidate verification must be immutable for the promotion attempt;
- the canonical LKG/source authority must still match the base from which the candidate was planned; a stale verified candidate fails closed;
- the first statement CASes that exact stage `verified -> promoting` and every canonical mutation is SQL-gated by the same exact tenant/source/run ownership;
- **all** canonical product, taxonomy, membership, media, CEI/intelligence, merchandising, source-index and same-boundary run-ledger mutations required for serving consistency occur in that same D1 transaction;
- the final in-transaction stage transition is `promoting -> promoted`;
- no independent canonical chunk may become serving truth before commit;
- any statement error rolls the whole transaction back so the prior LKG remains authoritative;
- replay after a successful commit recognizes the same run as already `promoted` and does not repeat the switch;
- competing verified candidates cannot both promote from the same base authority;
- cross-tenant/source/run mismatch fails closed;
- no browser/client-selected identity can choose promotion authority;
- M7D7 does not activate repeated-miss removal: any candidate containing MISSING/REMOVED fails promotion closed with `sync_promotion_removal_not_ready` until M7D9 owns the removal/retention contract, so durable merchant overrides cannot be erased as a side effect of this slice.

Measured V1 admission envelope:

```text
composed products <= 20,000
candidate/public media relationships <= 40,000
batch statements <= 100
SQL statement <= 100 KB
bound params/query <= 100
```

This is an architecture safety envelope, not a commercial-plan limit. Above-envelope work fails closed before canonical mutation with a stable private operational code and remains on prior LKG until the envelope is deliberately re-measured/versioned. The implementation must use set-based joins rather than per-product bound parameters and must prove the real production-shaped relationship workload stays safely inside the measured D1 boundary.

Trusted-main D1 evidence run `32873067956` / job `97884460496` on SHA `581d73f27aa457be0b71685a38500bc3ff70615f` modeled 20,000 products, 40,000 media relationships and about 140,000 canonical row changes. The single transaction completed in 1,374.0 ms wall / 436.537 ms internal SQL, rolled back completely under a forced middle-statement failure, and five concurrent readers observed only the complete post-commit revision after queueing behind the write. The ephemeral probe D1 was deleted and production catalog mutation remained false.

The generation-pointer alternative measured a 0.235 ms internal pointer update, but requires full generation materialization, generation-scoped serving queries, storage/write amplification and a larger fleet/schema migration. It is therefore not selected for V1. Reconsideration requires a new versioned decision if the measured catalog envelope grows materially, the set-based transaction approaches D1 limits, reader queueing violates storefront SLOs or historical generations become an independent requirement.

Crash contract:

- before batch invocation: stage remains verified, old LKG serves;
- during batch or statement failure: transaction rollback, old LKG serves, no partial promotion;
- after commit but before caller acknowledgement: stage is durably promoted and new canonical state serves; replay recognizes the promoted run;
- cursor/schedule/control-plane commit remains **M7D8**, strictly after durable promotion;
- promoted/failed evidence is retained for recovery; automatic recovery/replay closure remains **M7D10**.

M7D7 implementation remains a separate claim. The accepted architecture does not itself make M7D7 Production Green. The implementation has one dedicated promotion primitive and the legacy stage promotion path fails closed; Production Green still requires trusted-main production-shaped regression/canary proof for verified-only entry, stale-base/competing-run CAS, rollback/atomic authority switch, over-envelope rejection, idempotent replay, tenant isolation, privacy, merchant-override preservation and unchanged cursor/removal/activation state.

### M7D8 — Verified Promotion and Cursor Commit

Commercial outcome: publish an approved update once and resume safely after interruption.

Required state flow:

```text
verified -> promoting -> promoted
                         ↓
               cursor/schedule commit
```

Promotion requires an idempotency key plus phase-aware lease/compare-and-set. Unverified stages are rejected. Cursor and schedule never advance before the authority switch and complete finalization. Redelivery after the switch recognizes already-promoted state and commits the remaining control metadata once. Cleanup cannot delete canonical state or the rollback authority.

### M7D9 — Repeated Miss and Safe Removal

Commercial outcome: remove products truly gone from the supplier without deleting healthy products because of a failed scan.

Required contract:

- only independent complete, healthy, plausible and safety-authorized promoted runs progress miss state;
- duplicate delivery/run does not increment twice;
- incomplete scope or category exit cannot reduce unrelated/global membership;
- threshold and scope identity are explicit and versioned;
- REMOVED is a candidate event that must verify and promote;
- RESTORED resets/progresses the ledger deterministically and can safely return a removed product;
- outage, 429/5xx, malformed HTML, pagination failure, zero and catastrophic drop never progress removal.

### M7D10 — Recovery, Replay and Operational Observability

Commercial outcome: ordinary failures recover without daily owner intervention while exceptions remain diagnosable.

Required proof covers duplicate Queue delivery, expired lease/reclaim, crash between listing chunks, affected-detail failure, crash before/after verify, crash before/during/after authority switch, post-promotion redelivery, partial-item error, DLQ/replay and unrelated-tenant continuity. Retries are bounded, errors are phase-aware and safe, unresolved failed work blocks conflicts, and evidence is retained until exact audited cleanup. Global Queue/DLQ purge and manual Queue messages are not proof mechanisms.

### M7D11 — Safe Change and Review Feed

Commercial outcome: support the product principle “automate normal operations; surface only exceptions.”

The backend projection must represent NEW, CHANGED, MOVED, RESTORED, REMOVED, review-required, preserved and quarantined outcomes with stable opaque public IDs, tenant-scoped authorization, pagination and redaction. It must not expose supplier URL, raw provider ID, private media origin, evidence, credentials or infrastructure terminology. Whether a full customer UI closes M7 or moves to M11 remains a product-scope decision; a safe backend boundary cannot be skipped.

### M7E — Deliberate Activation

M7E is an activation-only PR after M7D2–M7D11 and explicit user approval. It contains no feature code or migration.

Before changing the recurring gate, decide the authorized tenant/source cohort, operating window, per-tick cap, expansion criteria and rollback owner. The trusted scheduler-owned production canary must use the exact deployed code and zero manual Queue messages. It must exercise NEW, CHANGED, MOVED, RESTORED, safe threshold removal, incomplete/implausible quarantine, LKG preservation, affected-only CEI, merchant override, tenant isolation, final cursor ordering and explained clean Queue/DLQ state.

Failure first disables global/cohort scheduling, blocks new claims, preserves LKG/stage/evidence and lets in-flight work reach a documented safe boundary. It never deletes data or purges evidence to appear green.

## M7A scope boundary

M7A establishes and regression-tests the decision contract only.

M7A intentionally does **not** yet:

- replace the production incremental workflow;
- enable new tenant recurring schedules;
- mutate production catalog based on the new guard;
- promote tenant sync cursors;
- implement the customer change/review feed;
- trigger CEI reclassification from sync deltas.

Those are later M7 slices after the decision model is proven.

This separation is deliberate: destructive production behavior must not be wired before the safety contract is explicit and tested.

## Required regression fixtures

At minimum, sync safety changes must prove:

- healthy complete normal delta proceeds;
- partial scan preserves last-known-good;
- complete scan with disqualifying failures preserves last-known-good;
- empty complete scan quarantines;
- catastrophic complete volume drop quarantines;
- first healthy scan without baseline can proceed;
- quarantined decision prevents the existing planner from advancing missing/removal;
- safe authoritative decision allows existing repeated-miss behavior;
- provider/domain vocabulary is absent from the generic safety Core;
- staging never mutates canonical LKG before verification;
- promotion before verification is a no-op;
- quarantined/preserved runs cannot promote;
- large healthy observations are staged in bounded chunks rather than one D1 statement per product;
- stage scope/run identity is opaque and tenant/source bound;
- canonical sync-run status closes only according to safe stage outcome/promotion;
- ready-tenant schema maintenance preserves serving status on success and failure;
- schema maintenance does not overlap active tenant catalog import/sync work.

Existing scoped-sync tests must continue proving detach vs global remove behavior.

## Final decision rule

Before changing sync behavior ask:

> Can this run prove it is complete, healthy and plausible enough to reduce or remove previously verified catalog state?

If the answer is not yes, preserve the last-known-good catalog and block destructive progression.
