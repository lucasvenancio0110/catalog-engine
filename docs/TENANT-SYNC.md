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
7. Detail fetch is limited to NEW/CHANGED/RESTORED or retry-required products; unchanged products are not re-fetched by default.
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

M7C4 makes the v5 staged-sync schema the current tenant data-plane migration target while keeping recurring sync execution independently disabled.

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

The automatic isolated import canary creates its fixture on the current v5 schema so trusted-main evidence cannot remain green by accidentally validating only the old v4 target.

`TENANT_SYNC_AUTOMATION_ENABLED=0` remains the production activation boundary after the v5 fleet migration. Schema availability is therefore proven before the native incremental scan/detail path is allowed to run automatically.

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
