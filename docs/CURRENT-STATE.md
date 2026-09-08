# Catalog Engine — Current State

Status: **Living implementation/proof truth**  
Snapshot refreshed: **2026-09-07**  
Repository: `lucasvenancio0110/catalog-engine`

This document is intentionally compact. Focused normative documents own durable contracts; closure documents retain detailed historical evidence; live GitHub/production evidence remains authoritative.

## Live baseline

- Exact application Production SHA: `02bb72ee15b0fae7968b72c18a6bd508cffe8474` — merge of PR #297 on top of IC4A implementation PR #296.
- Trusted application deploy `34171630268`: **SUCCESS** on the exact Production SHA, including production smoke.
- Exact-SHA tenant import Queue consumer activation `34171688412`: **SUCCESS**.
- Exact-SHA IC4A detail baseline `34171688443`, job `101894437682`: **SUCCESS**.
- Commit status `catalog-engine/ic4a-detail-baseline = success` on the Production SHA.
- Exact-SHA IC3 regression `34171688377`, rerun job `101893752533`: **SUCCESS** at the unchanged 5% gate.
- Exact-SHA IC2 fresh-tenant regression `34171688381`, job `101893053635`: **SUCCESS**.
- Exact-SHA PB9 verified-private-preview proof `34171688408`: **SUCCESS**.
- Exact-SHA PB8 real-import proof `34171761181`: **SUCCESS**.
- Exact-SHA tenant-data-plane fleet canary `34171688474`: **SUCCESS**.
- Combined exact-SHA commit status was revalidated **success** after IC4A proof completion.
- Open pull requests immediately before the IC4A closure branch: none.
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
- IC4A — Detail throughput baseline + safe telemetry: **PRODUCTION GREEN**; implementation PR #296, proof-support PR #297 and `IC4A-CLOSURE-2026-09-07.md`.
- IC4B — Queue micro-delivery + horizontal consumer fan-out: **PLANNED — NEXT APPROVED SLICE**.
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

Historical IC2 closure evidence established useful real L0 construction value on a fresh tenant:

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

The current exact-SHA IC2 regression after PR #297 also passed:

```text
TTFI = 4809 ms
TTFC = 4809 ms
productCount = 24
readinessThreshold = 12
anonymousFailClosed = true
crossTenantFailClosed = true
defaultTenantFailClosed = true
privateIdentifiersExposed = false
```

Earlier trusted-proof attempts encountered Cloudflare error codes `1042`/`1104`. PR #297 added a safe read-only D1/Durable Object binding probe and allowlisted diagnostics; the final exact-SHA proof passed. Do not claim a more specific Cloudflare root cause than this evidence proves.

IC2 construction state remains non-authoritative and verified PB9/L2 wins when ready.

## IC3 Production Green evidence

Historical IC3 closure production A/B evidence remains:

```text
application Production SHA = 9cc5b3ef9757dc76266d1423e7056af8d332d8af
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

The final exact-SHA regression required for IC4A closure passed on one justified rerun without lowering the gate:

```text
application Production SHA = 02bb72ee15b0fae7968b72c18a6bd508cffe8474
baselineMs = 105574
fanoutMs = 98671
improvementPct = 6.5
speedupRatio = 1.07
productCount = 6111
identityMatch = true
taxonomyMatch = true
baselinePages = 126
fanoutPages = 71
baselineRequests = 449
fanoutRequests = 344
baselineMaxActive = 4
fanoutMaxActive = 4
progressiveItems = 48
requestConcurrency = 4
minimumImprovementPct = 5
privateIdentifiersExposed = false
recurringIntelligentSyncEnabled = false
```

IC3 continues to stream bounded normalized listing batches into tenant-isolated construction state with `complete:false` partial authority. Progressive construction work stops after 48 unique private items; the authoritative full scan continues normally.

## IC4A Production Green evidence

Exact production/proof evidence:

```text
application Production SHA = 02bb72ee15b0fae7968b72c18a6bd508cffe8474
deploy run = 34171630268
Queue activation run = 34171688412
PB9 proof run = 34171688408
IC2 proof run = 34171688381
IC2 proof job = 101893053635
IC3 proof run = 34171688377
IC3 proof job = 101893752533
IC4A proof run = 34171688443
IC4A proof job = 101894437682
status = catalog-engine/ic4a-detail-baseline success
```

Current conservative detail Queue topology remained unchanged:

```text
max_batch_size = 4
max_batch_timeout = 5s
max_concurrency = 2
max_retries = 5
consumer processes batch messages sequentially
```

Real large-catalog baseline:

```text
discovered = 6104
terminal = 6104
success = 6097
skipped = 5
deferred = 2
failed = 0
terminalProductsPerSecond = 0.971
Queue backlog = 0
DLQ backlog = 0
```

Bounded six-product Provider Engine + isolated schema-v8 D1 sample:

```text
sample successful = 6/6
provider fetch p95 = 1219.9 ms
normalization p95 = 8.2 ms
D1 write p95 = 361.4 ms
total measured p95 = 1554.2 ms
temporaryDatabaseCleaned = true
detailConcurrencyChanged = false
privateIdentifiersExposed = false
```

Measured decision input:

1. provider/network detail fetch is the dominant per-product cost;
2. tenant-D1 persistence is the second meaningful measured cost;
3. normalization is small relative to both.

The detailed closure and evidence discipline are recorded in `docs/IC4A-CLOSURE-2026-09-07.md`.

## Permanent safety result through IC4A

- page/detail network work remains bounded and provider-safe;
- no unbounded supplier fan-out;
- partial listing batches never become complete authority;
- partial scans cannot infer missing/removal;
- duplicate/retry semantics were not weakened;
- source/provider-private identifiers remain server-side;
- PB9 verified LKG remained green on exact SHA;
- IC2 construction/isolation remained green on exact SHA;
- tenant isolation remains fail-closed;
- recurring Intelligent Sync remains OFF;
- no fake percentage, countdown or customer ETA;
- IC4A changed no production detail concurrency.

## Active execution point

**IC4B — Queue Micro-delivery and Horizontal Consumer Fan-out: NEXT APPROVED SLICE.**

IC4B is governed by `docs/IC4-IC6-SLO60-GOVERNANCE.md` and must use the IC4A measured baseline before changing any limit.

Bounded outcome:

- evaluate detail Queue delivery size `1–2` versus current batch `4` from evidence;
- remove the fixed two-consumer throughput bottleneck through bounded independent Worker invocations;
- preserve exact per-message ownership, lease, retry, duplicate and DLQ meaning;
- prove two-tenant isolation remains fail-closed;
- increase Worker-level parallelism without introducing unbounded supplier concurrency;
- keep the provider-safety boundary conservative before IC4C owns coordinated adaptive AIMD;
- preserve an explicit rollback to the current conservative `4 / 5s / concurrency 2 / retries 5` topology;
- keep recurring Intelligent Sync OFF and PB9/L2 as Last Known Good authority.

IC4B does **not** own adaptive provider pressure, D1 pressure governance, result/write combining, streaming CEI or a 6K/60 acceptance claim.

## Exact continuation action

1. revalidate live `main`, open PRs, exact production statuses and `HUMAN_GATE_LOCK` after this closure merges;
2. read the mapped Queue/import/detail/data-plane/provider contracts and inspect exact consumer/runtime configuration;
3. measure/derive a bounded IC4B candidate from the IC4A baseline rather than guessing a high concurrency value;
4. create one fresh IC4B branch from the new docs-main HEAD;
5. implement Queue micro-delivery/horizontal fan-out with an explicit hard ceiling and rollback boundary;
6. add duplicate/retry/DLQ, per-message ownership, two-tenant isolation, leak and provider-pressure regression tests;
7. run normal quality plus provider/import/Queue-specific CI;
8. merge only the exact tested head SHA;
9. prove exact-SHA application and Queue deployment;
10. run the dedicated IC4B production proof, compare provider error/throttle behavior with IC4A and update durable state only to the level proven.

## Broader roadmap boundary

- M7A through M7D10: **PRODUCTION GREEN** within bounded contracts.
- M7D11: **PLANNED**.
- M7E: **DECISION REQUIRED**; recurring sync remains OFF.
- M9A: **PRODUCTION GREEN**.
- M9B: **IN PROGRESS — PAUSED** while the owner-authorized PB/Instant Catalog sequence is active.