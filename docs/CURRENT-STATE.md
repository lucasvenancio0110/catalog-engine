# Catalog Engine — Current State

Status: **Living implementation/proof truth**  
Snapshot refreshed: **2026-09-08**  
Repository: `lucasvenancio0110/catalog-engine`

This document is intentionally compact. Focused normative documents own durable contracts; closure documents retain detailed historical evidence; live GitHub and exact production evidence remain authoritative.

## Human gate

```text
HUMAN_GATE_LOCK: INACTIVE
```

## Production activation boundary

```text
TENANT_IMPORT_AUTOMATION_ENABLED=1
TENANT_SYNC_AUTOMATION_ENABLED=0
TENANT_SYNC_ACTIVE_COHORT=""
TENANT_SYNC_MAX_JOBS_PER_TICK=1
```

Automatic initial tenant import is enabled. Recurring tenant Intelligent Sync remains disabled. M7E remains separately decision-gated.

## Exact production baseline

Current application Production SHA:

```text
5482cf68c45f598ec73261949c2f41515e57e84d
```

Exact-SHA production chain:

```text
Deploy Catalog Engine application = 34206993880 — SUCCESS
Activate tenant import Queue consumers = 34207104828 — SUCCESS
Cloudflare tenant data-plane fleet canary = 34207104766 — SUCCESS
Cloudflare automatic tenant import canary = 34207104743 — SUCCESS
Cloudflare IC4B detail fan-out proof = 34207104819 — SUCCESS
Cloudflare IC4C adaptive provider governor proof = 34207104798 — SUCCESS
catalog-engine/ic4c-provider-governor = success
```

The IC4C proof checked out this exact Production SHA, passed the full quality gate, used the production `ProviderDetailGovernor` class through an isolated guarded Durable Object probe, proved the required AIMD/pressure behavior, cleaned up the ephemeral proof Worker/namespace and then published success.

A later docs-only `main` HEAD may legitimately differ from this Production SHA. Never infer application deployment from GitHub HEAD alone.

## Proven first-merchant state

PB0 through PB9 remain closed within their bounded owner-authorized contracts. The real isolated merchant tenant remains approximately 6k products with completed import, CEI/classification, verification, runtime and authenticated PB9 private preview. Anonymous, cross-tenant and default-tenant access remain fail-closed. PB9/L2 remains Last Known Good authority while acceleration work proceeds.

## Instant Catalog order

Owner contracts:

- `docs/INSTANT-CATALOG.md`;
- `docs/IC4-IC6-SLO60-GOVERNANCE.md`.

Approved order:

```text
PB9
-> IC0 -> IC1 -> IC2 -> IC3
-> IC4A -> IC4B -> IC4C -> IC4D -> IC4E
-> IC5A -> IC5B -> IC5C -> IC5D -> IC5E
-> IC6A -> IC6B -> IC6C -> IC6D -> IC6E
-> PB10 -> PB11 -> PB12
```

Current statuses:

- IC0 — Governance + performance contract: **COMPLETE / GOVERNANCE GREEN**.
- IC1 — Real latency baseline + branded creation UX: **PRODUCTION GREEN**.
- IC2 — Instant seed + construction preview: **PRODUCTION GREEN**.
- IC3 — Streaming/parallel listing discovery: **PRODUCTION GREEN**.
- IC4A — Detail throughput baseline + safe telemetry: **PRODUCTION GREEN**.
- IC4B — Queue micro-delivery + horizontal consumer fan-out: **PRODUCTION GREEN**.
- IC4C — Adaptive upstream governor: **PRODUCTION GREEN**; `docs/IC4C-CLOSURE-2026-09-08.md`.
- IC4D — Tenant D1 write-pressure governor: **NEXT APPROVED SLICE**.
- IC4E — Production detail-swarm proof: **PLANNED**.
- IC5A–IC5E — Warm start + batched persistence/streaming CEI: **PLANNED**.
- IC6A–IC6E — Fresh 6K/60 integration/chaos/acceptance: **PLANNED**.
- PB10 remains approved but paused until the Instant Catalog campaign reaches its required Green state.

## IC4C Production Green evidence

Trusted proof `34207104798` established:

```text
contractVersion = 1
durableObjectCoordination = true
initialLimit = 2
healthy scale-up = 2 -> 3 -> 4
hardCeiling = 4
concurrentAttempted = 8
concurrentAdmitted = 4
concurrentRejected = 4
429 reduced limit = 2 + cooldown reject
5xx reduced limit = 2 + cooldown reject
timeout reduced limit = 2 + cooldown reject
degraded latency reduced limit = 2 + cooldown reject
recurring Intelligent Sync changed = false
private identifiers exposed = false
proof resource cleanup = complete
```

Implementation/proof recovery chain:

- PR #305 — coordinated adaptive upstream governor;
- PR #306 — dedicated trusted proof;
- PR #308 — transient Wrangler config path fix;
- PR #309 — exact-SHA deploy trigger alignment;
- PR #310 — persisted recovery checkpoint.

Neither recovery fix weakened any AIMD threshold, provider-safety boundary, tenant isolation rule, retry/DLQ contract, LKG rule, privacy rule or recurring-sync gate.

## Permanent safety result through IC4C

- listing/detail work remains bounded;
- provider pressure is coordinated server-side rather than process-local;
- source coordination identity remains opaque/private;
- horizontal Worker fan-out cannot bypass the provider governor ceiling;
- 429/5xx/timeout/degraded-latency signals reduce provider pressure;
- partial listing batches never become complete authority;
- partial observations cannot infer missing/removal;
- duplicate/retry/DLQ semantics remain durable;
- tenant isolation remains fail-closed;
- PB9 verified LKG remains authoritative;
- recurring Intelligent Sync remains OFF;
- no fake customer percentage/countdown/ETA;
- throughput loses to security, isolation, correctness, provider safety and recovery.

## Active execution point

**IC4D — Tenant D1 Write-Pressure Governor: NEXT APPROVED SLICE.**

Normative outcome from `docs/IC4-IC6-SLO60-GOVERNANCE.md`:

- measure and bound per-tenant persistence concurrency separately from fetch concurrency;
- prevent horizontal detail fetch fan-out from turning into tenant D1 lock/latency collapse.

Definition of Done:

- artificial slow-D1 proof triggers slowdown without loss;
- retry/replay remains idempotent;
- one tenant's D1 backpressure does not block another tenant.

IC4D must not silently implement the later IC5C normalized-result Queue/write-combiner architecture. The current tenant D1 remains authority. Fetch pressure and persistence pressure must remain independently governed.

## Exact continuation action

1. revalidate live `main`, open PRs, CI/deploy/proof status and `HUMAN_GATE_LOCK`;
2. treat `5482cf68c45f598ec73261949c2f41515e57e84d` as current application Production SHA unless live deployment evidence supersedes it;
3. confirm `IC4C-CLOSURE-2026-09-08.md` and this state transition are merged;
4. begin IC4D in a new bounded branch from current `main`;
5. read the D1/import owner documents mapped by `DOCUMENT-MAP.md`, inspect the current detail persistence path and its measured IC4A write latency, then implement the smallest coordinated per-tenant persistence-pressure authority that satisfies IC4D without preempting IC5C;
6. require unit/isolation/slow-D1/idempotency coverage and trusted production evidence before any IC4D Production Green claim.

## Broader roadmap boundary

- M7A through M7D10: **PRODUCTION GREEN** within bounded contracts.
- M7D11: **PLANNED**.
- M7E: **DECISION REQUIRED**; recurring sync remains OFF.
- M9A: **PRODUCTION GREEN**.
- M9B: **IN PROGRESS — PAUSED** while the owner-authorized PB/Instant Catalog sequence is active.
