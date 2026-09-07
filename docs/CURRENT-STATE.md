# Catalog Engine — Current State

Status: **Living implementation/proof truth**  
Snapshot refreshed: **2026-09-07**  
Repository: `lucasvenancio0110/catalog-engine`

This document is intentionally compact. Focused normative documents own durable contracts; closure documents retain detailed historical evidence; live GitHub/production evidence remains authoritative.

## Live baseline

- Exact application Production SHA: `9cc5b3ef9757dc76266d1423e7056af8d332d8af` — merge of PR #293.
- Trusted application deploy `34143369165`: **SUCCESS** on the exact Production SHA, including production smoke.
- Exact-SHA tenant import Queue consumer activation `34143462176`, job `101810312651`: **SUCCESS**.
- IC3 dedicated trusted production proof `34143462169`, job `101810312524`: **SUCCESS**.
- Commit status `catalog-engine/ic3-production-proof = success` on the Production SHA.
- Exact-SHA IC2 fresh-tenant regression `34143462145`, job `101810312138`: **SUCCESS**.
- Exact-SHA PB9 verified-private-preview proof `34143462198`, job `101810311943`: **SUCCESS**.
- Provider Engine exact-main quality `34143369172`: **SUCCESS**.
- Open pull requests immediately before the IC3 closure branch: none.
- `HUMAN_GATE_LOCK: INACTIVE` at the latest durable operational snapshot; every autonomous resume must revalidate it.

A later documentation-only HEAD may legitimately differ from the application Production SHA. Production truth must be taken from exact deploy/proof evidence, not inferred from a docs-only merge.

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

The real CROCCODILOS isolated tenant has approximately 6k products, completed CEI/classification, completed verification, full runtime and authenticated PB9 private preview. Anonymous, cross-tenant and default-tenant access remain fail-closed. The historical default tenant remains an explicit compatibility tenant and must never become an implicit fallback for a real merchant.

## Instant Catalog execution state

Owner contracts:

- `docs/INSTANT-CATALOG.md` — IC0–IC6 architecture and sequencing;
- `docs/IC4-IC6-SLO60-GOVERNANCE.md` — approved IC4–IC6 performance/security decomposition and 6K/60 engineering program.

Approved temporary order:

```text
PB9
-> IC0 -> IC1 -> IC2 -> IC3
-> IC4A -> IC4B -> IC4C -> IC4D -> IC4E
-> IC5A -> IC5B -> IC5C -> IC5D -> IC5E
-> IC6A -> IC6B -> IC6C -> IC6D -> IC6E
-> PB10 -> PB11 -> PB12
```

Current statuses:

- IC0 — Governance + performance contract: **COMPLETE / GOVERNANCE GREEN**; PR #272.
- IC1 — Real latency baseline + branded creation UX: **PRODUCTION GREEN**; `IC1-CLOSURE-2026-09-07.md`.
- IC2 — Instant seed + construction preview: **PRODUCTION GREEN**; `IC2-CLOSURE-2026-09-07.md`.
- IC3 — Streaming/parallel listing discovery: **PRODUCTION GREEN**; implementation PRs #290–#293 and `IC3-CLOSURE-2026-09-07.md`.
- IC4A — Detail throughput baseline + safe telemetry: **PLANNED — NEXT APPROVED SLICE**.
- IC4B — Queue micro-delivery + horizontal consumer fan-out: **PLANNED**.
- IC4C — Adaptive upstream governor: **PLANNED**.
- IC4D — Tenant D1 write-pressure governor: **PLANNED**.
- IC4E — Production detail-swarm proof: **PLANNED**.
- IC5A–IC5E — Warm start + batched persistence/streaming CEI program: **PLANNED**.
- IC6A–IC6E — Fresh 6K/60 integration/chaos/acceptance program: **PLANNED**.
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

IC2 proved useful real L0 construction value on a fresh tenant:

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

The 6.715-second result is evidence from that production proof, not a universal customer ETA. IC2 construction state remains non-authoritative and verified PB9/L2 wins when ready.

## IC3 Production Green evidence

Exact production/proof evidence:

```text
application Production SHA = 9cc5b3ef9757dc76266d1423e7056af8d332d8af
deploy run = 34143369165
Queue activation run = 34143462176
IC3 proof run = 34143462169
IC3 proof job = 101810312524
PB9 exact-SHA run = 34143462198
IC2 exact-SHA run = 34143462145
status = catalog-engine/ic3-production-proof success
```

Safe production A/B result on the real CROCCODILOS-class source:

```text
baselineMs = 106416
fanoutMs = 96591
improvementPct = 9.2
speedupRatio = 1.1
productCount = 6111
identityMatch = true
taxonomyMatch = true
baselinePages = 125
fanoutPages = 71
baselineRequests = 452
fanoutRequests = 342
baselineMaxActive = 4
fanoutMaxActive = 4
progressiveBatches = 1
progressiveItems = 48
requestConcurrency = 4
minimumImprovementPct = 5
initialImportEnabled = true
recurringIntelligentSyncEnabled = false
privateIdentifiersExposed = false
```

IC3 therefore improved this measured full-listing path from **106.416 s to 96.591 s**, or **9.2%**, while preserving all 6,111 products, identity and taxonomy and without increasing the supplier concurrency ceiling above 4. The request count in this proof fell from 452 to 342. This is engineering evidence for one healthy-source production run, not a customer ETA.

IC3 also streams bounded normalized listing batches into the tenant-isolated construction state while preserving `complete:false` partial authority. Progressive construction work stops after 48 unique private items; the authoritative full scan continues normally.

## IC3 permanent safety result

- page/network concurrency remains bounded and provider-safe;
- no unbounded supplier fan-out;
- partial listing batches never become complete authority;
- missing/inconsistent required pages fail closed;
- partial scans cannot infer missing/removal;
- full identity and taxonomy matched the pre-IC3 baseline;
- source/provider-private identifiers remain server-side;
- PB9 verified LKG remained green on exact SHA;
- IC2 construction/isolation remained green on exact SHA;
- tenant isolation remains fail-closed;
- recurring Intelligent Sync remains OFF;
- no fake percentage or ETA.

## Active execution point

**IC4A — Detail Throughput Baseline and Safe Telemetry: NEXT APPROVED SLICE.**

IC4A is measurement-only and governed by `docs/IC4-IC6-SLO60-GOVERNANCE.md`.

Bounded outcome:

- instrument the current detail pipeline without increasing concurrency;
- separate Queue wait, provider detail fetch, normalization/CEI-preparation and tenant-D1 persistence latency;
- measure requests/s, terminal products/s, Queue age/backlog, retries and D1 latency through safe counters/timings;
- ensure no supplier URL/hostname, provider-private ID, D1 UUID, Worker locator or secret appears in public/proof evidence;
- establish exact trusted-main production evidence before IC4B is allowed to alter delivery/concurrency.

Current conservative detail topology remains the baseline during IC4A:

```text
max_batch_size = 4
max_batch_timeout = 5s
max_concurrency = 2
consumer processes batch messages sequentially
```

IC4A does **not** authorize raising those values. IC4B owns the first horizontal delivery/concurrency change after IC4A reaches Production Green.

## Exact continuation action

1. revalidate live `main`, open PRs, exact production statuses and `HUMAN_GATE_LOCK`;
2. read `IC4-IC6-SLO60-GOVERNANCE.md` plus the mapped Queue/import/detail/data-plane/provider contracts;
3. inspect the exact detail consumer and current Queue configuration;
4. create a fresh IC4A branch from the revalidated main HEAD;
5. add safe stage timing/throughput instrumentation without changing detail concurrency;
6. add leak/isolation/idempotency/telemetry contract tests;
7. add a trusted production baseline proof that reports only safe timing/counter evidence;
8. merge only after normal CI is green;
9. prove exact-SHA application/Queue deployment and run the real IC4A production baseline;
10. update state/closure only to the level actually proven; do not start IC4B until IC4A is honestly Production Green.

## Broader roadmap boundary

- M7A through M7D10: **PRODUCTION GREEN** within bounded contracts.
- M7D11: **PLANNED**.
- M7E: **DECISION REQUIRED**; recurring sync remains OFF.
- M9A: **PRODUCTION GREEN**.
- M9B: **IN PROGRESS — PAUSED** while the owner-authorized PB/Instant Catalog sequence is active.
