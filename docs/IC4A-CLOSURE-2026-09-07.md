# Catalog Engine — IC4A Closure — 2026-09-07

Status: **PRODUCTION GREEN**  
Slice: **IC4A — Detail Throughput Baseline and Safe Telemetry**  
Owner contract: `docs/IC4-IC6-SLO60-GOVERNANCE.md`  
Repository: `lucasvenancio0110/catalog-engine`

## Closure statement

IC4A is **PRODUCTION GREEN** on exact trusted production evidence.

The slice established a real large-catalog detail-throughput baseline, separated provider/network fetch cost from normalization and tenant-D1 persistence cost, captured Queue/DLQ health, and preserved the existing conservative detail consumer topology. IC4A changed **no production detail concurrency**.

This closure authorizes only the next approved slice, **IC4B — Queue micro-delivery and horizontal consumer fan-out**. It does not authorize IC4C adaptive provider pressure, IC4D D1 pressure governance, IC4E large-swarm acceptance, recurring Intelligent Sync, M7E, or any customer-facing 6K/60 promise.

## Exact implementation and production evidence

Application Production SHA:

```text
02bb72ee15b0fae7968b72c18a6bd508cffe8474
```

Implementation chain:

- PR #296 — `IC4A: measure real detail throughput without changing concurrency` — merged; IC4A baseline implementation.
- PR #297 — `IC2: diagnose proof runtime bindings safely` — merged; safe trusted-proof diagnostic hardening required to obtain a reliable exact-SHA regression result after transient runtime/transport failures.
- final exact application Production SHA: `02bb72ee15b0fae7968b72c18a6bd508cffe8474`.

Trusted exact-SHA evidence:

```text
application deploy run = 34171630268 — SUCCESS
Queue activation run = 34171688412 — SUCCESS
PB9 production proof run = 34171688408 — SUCCESS
PB8 production proof run = 34171761181 — SUCCESS
IC2 production proof run = 34171688381 — SUCCESS
IC2 proof job = 101893053635
IC3 production proof run = 34171688377 — SUCCESS
IC3 proof job = 101893752533
IC4A detail baseline run = 34171688443 — SUCCESS
IC4A proof job = 101894437682
status = catalog-engine/ic4a-detail-baseline success
```

The combined exact-SHA commit status was revalidated as `success` after the IC4A proof completed.

## Real IC4A production baseline

Reference class: real large catalog.

### Detail Queue / DLQ topology and health

```text
max_batch_size = 4
max_batch_timeout = 5s
max_concurrency = 2
max_retries = 5
Queue backlog count = 0
Queue backlog bytes = 0
oldest message age = 0 ms
DLQ backlog count = 0
```

The consumer still processes the current multi-message delivery sequentially. IC4A intentionally did not change that behavior.

### Historical terminal detail throughput

```text
discovered = 6104
terminal = 6104
success = 6097
skipped = 5
deferred = 2
failed = 0
detail terminal window = 6288000 ms
terminal products per second = 0.971
```

This historical terminal rate describes the measured reference import state; it is an engineering baseline, not a customer ETA.

### Bounded real Provider Engine + isolated D1 sample

```text
requested = 6
attempted = 6
successful = 6
failed = 0
```

Provider fetch timing:

```text
count = 6
min = 600.0 ms
mean = 817.9 ms
p50 = 619.8 ms
p95 = 1219.9 ms
max = 1219.9 ms
```

Normalization timing:

```text
count = 6
min = 1.8 ms
mean = 3.9 ms
p50 = 2.7 ms
p95 = 8.2 ms
max = 8.2 ms
```

Tenant-D1 write timing on the isolated ephemeral schema-v8 proof database:

```text
count = 6
min = 266.6 ms
mean = 304.2 ms
p50 = 283.4 ms
p95 = 361.4 ms
max = 361.4 ms
```

Total measured per-product timing:

```text
count = 6
min = 868.5 ms
mean = 1125.9 ms
p50 = 905.9 ms
p95 = 1554.2 ms
max = 1554.2 ms
```

Write statement count:

```text
count = 6
min = 16
mean = 17.7
p50 = 18
p95 = 18
max = 18
```

Safety/cleanup result:

```text
safeErrorCounts = []
currentSchemaVersion = 8
initialImportEnabled = true
recurringIntelligentSyncEnabled = false
detailConcurrencyChanged = false
temporaryDatabaseCleaned = true
privateIdentifiersExposed = false
```

## Measured bottleneck conclusion

The baseline makes the next optimization order evidence-based:

1. **Provider/network detail fetch is the dominant measured per-product cost** — p95 `1219.9 ms`.
2. **Tenant-D1 persistence is the second meaningful measured cost** — p95 `361.4 ms`.
3. **Normalization is not currently a meaningful throughput bottleneck** — p95 `8.2 ms`.

Therefore IC4B should first attack the fixed horizontal delivery/consumer bottleneck while preserving a conservative provider-safety boundary. IC4D/IC5C own the later persistence-pressure/write-combining work; IC4A does not pre-authorize those changes.

## IC2 trusted-proof diagnostic incident

During the exact-SHA proof campaign, earlier IC2 trusted runs encountered Cloudflare error codes `1042` and `1104` before the final successful proof.

The failures bypassed the ordinary application-safe failure response, so PR #297 added a bounded authenticated read-only binding probe before TTFI measurement:

- control D1 `SELECT 1` health;
- external production `TenantConstructionState` binding reachability;
- empty fresh proof-fixture state requirement;
- allowlisted diagnostic output only;
- no raw response-body logging.

Final exact-SHA IC2 proof passed with:

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

This proves the exact current product/runtime boundary is healthy. The historical `1042`/`1104` failures are retained as transient Cloudflare runtime/transport evidence; this closure does **not** claim a more specific Cloudflare root cause than was proven.

## IC3 exact-SHA regression variability

The first IC3 A/B attempt on the final exact application SHA preserved identity and reduced requests but did not meet the permanent `5%` improvement threshold.

The threshold was **not lowered** and CI/proof logic was not weakened.

After exact-SHA IC2 and dependency status were healthy, one justified regression rerun passed:

```text
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
progressiveBatches = 1
progressiveItems = 48
requestConcurrency = 4
minimumImprovementPct = 5
initialImportEnabled = true
recurringIntelligentSyncEnabled = false
privateIdentifiersExposed = false
```

The final regression therefore passed the original gate honestly at `6.5%`.

## Preserved invariants

IC4A preserved all required higher-authority contracts:

- verified PB9/L2 remains Last Known Good authority;
- detail Queue remains batch `4`, timeout `5s`, concurrency `2`, retries `5`;
- no unbounded supplier concurrency was introduced;
- no adaptive provider governor was activated;
- no tenant-D1 pressure governor was activated;
- partial observation still cannot infer missing/removal;
- duplicate/retry/idempotency behavior was not redefined;
- tenant isolation remains fail-closed;
- initial tenant import remains ON;
- recurring Intelligent Sync remains OFF;
- M7E remains decision-gated;
- proof evidence contains no supplier URL/hostname, raw provider ID/media origin, D1 UUID, Worker locator, token or secret;
- the ephemeral proof D1 was deleted before success was publishable.

## Explicit non-goals / not implemented

IC4A did not implement or claim:

- higher detail consumer concurrency;
- Queue micro-batch activation;
- per-process or unbounded `Promise.all` detail fetching;
- IC4C coordinated AIMD provider governor;
- IC4D tenant-D1 write-pressure governor;
- IC4E real large-catalog swarm acceptance;
- IC5 result Queue/write combiner;
- IC5 streaming CEI;
- IC5 warm tenant pool;
- IC6 6K/60 acceptance;
- Provider Snapshot Engine;
- recurring Intelligent Sync/M7E activation;
- public/customer guarantee that a 6k catalog finishes in 60 seconds.

## Rollback boundary

IC4A added measurement/proof infrastructure only. Production detail behavior remains on the pre-IC4B conservative topology.

If later acceleration regresses provider health, isolation, D1 integrity, retry/DLQ safety or PB9/LKG authority, the rollback target remains:

```text
max_batch_size = 4
max_batch_timeout = 5s
max_concurrency = 2
max_retries = 5
recurring Intelligent Sync = OFF
PB9/L2 = serving Last Known Good
```

## Next approved slice

The exact next slice is:

**IC4B — Queue micro-delivery and horizontal consumer fan-out**.

IC4B must use this baseline to evaluate batch size `1–2` versus current batch `4`, remove the fixed two-consumer throughput bottleneck through bounded independent Worker invocations, preserve exact per-message ownership/idempotency/isolation, and prove that Worker-level fan-out does not become uncontrolled provider pressure before IC4C owns the coordinated adaptive governor.

No later IC4/IC5/IC6 slice may be silently skipped.