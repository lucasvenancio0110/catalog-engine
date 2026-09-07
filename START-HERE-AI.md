# CATALOG ENGINE — AI START HERE / CONTINUITY PROTOCOL

Status: **Operational entrypoint for every new AI/contributor session**  
Repository: `lucasvenancio0110/catalog-engine`  
Default branch: `main`  
Snapshot refreshed: **2026-09-07**

This file is the bootloader. It does not replace live GitHub, `AGENTS.md`, focused normative docs, `docs/CURRENT-STATE.md`, roadmap, code, workflows, tests or trusted production evidence.

The repository is durable memory. Chat history is not authority.

---

# 1. SESSION / CAMPAIGN BOUNDARY

Default protocol is one officially approved submilestone per conversation. The owner-authorized continuous campaign begun on 2026-08-30 is a conversation-scoped exception and permits continuing through the explicitly approved temporary sequence while every individual slice still keeps its own branch, PR, CI, deploy/proof and closure gate.

The current owner-authorized order is:

```text
PB0 -> ... -> PB9
-> IC0 -> IC1 -> IC2 -> IC3 -> IC4 -> IC5 -> IC6
-> PB10 -> PB11 -> PB12
```

The Instant Catalog insertion is owned by `docs/INSTANT-CATALOG.md`.

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
IC3 = PLANNED — NEXT APPROVED SLICE
IC4–IC6 = PLANNED
PB10–PB12 = approved behind IC6
```

Detailed closures:

- `docs/IC1-CLOSURE-2026-09-07.md`;
- `docs/IC2-CLOSURE-2026-09-07.md`.

## IC2 exact production proof

```text
application Production SHA = 9b6b5251fd59eb5ea82d30b3f1f8a7ff19e3319b
deploy run = 34128489551
IC2 proof run = 34130174224
proof attempt = 3
proof job = 101776923895
status = catalog-engine/ic2-production-proof success
PB9 exact-SHA proof = success
```

Fresh production measurement:

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

The 6.715-second TTFI/TTFC is engineering evidence for that proof, never a universal customer ETA.

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

# 11. NEXT APPROVED SUBMILESTONE — IC3

## IC3 — Streaming / parallel listing discovery

Customer/engineering outcome:

> After IC2 shows the first real products quickly, the authoritative listing discovery should grow much faster without turning a partial scan into complete catalog truth or overwhelming the supplier.

Required architecture direction from `docs/INSTANT-CATALOG.md`:

- introduce bounded page-level fan-out behind the Provider Engine boundary;
- preserve one shared concurrency budget across nested category/page work;
- expose normalized page batches progressively to internal ingestion stages;
- keep authoritative complete-scan success dependent on every required page succeeding;
- preserve stable opaque product identity and existing retry/failure semantics;
- keep provider/source locators out of browser/public evidence;
- measure TTFA improvement from real production evidence.

IC3 Definition of Done requires:

- partial observation cannot replace authoritative index;
- full-scan identity/count matches baseline fixtures;
- concurrency is bounded by the approved queue/concurrency primitive;
- provider failure/throttling remains fail-safe;
- measured TTFA improves without increased error or private-leak rate;
- PB9/LKG and IC2 safety regressions remain green.

IC3 does **not** own IC4 adaptive detail swarm/governor, IC5 warm cell pool, IC6 final fresh-beta proof, PB10 Merchant Home, recurring sync activation or M7E.

---

# 12. PERMANENT SAFETY REMINDERS

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

# 13. SAVE-GAME / CLOSURE RULE

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