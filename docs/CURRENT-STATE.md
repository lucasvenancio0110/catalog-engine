# Catalog Engine — Current State

Status: **Living operational truth**  
Snapshot: **2026-08-27 after live reconciliation of M7D7 production evidence**  
Purpose: record what is implemented and proven now. Durable product/architecture contracts continue to live in their focused normative documents.

## How to use this document

Authority and contributor rules are defined by `AGENTS.md`, `docs/DOCUMENT-GOVERNANCE.md`, `docs/DOCUMENT-MAP.md` and `docs/DEVELOPMENT-CONTINUITY.md`.

Historical closure evidence must not be treated as the mutable current-state owner. Relevant production closures include:

- `docs/M5-CLOSURE-2026-08-20.md`;
- `docs/M6-CLOSURE-2026-08-21.md`;
- `docs/M7D3-CLOSURE-2026-08-25.md`;
- `docs/M7D4-CLOSURE-2026-08-25.md`;
- `docs/M7D5-CLOSURE-2026-08-25.md`;
- `docs/M7D6-CLOSURE-2026-08-25.md`;
- `docs/M7D7-CLOSURE-2026-08-27.md`.

## Repository baseline

- repository: `lucasvenancio0110/catalog-engine`;
- default branch: `main`;
- package: `0.9.0`;
- Node: 22+;
- frontend: Vite + vanilla ES modules;
- production application is not React/Vue/Svelte/Angular.

## Milestone state

- M1 production safety foundations: **partial / still open**;
- M2 code/data deployment separation: **complete**;
- M3 Design Foundation: **complete**;
- M4 Provider Engine: **complete**;
- M5 automatic tenant Queue import: **PRODUCTION GREEN**;
- M6 CEI Core + Sports Knowledge Pack v1: **PRODUCTION GREEN**;
- M7 Intelligent Sync v2: **active execution milestone**;
- M7D3 live incremental scan to private stage: **PRODUCTION GREEN**;
- M7D4 affected-detail candidate completion: **PRODUCTION GREEN**;
- M7D5 affected-only CEI candidate processing: **PRODUCTION GREEN**;
- M7D6 complete private candidate verification: **PRODUCTION GREEN**;
- M7D7 atomic promotion authority: **PRODUCTION GREEN**;
- M7D8 verified promotion + cursor/schedule/control commit: **NEXT APPROVED SUBMILESTONE**;
- M7D9+ remain future work and are not started by this snapshot;
- M7E recurring activation remains future work and disabled.

## Current production implementation checkpoint

The latest production implementation checkpoint relevant to Intelligent Sync is M7D7:

- PR `#150 — m7d7: add atomic promotion authority primitive`;
- trusted-main implementation SHA `725854afc408bb6177aa071e2797051369c4040c`;
- Queue consumer activation run `33034446742` = **SUCCESS**;
- application deploy run `33034446810` = **SUCCESS**;
- tenant data-plane fleet canary run `33034549918` = **SUCCESS**;
- cumulative M7D4→M7D7 production canary run `33034549923` = **SUCCESS**;
- automatic tenant import canary run `33034549968` = **SUCCESS**;
- provider-engine quality run `33034446727` = **SUCCESS**;
- frontend quality run `33034446702` = **SUCCESS**.

The cumulative production canary job `98394306811` checked out exactly `725854afc408bb6177aa071e2797051369c4040c`, waited for exact-SHA Queue consumer activation, proved affected detail + CEI + verification + atomic promotion authority, then published successful M7D4–M7D7 evidence.

The later commits `cf026808ff8809c2cd9458ae51fb229635398ec9` and `dbfe44f298fde639d125d386ad1686ec65879dcf` are documentation/continuity capture points, not replacements for the M7D7 production implementation SHA.

## M7 implementation truth through M7D7

### Safety and scheduler foundation

M7 preserves these non-negotiable rules:

- partial/disqualified scan never becomes removal authority;
- catastrophic complete drops are quarantined rather than blindly applied;
- one tenant/source must not gain overlapping active incremental/recovery work;
- unresolved incremental/recovery failures remain durable blockers;
- recurring sync activation is gated separately from the implementation primitives.

### Provider-neutral delta and private staging

Provider-neutral listing semantics own:

`NEW / CHANGED / CHANGED_MOVED / MOVED / RESTORED / MISSING / REMOVED`.

The live incremental path is capable of:

```text
scheduler-created incremental job
→ existing import dispatcher
→ scan Queue
→ provider scan
→ safety decision
→ provider-neutral delta
→ private run-scoped stage
→ affected detail Queue fan-out
→ private affected detail/media/evidence
→ affected-only CEI candidate processing
→ complete private verification
→ atomic canonical promotion authority
```

MISSING/REMOVED application remains deliberately outside M7D7 and is not activated here.

### Tenant data-plane schema

Current tenant data-plane target is schema **v7**.

Schema v7 includes the M7D7 authority contract:

- `catalog_serving_authority` — tenant canonical serving revision and last promoted run/source;
- `supplier_sync_stage_authority` — immutable run-scoped base authority revision.

The current fleet migration-command capability is **v3**.

### Candidate verification

M7D6 leaves a successful incremental candidate in:

```text
tenant data plane: supplier_sync_stage_runs.state = verified
control plane: tenant_import_jobs.status = finalizing
control plane: tenant_import_jobs.phase = finalize
```

The verification contract is `sync_candidate_verified_v1` and blocks structural/candidate corruption rather than weakening gates for ordinary review/research signals.

### Atomic promotion authority

M7D7 adds the promotion primitive. Admission requires the exact run/tenant/source identity, a valid verified candidate, current authority base revision, current merchant-override provenance, no public source leak, no disqualifying error and the bounded promotion envelope.

The canonical transaction:

1. CAS-claims `verified → promoting` only against the exact base authority revision;
2. writes the composed canonical catalog/LKG/CEI/media/meta state;
3. advances `catalog_serving_authority.revision` exactly once and records the exact run/source;
4. marks the stage `promoted` only when the authority row proves the exact transaction committed.

Replay of the same already-promoted run is idempotent. A competing stale-base run fails closed.

Crucially, M7D7 intentionally does **not** advance control-plane schedule/cursor metadata. Its production canary proved the control job still remained `finalizing/finalize` after promotion.

## Production activation boundary

Production remains deliberately disabled for recurring Intelligent Sync:

```text
TENANT_IMPORT_AUTOMATION_ENABLED=1
TENANT_SYNC_AUTOMATION_ENABLED=0
TENANT_SYNC_ACTIVE_COHORT=
TENANT_SYNC_MAX_JOBS_PER_TICK=1
```

`TENANT_SYNC_AUTOMATION_ENABLED=0` is a mandatory rollback/safety state, not a temporary test deficiency.

Controlled enrollment exists but production must continue with zero enrolled rows until the later activation milestone explicitly changes that policy.

## Known implementation gap that defines M7D8

The current scheduler creates a deterministic incremental job for a due schedule and also advances `tenant_sync_schedules.next_sync_at` at scheduling time.

That behavior predates the verified-promotion finalization contract and is now the exact gap M7D8 must close.

M7D8 must enforce:

```text
verified candidate
→ M7D7 atomic canonical transaction
→ promoted
→ cursor / next schedule / control metadata commit
```

The cursor/schedule/control authority must never advance before canonical promotion commits.

If the process dies after the tenant D1 promotion transaction but before the control-plane commit, retry must:

- observe the exact stage already `promoted`;
- not promote again;
- commit only the remaining control metadata;
- preserve exact tenant/source/run ownership;
- use phase-aware lease/CAS semantics;
- make duplicate/replay safe and exclude stale/competing execution.

## M7D8 scope boundary

M7D8 is the next approved bounded claim. It may change only what is required to complete verified promotion finalization and schedule/cursor/control commit safely.

M7D8 does **not** authorize:

- MISSING/REMOVED lifecycle application — M7D9;
- full recovery/DLQ policy — M7D10;
- change-feed projection — M7D11;
- production recurring-sync activation/cohort rollout — M7E;
- M8 work.

## Production safety that must not regress

### Credential boundary

Ordinary PR validation remains secret-free. Production Cloudflare credentials are restricted to trusted-main or deliberately privileged workflows.

### Code/data deployment separation

Application deploy owns code/schema/platform deployment and smoke verification. It must not replace commercial catalog business data as a side effect.

### Tenant isolation

High-cardinality catalog/sync/CEI state belongs in the tenant data plane. Low-volume scheduling/orchestration state belongs in the control plane. Provider source URLs and supplier-native evidence remain private.

### Queue discipline

Do not purge global Queues merely to make a smoke/canary pass. Preserve failure evidence before targeted cleanup. Queue/DLQ hygiene must be proven without destroying unrelated evidence.

### Fail closed

Do not weaken a gate to obtain green status. Diagnose the actual defect, correct it, rerun the appropriate evidence path, and retain proof of the exact implementation SHA.

## Remaining M1 debt

Still open outside the M7D8 bounded claim:

- protect `main` with required checks/review policy;
- govern direct-push automation;
- review/pin third-party Actions/toolchain deliberately;
- production migration parity verification;
- backup/rollback/recovery runbooks.

## Next action

The repository has been reconciled through **M7D7 PRODUCTION GREEN**.

The next officially approved submilestone is:

**M7D8 — Verified Promotion and Cursor Commit**.

No later M7D9/M7D10/M7D11/M7E/M8 scope is authorized by this state document.
