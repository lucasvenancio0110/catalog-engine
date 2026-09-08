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
eb1a4612e3c216530a4ac951b917ef9fb8b2a06d
```

Application deployment for this exact SHA:

```text
Deploy Catalog Engine application = 34213150775 — SUCCESS
```

The exact-SHA post-deploy chain is still running. Queue activation `34213282070`, fleet/real-provider regressions, IC4B/IC4C regressions and the dedicated IC4D proof `34213281785` are intentionally serialized by the shared production mutation/evidence gates. Do not infer IC4D Production Green until `catalog-engine/ic4d-tenant-d1-write-governor = success` exists on this exact Production SHA.

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
- IC4D — Tenant D1 write-pressure governor: **IMPLEMENTED + DEPLOYED; TRUSTED PRODUCTION PROOF IN PROGRESS — NOT GREEN YET**.
- IC4E — Production detail-swarm proof: **PLANNED / BLOCKED UNTIL IC4D PRODUCTION GREEN**.
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

## IC4D implementation boundary

Implementation merged through PR #312 and the trusted proof harness through PR #313.

Production behavior now includes a dedicated per-tenant `TenantD1WriteGovernor` Durable Object, independent from the IC4C provider governor:

- only mutating tenant-dispatch D1 batches consume write permits;
- read-only tenant D1 traffic remains outside the write budget;
- provider fetch pressure remains owned separately by IC4C;
- each tenant has an opaque independent pressure authority;
- normal tenant write ceiling = `2`;
- slow D1 / tenant-data-plane 5xx / dispatch transport pressure reduces that tenant to `1` writer with bounded cooldown;
- a bounded healthy-write window recovers `1 -> 2`;
- lease expiry prevents a crashed Worker from permanently consuming capacity;
- Queue claim/retry/idempotency and PB9/LKG authority remain unchanged;
- recurring Intelligent Sync remains OFF;
- IC4D does not implement the IC5C normalized-result Queue/write-combiner architecture.

Implementation exact-SHA `0d18bfe77c53289938ea097bd681ad3635ad0d52` already completed application deploy `34212646964` and Queue activation `34212750612`, proving the detail consumer can deploy with the IC4D Durable Object migration/binding. The later Production SHA `eb1a4612e3c216530a4ac951b917ef9fb8b2a06d` additionally contains the dedicated exact-SHA proof harness.

## IC4D trusted proof contract now running

Workflow:

```text
Cloudflare IC4D tenant D1 write-pressure governor proof
run = 34213281785
Production SHA = eb1a4612e3c216530a4ac951b917ef9fb8b2a06d
```

Before receiving privileged proof authority it requires the same SHA to prove:

- application deploy;
- Queue consumer activation;
- automatic real-provider initial import;
- PB9 Last Known Good;
- IC2 isolation/construction regression;
- IC3 listing regression;
- IC4B detail fan-out regression;
- IC4C provider governor regression.

The isolated guarded IC4D proof then requires:

```text
initial tenant write limit = 2
4 same-tenant concurrent attempts -> 2 admitted / 2 rejected
artificial slow D1 -> limit 1 + cooldown reject
after cooldown -> one writer only
bounded healthy window -> recovery to limit 2
independent second tenant -> its own limit 2 remains available
5xx pressure -> limit 1
transport pressure -> limit 1
workLossObserved = false
recurringIntelligentSyncChanged = false
privateIdentifiersExposed = false
proof resource cleanup before success publication
```

No threshold may be weakened merely to make this proof pass.

## Permanent safety result through current IC4D implementation

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

**IC4D — Tenant D1 Write-Pressure Governor: TRUSTED PRODUCTION PROOF IN PROGRESS.**

Do not begin IC4E while this proof is unresolved.

The shared production mutation slot is currently allowed to finish the previous exact-SHA real auto-import canary before Queue activation and downstream evidence for `eb1a461...` proceed. This serialization is expected safety behavior, not an IC4D defect.

## Exact continuation action

1. revalidate live `main`, open PRs, CI/deploy/proof status and `HUMAN_GATE_LOCK`;
2. treat `eb1a4612e3c216530a4ac951b917ef9fb8b2a06d` as the current application Production SHA unless live deployment evidence supersedes it;
3. consume Queue activation `34213282070` and the exact-SHA fleet/auto-import regressions;
4. consume IC4B and IC4C regressions on the same SHA;
5. allow IC4D run `34213281785` to enter its privileged proof only after those prerequisites are green;
6. if the IC4D proof fails, fix the first real root cause without reducing acceptance criteria and repeat exact-SHA proof;
7. only if `catalog-engine/ic4d-tenant-d1-write-governor = success` is published on the Production SHA, create `docs/IC4D-CLOSURE-2026-09-08.md`, mark IC4D **PRODUCTION GREEN** and authorize **IC4E — Production Detail-Swarm Proof**;
8. otherwise remain in IC4D.

## Broader roadmap boundary

- M7A through M7D10: **PRODUCTION GREEN** within bounded contracts.
- M7D11: **PLANNED**.
- M7E: **DECISION REQUIRED**; recurring sync remains OFF.
- M9A: **PRODUCTION GREEN**.
- M9B: **IN PROGRESS — PAUSED** while the owner-authorized PB/Instant Catalog sequence is active.
