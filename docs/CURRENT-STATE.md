# Catalog Engine — Current State

Status: **Living implementation/proof truth**  
Snapshot refreshed: **2026-09-07**  
Repository: `lucasvenancio0110/catalog-engine`

This document is intentionally compact. Focused normative documents own durable contracts; closure documents retain detailed historical evidence; live GitHub/production evidence remains authoritative.

## Live baseline

- Exact live `main` before this documentation closure branch: `2ab820c6f096a791e14807c0b3be75a55b6fe361` — merge of PR #274, IC1 production-latency proof.
- Exact application Production SHA: `ee36ef7621d79e09fbf71308b553f338bda8c862` — merge of PR #273, IC1 application implementation.
- Trusted application deploy `34079142874`: **SUCCESS** on `ee36ef7621d79e09fbf71308b553f338bda8c862`.
- IC1 dedicated trusted production proof `34079538032` / job `101612071627`: **SUCCESS**.
- Commit status `catalog-engine/ic1-production-proof = success` on `2ab820c6f096a791e14807c0b3be75a55b6fe361`.
- PB6/PB7/PB8/PB9 trusted production regressions remained **SUCCESS** on the IC1 application Production SHA.
- Open pull requests immediately before this closure branch: none.
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

The real CROCCODILOS isolated tenant has:

- 6,104 discovered/terminal source items from the initial import;
- 6,097 persisted products and 15,396 media links;
- CEI/classification success for 6,097 products: 5,869 automatic, 228 review, 0 unknown;
- verification success for 6,097 products with 0 findings;
- full catalog runtime `verified`, runtime version `1`;
- authenticated PB9 private preview, own-product detail and own-media access proven;
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

- IC0 — Governance + performance contract: **COMPLETE / GOVERNANCE GREEN**; PR #272, merge `375bb7ee67083f558bdaf9f7bdb78a317a3c4b78`.
- IC1 — Real latency baseline + branded creation UX: **PRODUCTION GREEN**; detailed proof in `IC1-CLOSURE-2026-09-07.md`.
- IC2 — Instant seed + construction preview: **PLANNED — NEXT APPROVED SLICE**.
- IC3 — Streaming/parallel listing discovery: **PLANNED**.
- IC4 — Adaptive detail swarm: **PLANNED**.
- IC5 — Warm tenant cell pool: **PLANNED**.
- IC6 — Fresh speed/isolation proof: **PLANNED**.
- PB10 remains approved but paused until IC6 reaches its required Green state.

PB9 stays the L2 verified Last Known Good authority while the separate pre-verification construction path is developed.

## IC1 Production Green evidence

Application implementation:

```text
PR = #273
application Production SHA = ee36ef7621d79e09fbf71308b553f338bda8c862
deploy = 34079142874
PB6 regression = success
PB7 regression = success
PB8 regression = success
PB9 regression = success
```

Dedicated safe latency proof:

```text
PR = #274
proof/main SHA = 2ab820c6f096a791e14807c0b3be75a55b6fe361
proof run = 34079538032
proof job = 101612071627
status = catalog-engine/ic1-production-proof success
merchant = CROCCODILOS
productCount = 6097
findings = 0
privateIdentifiersExposed = false
recurringIntelligentSyncEnabled = false
```

Measured historical first-merchant baseline from durable import-decision confirmation:

```text
import start = 2,121,000 ms = 35m21s
listing scan complete = 2,290,000 ms = 38m10s
full initial import complete = 8,583,000 ms = 2h23m03s
classification complete = 12,326,000 ms = 3h25m26s
verification complete = 12,621,000 ms = 3h30m21s
```

These numbers are engineering baseline evidence, **not a customer ETA**.

## Quantified root cause

The old safe path is much slower than the Instant Catalog objective because first value waits on work that should not be on the first-value path:

- physical tenant data-plane/runtime readiness;
- five-minute scheduler discovery/recovery cadence;
- conservative scan/detail Queue throughput;
- full detail hydration;
- CEI/classification;
- verification;
- verified runtime staging/dispatch.

The first 35m21s before import start proves IC2 must create an immediate separate seed path rather than simply styling the existing wait.

## Active execution point

**IC2 — Instant seed + construction preview: NEXT APPROVED SLICE.**

Bounded outcome:

- accepted source/import decision immediately triggers a separate seed job;
- the seed does not wait for physical tenant D1/User Worker readiness;
- provider capability returns a bounded `complete:false` observation;
- tenant-isolated ephemeral construction state stores private evidence;
- browser receives only safe L0/L1 projections;
- authenticated construction preview opens when the real useful-product threshold is satisfied;
- PB9 remains the verified L2 authority and publication boundary.

Preferred first storage implementation: **one Durable Object instance per tenant**, as approved by `INSTANT-CATALOG.md`, unless implementation evidence proves it unsuitable and architecture is explicitly updated.

## IC2 permanent safety boundaries

- membership and tenant resolution server-side;
- no raw supplier URL/provider ID/media origin/D1 UUID/Worker locator in browser/public evidence;
- construction state is not publication state;
- L0 is not L2;
- partial seed never means missing/removal;
- Queue message contains no raw supplier URL;
- provider requests remain bounded and rate-limit respecting;
- PB9 verified preview remains rollback/LKG;
- no recurring Intelligent Sync activation;
- no M7E activation;
- no public custom-domain publication merely to prove speed.

## Exact continuation action

1. revalidate current `main`, open PRs, IC1 proof status and `HUMAN_GATE_LOCK`;
2. create a fresh IC2 branch only from the exact revalidated main;
3. implement the tenant-isolated construction-state primitive and safe projection contract;
4. add the bounded provider preview-seed capability using the existing Provider Engine boundary;
5. add immediate idempotent seed dispatch with no raw source locator in Queue payload;
6. wire authenticated construction status/products/media and creation-preview UI;
7. keep PB9 regressions green;
8. prove anonymous/cross-tenant/default fail-closed and no private leaks;
9. measure real TTFI/TTFC on a fresh tenant before claiming IC2 Production Green.

## Broader roadmap boundary

- M7A through M7D10: **PRODUCTION GREEN** within bounded contracts.
- M7D11: **PLANNED**.
- M7E: **DECISION REQUIRED**; recurring sync remains OFF.
- M9A: **PRODUCTION GREEN**.
- M9B: **IN PROGRESS — PAUSED**.
- M9C/M9D: **PLANNED**.
- IC2 is active; IC3–IC6 are planned behind it.
- PB10/PB11/PB12 remain approved behind IC6.
- After PB12, return to paused M9B unless a later explicit owner decision changes sequencing.

## Continuity rule

Before every continuation, revalidate live `main`, open PRs, active branch, CI, deploy/proof and this document. If live evidence advances beyond this snapshot, update this document to the level actually proven rather than repeating completed work.

Do not claim IC2 or a later slice Green without its required integrated and production evidence.
