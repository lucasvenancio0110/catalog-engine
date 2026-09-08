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

## Exact live baseline before IC4C merge

The exact trusted-main SHA that closed IC4B is:

```text
80c0701ae85bd289e68df340a7e506757cd03b10
```

Exact production evidence on that SHA includes:

```text
Cloudflare automatic tenant import canary 34192306826 = SUCCESS
Cloudflare IC4B detail fan-out proof 34192306859 = SUCCESS
IC4B proof job 101957412315 = SUCCESS
catalog-engine/ic4b-detail-fanout = success
```

A later docs/implementation HEAD may legitimately differ from this production SHA until its own exact deployment/proofs complete. Never infer Production Green from merge alone.

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
- IC4C — Adaptive upstream governor: **IN PROGRESS — IMPLEMENTATION/CI, NOT PRODUCTION GREEN**.
- IC4D — Tenant D1 write-pressure governor: **PLANNED**.
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

**IC4C — Adaptive Upstream Governor: ACTIVE SLICE.**

IC4C owns provider/source-host fetch admission only. Its required implementation/proof boundary is:

- coordinate across independent Worker invocations using an isolated server-side primitive;
- never rely on process-local counters for global provider pressure;
- start conservatively;
- additive increase only after healthy windows;
- multiplicative reduction on upstream `429`, meaningful `5xx`, timeout/transport failure or degraded latency;
- bounded cooldown and jitter;
- hard floor and hard ceiling;
- source/provider locator stays private; coordination identity must be opaque;
- nested Worker invocation cannot bypass the hard provider ceiling;
- no proxy rotation, IP rotation, account multiplication or throttling evasion;
- initial import remains ON;
- recurring Intelligent Sync remains OFF;
- PB9/L2 remains Last Known Good authority.

Current IC4C implementation direction uses one server-side Durable Object coordination authority per opaque provider/source-host key. Admission is lease-based and transactional so concurrent Workers cannot exceed the shared ceiling through read/write races. Provider fetches from both initial and incremental detail handlers flow through the same governor boundary, while Cloudflare/platform/internal traffic is excluded from provider-pressure accounting.

IC4C is **not** Production Green until exact trusted production evidence proves the required slowdown/scale-up/privacy/ceiling behavior and the normal PB9/Queue/provider/isolation regressions remain green.

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
2. finish IC4C unit/integration coverage for transactional hard-ceiling admission, healthy AIMD scale-up, 429/5xx/timeout/latency slowdown and private opaque coordination identity;
3. merge only a fully green IC4C implementation PR;
4. verify the exact merged SHA deploys the application and Queue consumer safely, including the Durable Object migration/binding;
5. add/run the dedicated exact-SHA IC4C trusted production proof without weakening thresholds;
6. prove normal automatic provider import, PB9/LKG, IC2/IC3/IC4B and tenant-isolation regressions remain green;
7. close IC4C only after exact evidence, then and only then authorize IC4D.

## Broader roadmap boundary

- M7A through M7D10: **PRODUCTION GREEN** within bounded contracts.
- M7D11: **PLANNED**.
- M7E: **DECISION REQUIRED**; recurring sync remains OFF.
- M9A: **PRODUCTION GREEN**.
- M9B: **IN PROGRESS — PAUSED** while the owner-authorized PB/Instant Catalog sequence is active.
