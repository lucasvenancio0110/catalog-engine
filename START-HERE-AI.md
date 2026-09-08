# CATALOG ENGINE — AI START HERE / CONTINUITY PROTOCOL

Status: **Operational entrypoint for every new AI/contributor session**  
Repository: `lucasvenancio0110/catalog-engine`  
Default branch: `main`  
Snapshot refreshed: **2026-09-07**

This file is the bootloader. It does not replace live GitHub, `AGENTS.md`, focused normative docs, `docs/CURRENT-STATE.md`, roadmap, code, workflows, tests or trusted production evidence.

The repository is durable memory. Chat history is not authority.

---

# 1. SESSION / CAMPAIGN BOUNDARY

Default protocol is one officially approved submilestone per conversation. The owner-authorized continuous campaign permits continuing through the explicitly approved temporary sequence while every individual slice still keeps its own branch, PR, CI, deploy/proof and closure gate.

The current owner-authorized order is:

```text
PB0 -> ... -> PB9
-> IC0 -> IC1 -> IC2 -> IC3
-> IC4A -> IC4B -> IC4C -> IC4D -> IC4E
-> IC5A -> IC5B -> IC5C -> IC5D -> IC5E
-> IC6A -> IC6B -> IC6C -> IC6D -> IC6E
-> PB10 -> PB11 -> PB12
```

The Instant Catalog insertion is owned by `docs/INSTANT-CATALOG.md`. The approved IC4–IC6 performance/security decomposition is owned by `docs/IC4-IC6-SLO60-GOVERNANCE.md`.

After PB12 the default return point remains paused **M9B — Product Discovery and Merchandising**, unless a later explicit owner decision changes sequencing.

This sequencing does not silently complete M7D11, activate M7E, complete M8 or close M9B.

---

# 2. MANDATORY STARTUP — BEFORE CODE CHANGES

A fresh AI/session must:

1. inspect live `main` HEAD and exact SHA;
2. inspect recent commits and latest merged PR;
3. list open PRs and identify active/stale branches;
4. inspect current commit statuses, Actions, deploys and applicable trusted proofs;
5. open the first real failing job/log if anything relevant is red;
6. distinguish secret-free PR CI from trusted-main production proof;
7. verify relevant activation flags without printing secrets;
8. check durable operational state for `HUMAN_GATE_LOCK`;
9. if `HUMAN_GATE_LOCK: ACTIVE`, stop and follow only the Human Gate contract;
10. immediately before branch creation, revalidate `main` again.

Never infer current production SHA from a documentation-only HEAD. Application Production SHA and later proof/documentation SHAs may legitimately differ.

---

# 3. REQUIRED REPOSITORY READING

On a new submilestone conversation, read integrally:

1. `START-HERE-AI.md`;
2. `AGENTS.md`;
3. `README.md`;
4. root handoff/continuity Markdown files;
5. `docs/DOCUMENT-GOVERNANCE.md`;
6. `docs/DOCUMENT-MAP.md`;
7. `docs/DEVELOPMENT-CONTINUITY.md`;
8. `docs/CURRENT-STATE.md`;
9. `docs/DEVELOPMENT-ROADMAP.md`;
10. every current `docs/**/*.md` file, after recursively enumerating the live docs tree.

While the PB campaign/Instant Catalog insertion is active, also treat these focused owner docs as mandatory for slice selection:

- `docs/PORTAL-BETA-EXECUTION.md`;
- `docs/INSTANT-CATALOG.md`;
- `docs/IC4-IC6-SLO60-GOVERNANCE.md` while IC4–IC6 work is active;
- the subsystem owner docs mapped by `docs/DOCUMENT-MAP.md`.

Historical ledgers/closure docs preserve evidence but do not override current normative contracts or live production truth.

---

# 4. AUTHORITY ORDER

Use this order when sources disagree:

1. safety/security/contribution rules in `AGENTS.md`;
2. `docs/DOCUMENT-GOVERNANCE.md`;
3. focused owner doc from `docs/DOCUMENT-MAP.md`;
4. narrower subsystem contracts;
5. live code/migrations/workflows/tests and current GitHub/production evidence;
6. `docs/CURRENT-STATE.md` for mutable execution truth;
7. `docs/DEVELOPMENT-ROADMAP.md` for macro approved order/status;
8. closure docs as historical proof;
9. historical ledgers/handoffs;
10. snapshot text in this file.

Reconcile contradictions instead of choosing the convenient source.

---

# 5. PROJECT MODEL THAT MUST REMAIN UNDERSTOOD

Before coding, a contributor must be able to explain:

- Catalog Engine is a recurring multi-tenant B2B SaaS;
- account/entitlement/store/tenant relationships are server-authoritative;
- shared control plane and isolated tenant data planes have different responsibilities;
- tenant catalog authority uses Workers for Platforms + isolated per-tenant D1;
- Provider Engine isolates provider-specific acquisition from neutral catalog/CEI logic;
- Yupoo is the initial supported provider, not the product architecture;
- CEI Core and Knowledge Packs reason over normalized evidence;
- initial import and recurring Intelligent Sync are separate systems;
- publication/custom-domain authority is separate from private preview/construction preview;
- Last Known Good remains serving authority until a safe promotion occurs;
- default compatibility tenant is never fallback authority for a real merchant.

If those boundaries are unclear, startup is incomplete.

---

# 6. EVIDENCE VOCABULARY

Use repository evidence labels honestly:

- **CONFIRMADO NO CÓDIGO**
- **CONFIRMADO NO GITHUB**
- **COMPROVADO EM PRODUÇÃO**
- **DOCUMENTADO, MAS NÃO COMPROVADO**
- **HISTÓRICO**
- **HIPÓTESE**
- **PENDENTE**
- **DECISÃO DE PRODUTO**

Roadmap/slice state:

- **PROPOSED**
- **PLANNED**
- **IN PROGRESS**
- **CODE GREEN**
- **PRODUCTION GREEN**
- **BLOCKED**
- **DECISION REQUIRED**
- **HISTORICAL**

A PR merge, skipped privileged job or secret-free check is never by itself production proof.

---

# 7. IMPLEMENTATION / PR PROTOCOL

For each bounded slice:

1. select exactly the approved claim;
2. verify prerequisites and no open PR already owns it;
3. state non-goals, owner docs, expected surfaces, proof and rollback;
4. branch from exact revalidated `main`;
5. update code + tests + owner docs together when behavior changes;
6. preserve LKG/fail-closed behavior;
7. do not weaken gates to make CI green;
8. run required quality/slice-specific tests;
9. open a bounded PR with scope/invariants/risks/rollback/evidence;
10. diagnose the first real failure instead of retrying blindly;
11. revalidate `main` immediately before merge;
12. merge only the exact tested head SHA;
13. deploy/prove on trusted main when required;
14. close documentation to the level actually proven.

Green + eligible + main unchanged means merge; do not wait for redundant owner permission inside the active governed campaign.

---

# 8. PRODUCTION GREEN GATE

A slice may be called **PRODUCTION GREEN** only when every applicable proof is satisfied, including as relevant:

- exact merged implementation SHA;
- required CI green;
- trusted-main deployment green;
- Queue/consumer/runtime/schema/fleet proof green when changed;
- slice-specific production canary/proof green;
- required previous regressions preserved;
- activation flags at intended boundary;
- Queue/DLQ state clean or explicitly explained;
- no private/secret evidence leaked;
- `CURRENT-STATE.md`, focused owner docs, closure and this bootloader reconciled.

If production evidence is missing, stop at the lower truthful level.

---

# 9. CURRENT PROVEN CHECKPOINT — REVALIDATE LIVE

At this snapshot:

```text
IC0 = COMPLETE / GOVERNANCE GREEN
IC1 = PRODUCTION GREEN
IC2 = PRODUCTION GREEN
IC3 = PRODUCTION GREEN
IC4A = PRODUCTION GREEN
IC4B = PLANNED — NEXT APPROVED SLICE
IC4C–IC4E = PLANNED
IC5A–IC5E = PLANNED
IC6A–IC6E = PLANNED
PB10–PB12 = approved behind IC6
```

Detailed closures:

- `docs/IC1-CLOSURE-2026-09-07.md`;
- `docs/IC2-CLOSURE-2026-09-07.md`;
- `docs/IC3-CLOSURE-2026-09-07.md`;
- `docs/IC4A-CLOSURE-2026-09-07.md`.

## IC4A exact production proof

```text
application Production SHA = 02bb72ee15b0fae7968b72c18a6bd508cffe8474
deploy run = 34171630268
Queue activation run = 34171688412
PB9 proof run = 34171688408
PB8 proof run = 34171761181
IC2 proof run = 34171688381
IC2 proof job = 101893053635
IC3 proof run = 34171688377
IC3 proof job = 101893752533
IC4A proof run = 34171688443
IC4A proof job = 101894437682
status = catalog-engine/ic4a-detail-baseline success
```

Safe IC4A baseline:

```text
referenceClass = real-large-catalog
discovered = 6104
terminal = 6104
success = 6097
skipped = 5
deferred = 2
failed = 0
terminalProductsPerSecond = 0.971
Queue backlog = 0
DLQ backlog = 0
sample successful = 6/6
provider fetch p95 = 1219.9 ms
normalization p95 = 8.2 ms
D1 write p95 = 361.4 ms
total measured p95 = 1554.2 ms
max_batch_size = 4
max_batch_timeout = 5s
max_concurrency = 2
max_retries = 5
temporaryDatabaseCleaned = true
detailConcurrencyChanged = false
privateIdentifiersExposed = false
recurringIntelligentSyncEnabled = false
```

Measured conclusion: provider/network fetch is the dominant per-product cost; D1 persistence is second; normalization is small by comparison. IC4A changed no production detail concurrency.

## IC3 exact-SHA regression retained for IC4A closure

The permanent `5%` IC3 gate was not weakened. After one noisy failed A/B, one justified rerun passed:

```text
baselineMs = 105574
fanoutMs = 98671
improvementPct = 6.5
productCount = 6111
identityMatch = true
taxonomyMatch = true
baselineRequests = 449
fanoutRequests = 344
baselineMaxActive = 4
fanoutMaxActive = 4
requestConcurrency = 4
minimumImprovementPct = 5
privateIdentifiersExposed = false
recurringIntelligentSyncEnabled = false
```

Historical IC3 closure evidence at `9cc5b3e...` remains valid historical proof of the earlier `9.2%` production run.

## IC2 exact-SHA regression retained for IC4A closure

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

Earlier proof attempts encountered Cloudflare `1042`/`1104`; PR #297 added a read-only D1/Durable Object binding probe and allowlisted diagnostic boundary. The final exact-SHA proof passed. Do not overclaim a more specific Cloudflare root cause.

Historical IC1 CROCCODILOS baseline remains useful for comparison:

```text
import started = 2,121,000 ms = 35m21s
listing scan complete = 2,290,000 ms = 38m10s
full initial import complete = 8,583,000 ms = 2h23m03s
classification complete = 12,326,000 ms = 3h25m26s
verification complete = 12,621,000 ms = 3h30m21s
```

PB0–PB9 remain Production Green within their bounded contracts. PB9 remains the verified L2 Last Known Good authority.

---

# 10. CURRENT ACTIVATION / SAFETY BOUNDARY

```text
TENANT_DATA_PLANE_SCHEMA_VERSION = 8
migration command capability = v4
TENANT_IMPORT_AUTOMATION_ENABLED = 1
TENANT_SYNC_AUTOMATION_ENABLED = 0
TENANT_SYNC_ACTIVE_COHORT = empty
TENANT_SYNC_MAX_JOBS_PER_TICK = 1
```

Automatic initial import is active. Recurring tenant Intelligent Sync is not.

Never activate M7E/recurring sync implicitly through Instant Catalog work.

---

# 11. NEXT APPROVED SUBMILESTONE — IC4B

## IC4B — Queue Micro-delivery and Horizontal Consumer Fan-out

Engineering outcome:

> Use the IC4A measured baseline to remove the fixed two-consumer delivery bottleneck through bounded independent Worker invocations, while keeping provider pressure conservative until IC4C owns the coordinated adaptive governor.

IC4B is governed by `docs/IC4-IC6-SLO60-GOVERNANCE.md`.

Current rollback baseline:

```text
catalog-engine-import-detail
max_batch_size = 4
max_batch_timeout = 5s
max_concurrency = 2
max_retries = 5
batch messages processed sequentially by the consumer
```

Required IC4B work/evidence:

- evaluate Queue delivery batch size `1–2` versus current batch `4` from IC4A evidence;
- establish an explicit bounded Worker-level concurrency ceiling;
- increase horizontal consumer invocation parallelism without unbounded in-process fan-out;
- preserve exact per-message import/tenant/product ownership;
- preserve claim/lease/idempotency/retry/DLQ semantics;
- prove two-tenant isolation remains fail-closed;
- prove provider error/throttle behavior is not materially worse than the IC4A safety baseline;
- prove Queue/DLQ health on exact production deployment;
- preserve a direct rollback to the conservative IC4A topology;
- keep any new acceleration authority default OFF until its dedicated trusted proof/activation boundary requires otherwise;
- keep supplier URLs/hostnames/raw provider IDs/media origins/D1 UUIDs/Worker locators/tokens/secrets out of browser/public/safe proof evidence;
- recurring Intelligent Sync stays OFF and PB9/L2 remains Last Known Good.

IC4B does **not** own:

- IC4C coordinated adaptive AIMD provider governor;
- IC4D tenant-D1 write-pressure governor;
- IC4E large-catalog swarm acceptance;
- IC5 result Queue/write combiner;
- IC5 streaming CEI or warm tenant pool;
- IC6 6K/60 acceptance;
- Provider Snapshot Engine;
- any customer-facing 60-second guarantee.

---

# 12. SLO60 SAFETY ORDER

For IC4–IC6 the permanent priority is:

```text
security / privacy
> tenant isolation
> correctness / complete-scan authority
> Last Known Good preservation
> provider safety
> recovery / idempotency
> observability
> latency / throughput
```

If speed conflicts with any higher item, speed loses.

Do not use proxy/IP rotation, account multiplication, hidden mirrors or another mechanism intended to evade provider throttling/access controls.

The internal 6K/60 target is an engineering objective, never a customer countdown or guaranteed ETA.

---

# 13. PERMANENT SAFETY REMINDERS

Never regress:

- partial scan never means delete;
- LKG remains serving until safe verified promotion;
- supplier taxonomy is evidence, not automatically public merchandising truth;
- private supplier URLs/raw IDs/evidence remain private;
- merchant overrides are durable tenant business truth;
- tenant isolation is fail-closed;
- default compatibility tenant is never fallback for a merchant;
- deployment and publication are separate responsibilities;
- PR validation remains secret-free unless a specifically governed trusted flow says otherwise;
- do not purge global Queues/DLQs merely to make evidence look clean;
- no manual Queue injection when contract requires scheduler/event ownership;
- no fake customer progress/ETA/percentage;
- customer UI does not expose tenant/D1/Worker/namespace/private-locator internals;
- no recurring tenant-sync activation before explicit M7E approval.

---

# 14. SAVE-GAME / CLOSURE RULE

For every material Production Green closure record at minimum:

```text
exact implementation Production SHA
implementation PR
required CI
trusted deploy
slice-specific production proof/canary
required regressions
activation flags
root cause/defect and fix if any
focused closure doc
CURRENT-STATE.md
focused owner docs when contract/status changes
this START-HERE snapshot
exact next approved slice
explicit non-goals/not-implemented list
```

Updating documentation may create a later main SHA. Keep the exact application Production SHA separate from documentation/proof SHAs.

---

# FINAL BOOT RULE

A new AI must not ask the owner to restate project history when live GitHub + repository documentation can resolve it.

Required behavior:

```text
READ THIS FILE
-> REVALIDATE LIVE GITHUB + HUMAN GATE
-> READ AGENTS / README / GOVERNANCE / ALL docs
-> INSPECT LIVE CODE / WORKFLOWS / TESTS
-> RECONCILE CONTRADICTIONS
-> IDENTIFY EXACT APPROVED SLICE
-> EXECUTE GOVERNED WORK
-> PROVE TO REQUIRED LEVEL
-> UPDATE DURABLE STATE
-> CONTINUE ONLY WITHIN THE ACTIVE OWNER-AUTHORIZED CAMPAIGN BOUNDARY
```