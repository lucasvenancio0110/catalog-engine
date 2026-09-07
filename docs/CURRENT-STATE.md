# Catalog Engine — Current State

Status: **Living implementation/proof truth**  
Snapshot refreshed: **2026-09-07**  
Repository: `lucasvenancio0110/catalog-engine`

This document is intentionally compact. Focused normative documents own durable contracts; closure documents retain detailed historical evidence; live GitHub/production evidence remains authoritative.

## Live baseline

- Exact application Production SHA: `9b6b5251fd59eb5ea82d30b3f1f8a7ff19e3319b` — merge of PR #288.
- Trusted application deploy `34128489551`: **SUCCESS** on the exact Production SHA.
- IC2 dedicated trusted production proof `34130174224`, attempt `3`, job `101776923895`: **SUCCESS**.
- Commit status `catalog-engine/ic2-production-proof = success` on the Production SHA.
- Exact-SHA PB9 proof `34130174234`: **SUCCESS**.
- PB6/PB7/PB8/PB9 and the relevant tenant-ingestion regressions remained **SUCCESS** on the same Production SHA.
- Open pull requests immediately before the IC2 closure branch: none.
- `HUMAN_GATE_LOCK: INACTIVE` at the latest durable operational snapshot; every autonomous resume must revalidate it.

## Production activation boundary

```text
TENANT_IMPORT_AUTOMATION_ENABLED=1
TENANT_SYNC_AUTOMATION_ENABLED=0
TENANT_SYNC_ACTIVE_COHORT=""
TENANT_SYNC_MAX_JOBS_PER_TICK=1
```

Automatic **initial tenant import is enabled**. Recurring tenant Intelligent Sync remains **disabled**. M7E remains separately decision-gated.

## Proven first-merchant state

PB0 through PB9 of the owner-authorized first-real-merchant campaign remain closed within their bounded contracts.

- PB0 — Live Truth + Sequencing Decision: complete/governance green.
- PB1 — Authentication Foundation: **PRODUCTION GREEN**.
- PB2 — Account + Beta Entitlement: **PRODUCTION GREEN**.
- PB3 — Create Store: **PRODUCTION GREEN**.
- PB4 — Branding: **PRODUCTION GREEN**.
- PB5 — Source Connection: **PRODUCTION GREEN**.
- PB6 — Source Scope / Import Decision: **PRODUCTION GREEN**.
- PB7 — Provisioning Progress: **PRODUCTION GREEN**.
- PB8 — Real Tenant Import: **PRODUCTION GREEN**.
- PB9 — Private Preview: **PRODUCTION GREEN**.

The real CROCCODILOS isolated tenant has approximately:

- 6,097 persisted products and 15,396 media links;
- CEI/classification completed;
- verification completed with 0 findings;
- full catalog runtime verified;
- authenticated PB9 private preview, product detail and media access proven;
- anonymous, cross-tenant and default-tenant access proven fail-closed;
- recurring Intelligent Sync still OFF.

The historical default tenant remains an explicit compatibility tenant and must never become an implicit fallback for a real merchant.

## Instant Catalog execution state

Owner contract: `docs/INSTANT-CATALOG.md`.

Approved temporary order:

```text
PB9
-> IC0 -> IC1 -> IC2 -> IC3 -> IC4 -> IC5 -> IC6
-> PB10 -> PB11 -> PB12
```

Current statuses:

- IC0 — Governance + performance contract: **COMPLETE / GOVERNANCE GREEN**; PR #272.
- IC1 — Real latency baseline + branded creation UX: **PRODUCTION GREEN**; detailed proof in `IC1-CLOSURE-2026-09-07.md`.
- IC2 — Instant seed + construction preview: **PRODUCTION GREEN**; detailed proof in `IC2-CLOSURE-2026-09-07.md`.
- IC3 — Streaming/parallel listing discovery: **PLANNED — NEXT APPROVED SLICE**.
- IC4 — Adaptive detail swarm: **PLANNED**.
- IC5 — Warm tenant cell pool: **PLANNED**.
- IC6 — Fresh beta speed/isolation proof: **PLANNED**.
- PB10 remains approved but paused until IC6 reaches its required Green state.

PB9 stays the L2 verified Last Known Good authority while earlier construction/catalog paths are developed.

## IC1 historical latency baseline

The first real merchant baseline established before Instant Catalog acceleration was:

```text
import start = 2,121,000 ms = 35m21s
listing scan complete = 2,290,000 ms = 38m10s
full initial import complete = 8,583,000 ms = 2h23m03s
classification complete = 12,326,000 ms = 3h25m26s
verification complete = 12,621,000 ms = 3h30m21s
```

These values are engineering baseline evidence, **not a customer ETA**.

## IC2 Production Green evidence

Implementation was delivered across bounded PRs #276–#281, followed by the dedicated proof and proof/deployment hardening through #288.

Exact production/proof evidence:

```text
application Production SHA = 9b6b5251fd59eb5ea82d30b3f1f8a7ff19e3319b
deploy run = 34128489551
IC2 proof run = 34130174224
IC2 proof attempt = 3
IC2 proof job = 101776923895
status = catalog-engine/ic2-production-proof success
PB9 exact-SHA proof = success
```

Fresh production proof result:

```text
decisionRoundTripMs = 1067
TTFI = 6715 ms
TTFC = 6715 ms
productCount = 24
readinessThreshold = 12
anonymousFailClosed = true
crossTenantFailClosed = true
defaultTenantFailClosed = true
privateIdentifiersExposed = false
```

The 6.715-second result is evidence from this production proof, not a universal customer ETA. It demonstrates that real useful L0 value no longer needs to wait for the historical 35m21s pre-import critical path.

## IC2 authority and safety result

IC2 now provides:

- immediate idempotent instant-seed dispatch after accepted import decision;
- provider-neutral bounded `complete:false` preview seed;
- tenant-isolated ephemeral `TenantConstructionState`;
- safe authenticated construction API and media proxy;
- real readiness based on product count, not elapsed time;
- mobile-first construction preview before L2;
- no raw supplier URL/provider-private identity/runtime locator in browser evidence;
- fail-closed anonymous/cross-tenant/default access;
- verified PB9/L2 remains Last Known Good and wins when ready.

Construction state is not publication state. L0 remains distinct from L2.

## Active execution point

**IC3 — Streaming / Parallel Listing Discovery: NEXT APPROVED SLICE.**

Bounded outcome:

- accelerate authoritative listing discovery after the instant seed;
- introduce provider-safe bounded page-level fan-out;
- make normalized listing page batches progressively available internally;
- preserve the same complete-scan authority: every required page must succeed before the authoritative index is complete;
- use one shared bounded concurrency budget so category/page nesting cannot explode supplier pressure;
- preserve stable identities, retry semantics, tenant isolation and no-private-leak boundaries;
- measure TTFA improvement against the IC1 baseline without pretending partial discovery is complete.

IC3 does **not** own IC4 detail swarm/adaptive governor, IC5 warm tenant cell pool, IC6 final fresh-beta proof, PB10 Merchant Home, recurring tenant sync, M7E or public custom-domain activation.

## IC3 permanent safety boundaries

- page concurrency is bounded and provider-safe;
- partial listing batches never become complete authority;
- scan failure cannot trigger missing/removal from an incomplete observation;
- source URLs/provider-private IDs remain server-side;
- stable public/opaque product identity remains compatible with the authoritative importer;
- Last Known Good continues serving until normal safe promotion;
- tenant isolation remains fail-closed;
- recurring Intelligent Sync remains OFF;
- no fake percentage or ETA.

## Exact continuation action

1. revalidate live `main`, open PRs, relevant exact-SHA statuses and `HUMAN_GATE_LOCK`;
2. confirm the IC2 closure PR is merged and no existing PR/branch already owns IC3;
3. inspect the current Provider Engine/Yupoo listing scanner and its page/category concurrency behavior;
4. create a fresh IC3 branch from exact revalidated `main`;
5. implement bounded page-level listing fan-out behind the Provider Engine boundary with a shared concurrency budget;
6. preserve complete-scan semantics and add partial/failure/identity/concurrency regressions;
7. measure TTFA with production-safe evidence before claiming IC3 Production Green;
8. keep PB9/LKG and all IC2 safety regressions green.

## Broader roadmap boundary

- M7A through M7D10: **PRODUCTION GREEN** within bounded contracts.
- M7D11: **PLANNED**.
- M7E: **DECISION REQUIRED**; recurring sync remains OFF.
- M9A: **PRODUCTION GREEN**.
- M9B: **IN PROGRESS — PAUSED** while the owner-authorized PB/Instant Catalog sequence is active.
