# Catalog Engine — IC4C Closure — 2026-09-08

Status: **PRODUCTION GREEN**  
Slice: **IC4C — Adaptive Upstream Governor**  
Owner contract: `docs/IC4-IC6-SLO60-GOVERNANCE.md`  
Repository: `lucasvenancio0110/catalog-engine`

## Closure statement

IC4C is **PRODUCTION GREEN** on exact trusted production evidence.

The slice established one coordinated provider/source pressure authority using Cloudflare Durable Objects, with bounded lease-based admission and AIMD behavior shared across provider detail fetches. The proof demonstrated healthy-window scale-up, a non-bypassable global ceiling, and automatic slowdown/cooldown for upstream pressure signals while preserving tenant isolation, PB9 Last Known Good authority, Queue/DLQ semantics, provider privacy and recurring Intelligent Sync OFF.

## Exact production authority

Application Production SHA:

```text
5482cf68c45f598ec73261949c2f41515e57e84d
```

Implementation/proof chain:

- PR #305 — `IC4C: add coordinated adaptive upstream governor` — merged;
- PR #306 — dedicated trusted IC4C provider-governor proof — merged;
- PR #308 — fixed transient Wrangler config source-path resolution for the trusted probe — merged;
- PR #309 — aligned IC4C proof inputs with the exact-SHA application deploy graph — merged;
- PR #310 — persisted proof-recovery continuity while the final chain was running — merged.

Trusted exact-SHA evidence:

```text
Deploy Catalog Engine application = 34206993880 — SUCCESS
Activate tenant import Queue consumers = 34207104828 — SUCCESS
Cloudflare tenant data-plane fleet canary = 34207104766 — SUCCESS
Cloudflare automatic tenant import canary = 34207104743 — SUCCESS
Cloudflare IC4B detail fan-out proof = 34207104819 — SUCCESS
Cloudflare IC4C adaptive provider governor proof = 34207104798 — SUCCESS
status = catalog-engine/ic4c-provider-governor success
```

The final IC4C proof checked out the exact application Production SHA, passed the full quality gate, deployed an isolated guarded Durable Object probe, executed the provider-pressure scenarios, deleted the ephemeral Worker/namespace and only then published the successful commit status.

## Production-proof result

The guarded proof validated the same production `ProviderDetailGovernor` authority and required all of the following to pass:

```text
contractVersion = 1
durableObjectCoordination = true
initialLimit = 2
firstHealthyWindowLimit = 3
secondHealthyWindowLimit = 4
hardCeiling = 4
concurrentAttempted = 8
concurrentAdmitted = 4
concurrentRejected = 4
```

Pressure behavior:

```text
429: reducedLimit = 2; cooldownRejected = true
5xx: reducedLimit = 2; cooldownRejected = true
timeout: reducedLimit = 2; cooldownRejected = true
degraded latency: reducedLimit = 2; cooldownRejected = true
```

Safety evidence:

```text
recurringIntelligentSyncChanged = false
privateIdentifiersExposed = false
isolated proof resource cleanup = complete
```

The proof published:

```text
catalog-engine/ic4c-provider-governor = success
IC4C green; DO AIMD 2->4; global ceiling=4; pressure slowdown proven
```

## Preserved invariants

IC4C preserved the higher-authority contracts:

- provider pressure is coordinated server-side rather than with process-local counters;
- provider/source identity used for coordination remains opaque and private;
- no proxy rotation, IP rotation, hidden mirror or throttling evasion was introduced;
- concurrency has a hard global ceiling and nested Worker execution cannot bypass it;
- provider pressure reduces on 429, meaningful 5xx, timeout/transport failure and degraded latency;
- Queue delivery/retry/DLQ semantics remain bounded and durable;
- tenant isolation remains fail-closed;
- PB9/L2 remains Last Known Good authority until normal verified handoff;
- initial tenant import remains ON;
- recurring Intelligent Sync remains OFF;
- M7E remains decision-gated;
- no private provider locator, D1 UUID, Worker locator, token or secret is part of successful public evidence.

## Proof-recovery incidents retained as evidence

The initial dedicated proof failed for two orchestration reasons rather than governor semantics:

1. the generated Wrangler config lived outside the repository while its `main` path was relative to repository source; PR #308 moved the transient config into the checkout root and pinned the invariant with tests;
2. the proof workflow/test/config inputs did not initially enter the exact-SHA application deploy path graph; PR #309 added them and regression-tested that relationship.

Neither fix weakened acceptance thresholds, AIMD behavior, isolation, privacy, LKG or sync gates.

## Explicit non-goals

IC4C did not implement or claim:

- IC4D tenant-D1 write-pressure governance;
- IC4E real large-catalog end-to-end detail-swarm acceptance;
- IC5 normalized result Queue/write combiner;
- IC5 warm tenant cell pool;
- IC5 streaming CEI;
- IC6 6K/60 acceptance;
- recurring Intelligent Sync/M7E activation;
- a customer-facing guarantee that a 6k catalog completes in 60 seconds.

## Rollback boundary

If adaptive provider control regresses provider health, isolation, retries/recovery or LKG safety, the operational rollback remains the previously proven conservative detail topology while retaining recurring sync OFF:

```text
max_batch_size = 4
max_batch_timeout = 5s
max_concurrency = 2
max_retries = 5
retry_delay = 120s
TENANT_SYNC_AUTOMATION_ENABLED = 0
```

Rollback must preserve durable job state and PB9/L2 authority; deleting queues or tenant state is not the first recovery action.

## Next approved slice

The exact next slice is now:

**IC4D — Tenant D1 Write-Pressure Governor**.

IC4D owns persistence-side pressure independently from provider fetch pressure. It must measure and bound per-tenant D1 persistence concurrency, prove artificial slow-D1 pressure causes bounded slowdown without loss, preserve retry/replay idempotency, and prove one tenant's D1 backpressure does not block another tenant.

No later IC4/IC5/IC6 slice may be silently skipped.