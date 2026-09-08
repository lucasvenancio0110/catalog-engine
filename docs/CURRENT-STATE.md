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

## Exact application production baseline

Current application Production SHA:

```text
4135f08805763f2c17ab6abeeabf645cbb1c0ee6
```

Exact-SHA production evidence:

```text
application deploy = 34245336329 — SUCCESS
Queue consumer activation = 34245474929 — SUCCESS
tenant data-plane fleet canary = 34245474757 — SUCCESS
automatic tenant import canary = 34245474751 — SUCCESS
PB9 production proof = 34245474763 — SUCCESS
IC2 production proof = 34245474831 — SUCCESS
IC3 production proof = 34245474752 — SUCCESS
IC4B detail fan-out proof = 34245474970 — SUCCESS
IC4C provider governor proof = 34245474833 — SUCCESS
IC4D tenant D1 write-pressure governor proof = 34245474949 — SUCCESS
```

Exact successful IC4D status:

```text
catalog-engine/ic4d-tenant-d1-write-governor = success
```

A later documentation/proof-only `main` HEAD may legitimately differ from this application Production SHA. Never infer application deployment from GitHub HEAD alone.

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
- IC4C — Adaptive upstream governor: **PRODUCTION GREEN**.
- IC4D — Tenant D1 write-pressure governor: **PRODUCTION GREEN**; `docs/IC4D-CLOSURE-2026-09-08.md`.
- IC4E — Production detail-swarm proof: **PLANNED — NEXT APPROVED SLICE**.
- IC5A–IC5E — Warm start + batched persistence/streaming CEI: **PLANNED**.
- IC6A–IC6E — Fresh 6K/60 integration/chaos/acceptance: **PLANNED**.
- PB10 remains approved but paused until the Instant Catalog campaign reaches its required Green state.

## IC4D Production Green result

Implementation merged through PR #312 and trusted proof harness through PR #313. Exact-SHA proof run `34245474949` passed after all required regressions were green.

Trusted IC4D proof established:

```text
contractVersion = 1
durableObjectCoordination = true
initialLimit = 2
hardCeiling = 2
4 same-tenant concurrent attempts -> 2 admitted / 2 rejected
artificial slow D1 -> limit 1 + cooldown reject
after cooldown -> one writer only
healthy recovery -> limit 2
independent tenant -> limit 2 remains available
5xx pressure -> limit 1
transport pressure -> limit 1
workLossObserved = false
recurringIntelligentSyncChanged = false
privateIdentifiersExposed = false
isolated proof cleanup = complete before success publication
```

Trusted quality evidence inside the proof:

```text
targeted IC4D/import/data-plane tests = 24 passed
full test files = 190 passed
full tests = 969 passed
dependency policy = green
lint = green
```

The IC4D governor remains independent from IC4C provider pressure. Mutating tenant-dispatch D1 batches consume permits; reads do not. One tenant's D1 pressure does not consume another tenant's capacity. Queue claim/retry/replay/idempotency and PB9/LKG authority remain unchanged.

## Permanent safety boundary through IC4D

- listing/detail work remains bounded;
- provider pressure and tenant persistence pressure are separate coordinated authorities;
- source and tenant coordination identities remain opaque/private;
- horizontal Worker fan-out cannot bypass provider or tenant-write ceilings;
- partial listing batches never become complete authority;
- partial observations cannot infer missing/removal;
- duplicate/retry/DLQ semantics remain durable;
- tenant isolation remains fail-closed;
- PB9 verified LKG remains authoritative;
- recurring Intelligent Sync remains OFF;
- no fake customer percentage/countdown/ETA;
- throughput loses to security, isolation, correctness, provider safety and recovery.

## Active execution point

**IC4E — Production Detail-Swarm Proof: PLANNED / NEXT APPROVED SLICE.**

IC4E owns the first real large-catalog end-to-end production acceptance of the IC4B + IC4C + IC4D detail topology. It is not an authorization to weaken TTFH, bypass scheduler/Queue ownership, touch the canonical merchant LKG or activate recurring sync.

IC4E Definition of Done from the owner contract:

- production proof on a real large catalog with exact-SHA Queue/runtime deployment;
- materially improved TTFH while preserving safety/error rate;
- authoritative listing identity/count match;
- error/retry/DLQ within documented safe budget;
- PB9/LKG, IC2/IC3 regressions and tenant isolation remain green;
- recurring Intelligent Sync remains OFF.

TTFH remains:

```text
accepted source decision
-> every discovered initial detail terminal under success/skipped/deferred
```

Do not silently exclude scheduler time or redefine terminality to make the proof pass.

## Exact continuation action

1. revalidate live `main`, open PRs, production SHA/status and `HUMAN_GATE_LOCK`;
2. read the IC4E-mapped Provider Engine, import, Queue, data-plane/runtime-dispatch and deployment contracts;
3. implement one bounded IC4E harness/workflow/test slice from latest `main`;
4. use an isolated ephemeral tenant/data plane against a real large supported source resolved server-side; never mutate the canonical merchant/LKG;
5. exercise the actual scheduler -> scan Queue -> detail Queue -> IC4B/IC4C/IC4D production path;
6. measure accepted-decision -> terminal detail TTFH plus safe counts/throughput/retry/DLQ evidence;
7. compare authoritative listing identity/count internally and publish only safe booleans/counts;
8. preserve cleanup/recovery evidence and fail closed if queues/resources are not safe to clean;
9. merge only green code/CI and then require exact-SHA trusted production proof before calling IC4E Green;
10. only after IC4E Production Green may IC5A begin.

## Broader roadmap boundary

- M7A through M7D10: **PRODUCTION GREEN** within bounded contracts.
- M7D11: **PLANNED**.
- M7E: **DECISION REQUIRED**; recurring sync remains OFF.
- M9A: **PRODUCTION GREEN**.
- M9B: **IN PROGRESS — PAUSED** while the owner-authorized PB/Instant Catalog sequence is active.
