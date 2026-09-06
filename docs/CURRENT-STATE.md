# Catalog Engine — Current State

Status: **Living implementation/proof truth**  
Snapshot refreshed: **2026-09-06**  
Repository: `lucasvenancio0110/catalog-engine`

This document is intentionally compact. It records current execution truth; focused normative documents own durable contracts and closure documents retain detailed historical evidence.

## Live baseline

- Current application-code `main` before this documentation-only refresh: `80ff677fb4da30da25063f44c409560984b22c63` — `PB9: serialize runtime activation after scheduler prerequisites (#255)`.
- PB8 closure commit on main: `232b57450f57aa69a494a2724d2691d69f666b3e` — `PB8: close real tenant import Production Green (#243)`.
- Last application Production SHA proven before the pending #255 deployment: `12786b36bede6b82163ad5f0a7fcf31fa3139ec0` — `PB9: wire tenant runtime activation into production scheduler (#252)`.
- PB9 implementation, trusted diagnostics and scheduler-order fix are integrated through PRs #244, #253, #254 and #255.
- The deploy run for application SHA `80ff677fb4da30da25063f44c409560984b22c63` is pending behind the serialized `catalog-engine-production-d1` lock while an older trusted production canary completes. Do not bypass or cancel that lock merely to accelerate PB9.
- No open implementation PR existed at this snapshot.
- `HUMAN_GATE_LOCK: INACTIVE`.

## Production activation boundary

```text
TENANT_IMPORT_AUTOMATION_ENABLED=1
TENANT_SYNC_AUTOMATION_ENABLED=0
TENANT_SYNC_ACTIVE_COHORT=""
TENANT_SYNC_MAX_JOBS_PER_TICK=1
```

Automatic **initial tenant import is enabled**. Recurring tenant Intelligent Sync remains **disabled**. M7E remains separately decision-gated.

## Proven first-merchant state

PB0 through PB8 of the owner-authorized first-real-merchant campaign are closed within their bounded contracts.

PB8 — Real Tenant Import is **PRODUCTION GREEN**. Detailed proof is owned by `PB8-CLOSURE-2026-09-06.md`.

The real CROCCODILOS isolated tenant proof established:

- 6,104 discovered and 6,104 terminal details;
- 6,097 persisted products and 15,396 media links;
- CEI/classification success for 6,097 products: 5,869 automatic, 228 review, 0 unknown;
- verification success for 6,097 products with 0 findings;
- scan Queue = 0 and detail Queue = 0;
- scan DLQ = 0 and detail DLQ = 0;
- no private identifiers exposed by the proof;
- recurring Intelligent Sync remained OFF.

The historical default tenant remains an explicit compatibility tenant and must never be used as an implicit fallback for CROCCODILOS or any new merchant.

## Active execution point

PB9 — Private Preview is **INTEGRATED / PRODUCTION PROOF IN PROGRESS**, not Production Green.

PB9 customer outcome:

> An authenticated merchant can preview the real verified tenant before custom-domain publication.

The private-preview implementation is integrated on `main` and retains these boundaries:

- server-side membership resolves the exact tenant runtime; browser input never supplies Worker/D1/runtime authority;
- preview uses a short-lived host-only `__Host-` `HttpOnly` / `Secure` / `SameSite=Strict` capability whose SHA-256 hash is stored in control-plane D1;
- membership, verified catalog runtime and current zero-finding verification are revalidated server-side;
- preview catalog/media traffic is read-only and tenant-scoped;
- anonymous, invalid, expired, revoked, cross-tenant and default-tenant fallback paths fail closed;
- preview responses remain private/non-indexable and must not expose supplier URLs, raw provider IDs, tenant/principal IDs, D1/Worker locators, Cloudflare identifiers or private CEI evidence;
- private preview remains separate from public custom-domain publication authority.

### Trusted production evidence now proven

Against the deployed PB9 baseline before #255:

- migration `0024_tenant_private_preview_sessions.sql` and PB9 application wiring were deployed successfully;
- trusted proof resolves exactly one non-default CROCCODILOS tenant with an active owner;
- the isolated tenant has 6,097 real products;
- current catalog verification is `success` with 0 findings;
- anonymous preview, cross-tenant preview and default-tenant sentinel access all fail closed;
- private identifiers remain hidden;
- recurring Intelligent Sync remains OFF;
- Cloudflare platform account/token bindings are present on the Worker and the `*/5` cron trigger is deployed.

The remaining red condition on that deployed baseline is tenant catalog-runtime activation. Safe diagnostics proved:

```text
provisioningStatus=running
provisioningStep=domain
instanceStatus=provisioning
schemaVersion=8
databaseStatus=active
workerStatus=active
verificationStatus=success
verificationFindings=0
runtimeStatus=pending
runtimeVersion=0
targetRuntimeVersion=1
runtimeJobStatus=none
```

The exact runtime-discovery predicates therefore evaluate **discoverable=true**, while no `tenant_runtime_jobs` row is materialized. This eliminated merchant lifecycle state, data-plane readiness, verification readiness, platform-secret presence and cron configuration as the immediate blockers.

### Current corrective slice

PR #255 changed only scheduler ordering: `runDueTenantRuntimes(env)` no longer competes inside the D1-heavy `Promise.allSettled` batch. It runs after the prerequisite scheduler batch settles, preserving the existing bounded runtime runner and safe logging while reducing control-plane D1 contention and honoring verification-before-runtime ordering.

Exact PR #255 head `11d5ce505fe6b52d687e570e9075900e35189e67` passed all observed PR workflows, including:

- Frontend quality;
- Validate SaaS control plane;
- Validate customer portal;
- Validate tenant runtime isolation;
- Cloudflare PB9 private preview proof PR contract;
- M7D10 recovery/replay canary contract;
- incremental promotion/finalization canary contracts.

It was squash-merged as application SHA `80ff677fb4da30da25063f44c409560984b22c63`.

Not yet proven at this snapshot:

- production deployment success for application SHA `80ff677fb4da30da25063f44c409560984b22c63`;
- a post-deploy cron tick that materializes/processes the CROCCODILOS runtime job;
- verified runtime version 1 for the real tenant;
- authenticated shell/feed/product/media proof against that verified runtime;
- final PB9 closure / Production Green.

## Exact continuation action

1. allow the existing serialized production-D1 canary to release the mutation lock naturally;
2. require the pending deploy of exact application SHA `80ff677fb4da30da25063f44c409560984b22c63` to complete successfully;
3. require at least one post-deploy scheduler opportunity, then execute the trusted PB9 production proof;
4. if the proof remains red, use the safe runtime/job diagnostics to fix only the first proven runtime activation failure;
5. if the proof is fully green, write PB9 closure, refresh this state to Production Green and discover the next approved PB10 slice.

## Broader roadmap boundary

- M7A through M7D10: **PRODUCTION GREEN** within their bounded contracts.
- M7D11: future/planned unless live GitHub later proves otherwise.
- M7E: decision-gated; recurring sync remains OFF.
- M9A: **PRODUCTION GREEN**.
- M9B: paused by the owner-authorized PB0–PB12 sequencing exception.
- After PB12, return to the roadmap-defined paused point unless a later explicit sequencing decision changes it.

## Continuity rule

Before every continuation, revalidate live `main`, open PRs, active branch, CI, deploy/proof and this document. If live evidence advances beyond this snapshot, update this document to the level actually proven rather than repeating completed work.

Do not claim PB9 or later slices Green without their required integrated and production evidence.
