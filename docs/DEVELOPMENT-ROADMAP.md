# Catalog Engine — Master Development Roadmap

Status: **Living execution roadmap**  
Snapshot: **2026-08-27 after M7D7 production reconciliation**

This document owns milestone sequencing and current execution order. Product and architecture invariants remain in their focused normative documents. Production evidence is owned by closure/evidence records and the live GitHub/Cloudflare proof chain.

## Status vocabulary

- **PLANNED** — approved future work, not yet implemented.
- **IN PROGRESS** — implementation exists but the required evidence level is not yet complete.
- **CODE GREEN** — code/secret-free gates passed, but trusted-main production evidence is not complete.
- **PRODUCTION GREEN** — the project-required production proof passed on the exact trusted-main implementation SHA.
- **BLOCKED** — prerequisite, evidence or safety issue prevents the slice from advancing.

## Master sequence

```text
M1  Production safety foundations
M2  Code/data deployment separation
M3  Design Foundation
M4  Provider Engine
M5  Automatic isolated tenant import
M6  CEI Core + Sports Knowledge Pack v1
M7  Intelligent Sync v2
M8+ Later product/platform expansion
```

Current execution milestone: **M7 Intelligent Sync v2**.

## Completed foundation milestones

### M1 — Production safety foundations

Status: **PARTIAL / OPEN DEBT**

Implemented safety foundations are real, but the milestone is not closed because repository governance/recovery work remains. Open debt includes main-branch protection, direct-push governance, third-party Action/toolchain governance, production migration parity verification and backup/rollback/recovery runbooks.

M1 debt does not authorize weakening current M7 gates.

### M2 — Code/data deployment separation

Status: **COMPLETE**

Application deployment and catalog business-data publication are separate operational concerns. Application deploy must not silently replace commercial catalog data.

### M3 — Design Foundation

Status: **COMPLETE**

The design system, runtime frontend architecture and dependency policy are established. Fuse.js is not part of the current live M3 search runtime.

### M4 — Provider Engine

Status: **COMPLETE**

Supplier ingestion is provider-neutral at the contract boundary. Provider-native URLs/evidence remain private and are not public catalog authority.

### M5 — Automatic isolated tenant Queue import

Status: **PRODUCTION GREEN**

Durable production path:

```text
scheduler
→ scan Queue
→ isolated scan consumer
→ detail Queue
→ isolated detail consumer
→ finalize
→ classify
→ verify
```

Closure: `docs/M5-CLOSURE-2026-08-20.md`.

### M6 — CEI Core + Sports Knowledge Pack v1

Status: **PRODUCTION GREEN**

CEI consumes normalized evidence through a generic core/domain-runtime boundary. Sports v1 is the launch Knowledge Pack. Merchant overrides remain durable business truth and are reapplied rather than overwritten by automatic inference.

Final M6 production implementation checkpoint: `53795ab25600d3c7f44034e610b6f54580fcc9d0`.

Closure: `docs/M6-CLOSURE-2026-08-21.md`.

## M7 — Intelligent Sync v2

Status: **ACTIVE EXECUTION MILESTONE**

### Global M7 invariants

Every M7 slice must preserve:

- tenant isolation;
- source/provider evidence privacy;
- `partial scan ≠ delete`;
- catastrophic-diff quarantine;
- last-known-good serving authority until a candidate is verified and promoted;
- no overlapping active incremental/recovery authority for the same tenant/source;
- durable unresolved failures;
- merchant override preservation;
- no recurring production activation before M7E;
- no gate weakening to manufacture green status.

Production recurring sync remains:

```text
TENANT_SYNC_AUTOMATION_ENABLED=0
TENANT_SYNC_ACTIVE_COHORT=
TENANT_SYNC_MAX_JOBS_PER_TICK=1
```

### M7A — Catastrophic-diff safety

Status: **PRODUCTION-PROVEN FOUNDATION**

Partial/disqualified scans cannot become deletion authority. Implausible complete drops are quarantined and LKG is preserved.

### M7B — Recurring scheduler foundation

Status: **PRODUCTION-PROVEN FOUNDATION / ACTIVATION OFF**

Provides deterministic tenant/source scheduling, conflict checks, durable exception handling and a separate activation boundary.

### M7C1 — Provider-neutral listing delta semantics

Status: **PRODUCTION-PROVEN FOUNDATION**

Shared semantics:

`NEW / CHANGED / CHANGED_MOVED / MOVED / RESTORED / MISSING / REMOVED`.

### M7C2 — Incremental scan planning

Status: **PRODUCTION-PROVEN FOUNDATION**

Reads paginated LKG and plans provider-neutral delta without mutating canonical state.

### M7C3 — Private staged sync state

Status: **PRODUCTION-PROVEN FOUNDATION**

Introduces private run-scoped staging and keeps canonical authority untouched before verification/promotion.

### M7C4 — Existing-tenant schema-v5 fleet activation

Status: **PRODUCTION GREEN**

Additive migration path for existing tenants, with maintenance isolation and fail-closed preparation/migration evidence.

### M7D1 — Candidate-state schema v6

Status: **PRODUCTION GREEN**

Adds private candidate detail/media/CEI/merchandising state without changing canonical serving authority.

### M7D2 — Controlled tenant/source enrollment

Status: **PRODUCTION GREEN FOUNDATION / PRODUCTION ENROLLMENT EMPTY**

Adds default-disabled enrollment, active-cohort gating and per-cycle cap. This does not activate recurring sync.

### M7D3 — Live incremental scan to private stage

Status: **PRODUCTION GREEN**

Eligible incremental job uses the real dispatcher/Queue/provider/safety/delta path and stops in private staged state while canonical LKG/storefront remain unchanged.

Closure: `docs/M7D3-CLOSURE-2026-08-25.md`.

### M7D4 — Affected-detail candidate completion

Status: **PRODUCTION GREEN**

Reuses the existing detail Queue/Provider Engine to fetch exactly affected candidates and persists complete run-scoped detail/media/evidence privately.

Closure: `docs/M7D4-CLOSURE-2026-08-25.md`.

### M7D5 — Affected-only CEI candidate processing

Status: **PRODUCTION GREEN**

Reprocesses only affected candidate products through the production CEI domain runtime and reapplies durable merchant overrides into run-scoped private candidate state.

Closure: `docs/M7D5-CLOSURE-2026-08-25.md`.

### M7D6 — Complete private candidate verification

Status: **PRODUCTION GREEN**

Strict verification proves the composed candidate view and leaves a successful run in:

```text
tenant stage = verified
control job status = finalizing
control job phase = finalize
```

Canonical LKG/catalog/intelligence/storefront authority is unchanged by D6.

Closure: `docs/M7D6-CLOSURE-2026-08-25.md`.

### M7D7 — Atomic promotion authority

Status: **PRODUCTION GREEN**

Trusted-main implementation SHA:

`725854afc408bb6177aa071e2797051369c4040c`

PR:

`#150 — m7d7: add atomic promotion authority primitive`

Exact trusted-main proof:

- Queue activation `33034446742` = SUCCESS;
- deploy `33034446810` = SUCCESS;
- fleet canary `33034549918` = SUCCESS;
- cumulative M7D4→M7D7 canary `33034549923` = SUCCESS;
- automatic import canary `33034549968` = SUCCESS;
- provider quality `33034446727` = SUCCESS;
- frontend quality `33034446702` = SUCCESS.

D7 establishes schema-v7 serving-authority CAS semantics and one bounded atomic D1 canonical promotion transaction. Replay of the exact already-promoted run is idempotent; a stale competing base fails closed.

D7 intentionally leaves the control-plane job `finalizing/finalize` and does not advance cursor/schedule metadata.

Closure: `docs/M7D7-CLOSURE-2026-08-27.md`.

### M7D8 — Verified Promotion and Cursor Commit

Status: **PLANNED — NEXT OFFICIALLY APPROVED SUBMILESTONE**

Bounded claim:

Connect the D6 `verified` state to the D7 atomic promotion primitive, then commit the control-plane cursor/schedule/finalization metadata only after the exact tenant serving authority is durably `promoted`.

Mandatory order:

```text
verified candidate
→ M7D7 atomic canonical transaction
→ promoted
→ D8 cursor / schedule / control metadata commit
```

Required invariants:

- cursor/schedule/control authority never advances before canonical promotion;
- exact tenant/source/run ownership;
- phase-aware lease/CAS finalization;
- duplicate/replay safety;
- stale/competing execution exclusion;
- if the process dies after D7 commit but before control commit, retry observes `promoted`, does not promote again and commits only remaining control metadata exactly once;
- scheduler must stop advancing `next_sync_at` when merely creating a due incremental job;
- production recurring sync remains disabled and cohort remains empty.

Required proof must include the project-normal quality gates plus exact trusted-main production evidence for promotion ordering, replay-after-promotion finalization, schedule/cursor advancement only after promotion, tenant/source/run isolation and unchanged M7D3–M7D7 regressions.

Non-goals:

- no MISSING/REMOVED application;
- no full recovery/DLQ policy;
- no change feed;
- no production cohort activation;
- no M8 work.

### M7D9 — Missing / Removed lifecycle

Status: **PLANNED — NOT STARTED**

Owns safe absence/removal authority after D8 ordering/finalization is proven. Must preserve `partial scan ≠ delete` and the configured miss threshold.

### M7D10 — Recovery / DLQ lifecycle

Status: **PLANNED — NOT STARTED**

Owns operational recovery, retries, DLQ handling and durable failure resolution for recurring sync.

### M7D11 — Change feed / downstream projection

Status: **PLANNED — NOT STARTED**

Owns safe post-promotion change projection/notification semantics.

### M7E — Controlled recurring activation

Status: **PLANNED — NOT STARTED**

Only after D8–D11 production evidence may production cohort enrollment/recurring activation be considered. Activation must remain bounded, reversible and observable.

## After M7

Later milestones remain intentionally outside the current execution scope. No M8+ feature should be pulled into an M7D slice merely because it is adjacent or convenient.

## Execution rule

One autonomous development conversation may execute at most one officially approved submilestone.

At the time of this snapshot:

```text
completed through: M7D7 PRODUCTION GREEN
next approved: M7D8 Verified Promotion and Cursor Commit
later slices: not started
```

A later conversation must revalidate GitHub, current documentation, code, CI and production evidence before trusting this snapshot.
