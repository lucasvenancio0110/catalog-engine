# Catalog Engine — Current State

Status: **Living implementation/proof truth**  
Snapshot refreshed: **2026-09-08**  
Repository: `lucasvenancio0110/catalog-engine`

This document is intentionally compact. Focused normative documents own durable contracts; closure documents retain detailed historical evidence; live GitHub and exact production evidence remain authoritative.

## Human gate

```text
HUMAN_GATE_LOCK: INACTIVE
```

Every autonomous resume must revalidate the live repository and any newer gate before acting.

## Production activation boundary

```text
TENANT_IMPORT_AUTOMATION_ENABLED=1
TENANT_SYNC_AUTOMATION_ENABLED=0
TENANT_SYNC_ACTIVE_COHORT=""
TENANT_SYNC_MAX_JOBS_PER_TICK=1
```

Automatic **initial tenant import is enabled**. Recurring tenant Intelligent Sync remains **disabled**. M7E remains separately decision-gated.

## Exact production baseline

The current exact application Production SHA under IC4C proof is:

```text
41e5ae867e45bdfdaac2c7e84e824da2e5681bcd
```

It is the merge SHA of PR #306 and deployed through application run `34201518868 = SUCCESS`. The deployment passed quality, build/artifact verification, D1 migrations, Worker/static deployment, binding checks, import/sync boundary checks and production smoke.

Exact-SHA evidence already green on this SHA includes application deploy, Queue activation, PB6/PB7/PB8/PB9, IC1, IC2 and IC3. Queue activation reconfirmed the IC4B target `detail batch=1 / maxConcurrency=4` with retry/DLQ and automation boundaries preserved.

The dedicated IC4C production-proof workflow is run:

```text
Cloudflare IC4C adaptive provider governor proof = 34201611840
status at this checkpoint = IN PROGRESS
```

It is intentionally waiting for the remaining exact-SHA provider/fleet/IC4B regressions before its privileged proof job may start. This checkpoint **does not** declare IC4C Production Green.

A later docs-only `main` HEAD may legitimately differ from this Production SHA. Never infer Production Green from merge or documentation alone.

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

The real CROCCODILOS isolated tenant remains approximately 6k products with completed import, CEI/classification, verification, runtime and authenticated PB9 private preview. Anonymous, cross-tenant and default-tenant access remain fail-closed. The historical default tenant is explicit compatibility state, never an implicit fallback for a real merchant.

## Instant Catalog order

Owner contracts:

- `docs/INSTANT-CATALOG.md` — IC0–IC6 architecture and sequencing;
- `docs/IC4-IC6-SLO60-GOVERNANCE.md` — approved IC4–IC6 performance/security decomposition and 6K/60 engineering program.

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

- IC0 — Governance + performance contract: **COMPLETE / GOVERNANCE GREEN**; PR #272.
- IC1 — Real latency baseline + branded creation UX: **PRODUCTION GREEN**; `IC1-CLOSURE-2026-09-07.md`.
- IC2 — Instant seed + construction preview: **PRODUCTION GREEN**; `IC2-CLOSURE-2026-09-07.md`.
- IC3 — Streaming/parallel listing discovery: **PRODUCTION GREEN**; `IC3-CLOSURE-2026-09-07.md`.
- IC4A — Detail throughput baseline + safe telemetry: **PRODUCTION GREEN**; `IC4A-CLOSURE-2026-09-07.md`.
- IC4B — Queue micro-delivery + horizontal consumer fan-out: **PRODUCTION GREEN**; PR #299, exact-SHA proof `34192306859`, `IC4B-CLOSURE-2026-09-08.md`.
- IC4C — Adaptive upstream governor: **PRODUCTION PROOF IN PROGRESS — NOT PRODUCTION GREEN**; implementation PR #305, dedicated proof PR #306.
- IC4D — Tenant D1 write-pressure governor: **PLANNED — NOT AUTHORIZED UNTIL IC4C CLOSURE**.
- IC4E — Production detail-swarm proof: **PLANNED**.
- IC5A–IC5E — Warm start + batched persistence/streaming CEI: **PLANNED**.
- IC6A–IC6E — Fresh 6K/60 integration/chaos/acceptance: **PLANNED**.
- PB10 remains approved but paused until IC6 reaches its required Green state.

PB9 stays the verified L2 Last Known Good authority while construction/acceleration paths are developed.

## IC4B Production Green evidence

The closing exact-SHA proof established:

```text
production detail batch size = 1
production detail max concurrency = 4
production max retries = 5
production Queue backlog = 0
production DLQ backlog = 0
probe expected/completed/unique = 24/24/24
probe max observed active Workers = 4
probe Queue backlog = 0
probe DLQ backlog = 0
initial import = ON
recurring Intelligent Sync = OFF
private identifiers exposed = false
```

Cleanup was required before Green. The first bounded teardown observation had not converged; the workflow retried rather than hiding the condition, and the next bounded attempt proved Worker, Queue, DLQ and D1 cleanup complete.

The conservative source config remains the explicit rollback template:

```text
max_batch_size = 4
max_batch_timeout = 5s
max_concurrency = 2
max_retries = 5
retry_delay = 120s
```

Trusted activation derives the proven IC4B `batch=1 / maxConcurrency=4` production target while preserving unrelated infrastructure.

## Active execution point

**IC4C — Adaptive Upstream Governor: ACTIVE SLICE / PROOF PHASE.**

Implementation merged in PR #305 provides one server-side Durable Object coordination authority per opaque provider/source-host key. Admission is transactional and lease-based, starts conservatively at `2`, has hard floor `1` and ceiling `4`, increases only after healthy windows, and multiplicatively reduces on upstream `429`, meaningful `5xx`, timeout/transport failure or degraded latency. Provider detail fetches from initial and incremental handlers share this same authority; Cloudflare/platform/internal traffic is excluded from provider-pressure accounting.

PR #306 added the dedicated trusted production proof without changing the production governor semantics. Its guarded ephemeral probe exports the same production `ProviderDetailGovernor` class and is designed to prove, on trusted Cloudflare infrastructure:

- real Durable Object coordination rather than a process-local counter;
- initial admission limit `2`;
- healthy bounded scale-up `2 -> 3 -> 4`;
- eight concurrent admission attempts capped globally at four admitted/four rejected;
- reduction `4 -> 2` plus cooldown on `429`, `5xx`, timeout and degraded latency;
- opaque source-safe coordination identity and bounded evidence;
- recurring Intelligent Sync remains OFF;
- cleanup of the ephemeral proof Worker before successful status publication.

The proof is gated on exact-SHA application deploy, Queue activation, automatic provider import, PB9/LKG, IC2, IC3 and IC4B evidence. No PR validation receives production Cloudflare credentials.

IC4C is **not** Production Green until run `34201611840` completes successfully, publishes `catalog-engine/ic4c-provider-governor = success`, the required exact-SHA regressions remain green and a closure document/state transition is merged.

## Permanent safety result through IC4B

- listing/detail work remains bounded;
- partial listing batches never become complete authority;
- partial observations cannot infer missing/removal;
- duplicate/retry/DLQ semantics remain durable;
- source/provider-private identifiers remain server-side;
- tenant isolation remains fail-closed;
- PB9 verified LKG remains authoritative;
- recurring Intelligent Sync remains OFF;
- no fake customer percentage/countdown/ETA;
- throughput loses to security, isolation, correctness, provider safety and recovery.

## Exact continuation action

1. revalidate live `main`, open PRs, CI/deploy/proof statuses and `HUMAN_GATE_LOCK`;
2. consume fleet/automatic-provider/IC4B exact-SHA regressions for Production SHA `41e5ae867e45bdfdaac2c7e84e824da2e5681bcd`;
3. consume dedicated IC4C run `34201611840` and inspect the privileged proof job step-by-step;
4. if the proof fails, fix the first proven root cause without weakening thresholds or safety boundaries, then repeat exact-SHA proof;
5. if the proof and required regressions are green, add `IC4C-CLOSURE-2026-09-08.md`, transition IC4C to **PRODUCTION GREEN**, and mark IC4D as the next approved slice;
6. only after that closure/state transition merges may implementation of IC4D begin.

## Broader roadmap boundary

- M7A through M7D10: **PRODUCTION GREEN** within bounded contracts.
- M7D11: **PLANNED**.
- M7E: **DECISION REQUIRED**; recurring sync remains OFF.
- M9A: **PRODUCTION GREEN**.
- M9B: **IN PROGRESS — PAUSED** while the owner-authorized PB/Instant Catalog sequence is active.
