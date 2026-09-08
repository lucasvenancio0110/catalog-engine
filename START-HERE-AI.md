# CATALOG ENGINE — AI START HERE / CONTINUITY PROTOCOL

Status: **Operational entrypoint for every new AI/contributor session**  
Repository: `lucasvenancio0110/catalog-engine`  
Default branch: `main`  
Snapshot refreshed: **2026-09-08**

This file is the bootloader. It does not replace live GitHub, `AGENTS.md`, focused normative documents, `docs/CURRENT-STATE.md`, roadmap, code, workflows, tests or trusted production evidence.

The repository is durable memory. Chat history is not authority.

---

# 1. SESSION / CAMPAIGN BOUNDARY

The owner-authorized continuous campaign currently follows:

```text
PB0 -> ... -> PB9
-> IC0 -> IC1 -> IC2 -> IC3
-> IC4A -> IC4B -> IC4C -> IC4D -> IC4E
-> IC5A -> IC5B -> IC5C -> IC5D -> IC5E
-> IC6A -> IC6B -> IC6C -> IC6D -> IC6E
-> PB10 -> PB11 -> PB12
```

The Instant Catalog insertion is owned by `docs/INSTANT-CATALOG.md`. The approved IC4–IC6 decomposition is owned by `docs/IC4-IC6-SLO60-GOVERNANCE.md`.

Every slice still requires its own bounded branch/PR, CI, merge, exact trusted deployment/proof where applicable and honest closure before the next slice starts.

This sequencing does not silently complete M7D11, activate M7E, complete M8 or close paused M9B.

---

# 2. MANDATORY STARTUP — BEFORE CODE CHANGES

A fresh AI/session must:

1. inspect live `main` HEAD and exact SHA;
2. inspect recent commits and latest merged PR;
3. list open PRs and relevant active branches;
4. inspect current commit statuses, Actions, deployments and applicable trusted proofs;
5. open the first real failing job/log when anything relevant is red;
6. distinguish secret-free PR CI from trusted-main production proof;
7. verify relevant activation flags without printing secrets;
8. inspect `docs/CURRENT-STATE.md` for `HUMAN_GATE_LOCK`;
9. if `HUMAN_GATE_LOCK: ACTIVE`, stop and follow only the Human Gate contract;
10. immediately before branch creation and merge, revalidate `main` again.

Never infer current application Production SHA from a later documentation-only `main` HEAD.

---

# 3. REQUIRED REPOSITORY READING

Always follow the live mapping in `docs/DOCUMENT-MAP.md`.

At minimum before material work read:

1. `AGENTS.md`;
2. `docs/DOCUMENT-GOVERNANCE.md`;
3. `docs/DOCUMENT-MAP.md`;
4. `docs/DEVELOPMENT-CONTINUITY.md`;
5. `docs/AUTONOMOUS-DEVELOPMENT-RUNBOOK.md` for autonomous/recurring execution;
6. `docs/CURRENT-STATE.md`;
7. `docs/DEVELOPMENT-ROADMAP.md`;
8. the focused owner documents for the active slice.

While Instant Catalog is active, always include:

- `docs/INSTANT-CATALOG.md`;
- `docs/IC4-IC6-SLO60-GOVERNANCE.md`;
- `docs/PORTAL-BETA-EXECUTION.md` for PB sequencing boundaries;
- every source/import/Queue/data-plane/deployment contract mapped to the active slice.

Historical closures/handoffs preserve evidence but cannot override live GitHub or current normative contracts.

---

# 4. AUTHORITY ORDER

When sources disagree:

1. `AGENTS.md` safety/security/contribution rules;
2. `docs/DOCUMENT-GOVERNANCE.md`;
3. focused owner document from `docs/DOCUMENT-MAP.md`;
4. narrower subsystem contracts;
5. live code/migrations/workflows/tests and current GitHub/production evidence;
6. `docs/CURRENT-STATE.md`;
7. `docs/DEVELOPMENT-ROADMAP.md`;
8. closure docs and historical ledgers/handoffs.

Reconcile contradictions instead of choosing the convenient source.

---

# 5. PROJECT MODEL THAT MUST REMAIN UNDERSTOOD

Catalog Engine is a recurring multi-tenant B2B SaaS with:

- server-authoritative account/entitlement/store/tenant relationships;
- shared low-volume control plane and isolated per-tenant catalog data planes;
- Workers for Platforms + isolated tenant D1 authority;
- Provider Engine separating source-specific acquisition from neutral catalog/CEI logic;
- Yupoo as the initial provider, not the architecture boundary;
- CEI Core + Knowledge Packs operating on normalized evidence;
- initial import separate from recurring Intelligent Sync;
- construction preview separate from PB9/L2 verified preview and public publication;
- PB9/L2 Last Known Good retained until safe verified handoff;
- no default-tenant fallback for a real merchant.

---

# 6. EVIDENCE VOCABULARY

Operational evidence labels:

- **CONFIRMADO NO CÓDIGO**
- **CONFIRMADO NO GITHUB**
- **COMPROVADO EM PRODUÇÃO**
- **DOCUMENTADO, MAS NÃO COMPROVADO**
- **HISTÓRICO**
- **HIPÓTESE**
- **PENDENTE**
- **DECISÃO DE PRODUTO**

Slice states:

- **PROPOSED**
- **PLANNED**
- **IN PROGRESS**
- **CODE GREEN**
- **PRODUCTION GREEN**
- **BLOCKED**
- **DECISION REQUIRED**
- **HISTORICAL**

A merge, skipped privileged job, preview deploy or secret-free check is never by itself Production Green.

---

# 7. IMPLEMENTATION / PR PROTOCOL

For each bounded slice:

1. select exactly the approved claim;
2. verify prerequisites and no existing PR owns it;
3. state owner docs, invariants, non-goals, proof and rollback;
4. branch from exact revalidated `main`;
5. update code + tests + owner docs together when behavior changes;
6. preserve LKG/fail-closed behavior;
7. never weaken gates to make CI green;
8. run required quality/slice-specific tests;
9. open a bounded PR;
10. diagnose the first real failure instead of retrying blindly;
11. revalidate `main` before merge;
12. merge only the exact tested head SHA;
13. inspect trusted-main deployment/proof;
14. close documentation only to the level actually proven;
15. continue automatically to the next approved slice when Green and no Human Gate exists.

Green + eligible + main unchanged means merge; do not wait for redundant owner permission inside this governed campaign.

---

# 8. PRODUCTION GREEN GATE

Production Green requires, as applicable:

- exact integrated implementation SHA;
- required CI green;
- trusted-main application/Queue/runtime deployment green;
- slice-specific privileged proof/canary green;
- required previous regressions preserved;
- activation flags at the intended boundary;
- Queue/DLQ/resource cleanup state safe or explicitly retained for diagnosis;
- no private/secret evidence leaked;
- `CURRENT-STATE.md`, closure and this bootloader reconciled.

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
IC4B = PRODUCTION GREEN
IC4C = PRODUCTION GREEN
IC4D = PRODUCTION GREEN
IC4E = PLANNED — NEXT APPROVED SLICE
IC5A–IC5E = PLANNED
IC6A–IC6E = PLANNED
PB10–PB12 = approved behind IC6
```

Detailed closures include:

- `docs/IC1-CLOSURE-2026-09-07.md`;
- `docs/IC2-CLOSURE-2026-09-07.md`;
- `docs/IC3-CLOSURE-2026-09-07.md`;
- `docs/IC4A-CLOSURE-2026-09-07.md`;
- `docs/IC4B-CLOSURE-2026-09-08.md`;
- `docs/IC4C-CLOSURE-2026-09-08.md`;
- `docs/IC4D-CLOSURE-2026-09-08.md`.

## IC4D exact Production Green evidence

Application Production SHA:

```text
4135f08805763f2c17ab6abeeabf645cbb1c0ee6
```

Exact-SHA trusted chain:

```text
application deploy = 34245336329 — SUCCESS
Queue activation = 34245474929 — SUCCESS
fleet canary = 34245474757 — SUCCESS
automatic import canary = 34245474751 — SUCCESS
PB9 proof = 34245474763 — SUCCESS
IC2 proof = 34245474831 — SUCCESS
IC3 proof = 34245474752 — SUCCESS
IC4B proof = 34245474970 — SUCCESS
IC4C proof = 34245474833 — SUCCESS
IC4D proof = 34245474949 — SUCCESS
status = catalog-engine/ic4d-tenant-d1-write-governor success
```

IC4D safe proof result:

```text
write limit = 2
4 same-tenant attempts -> 2 admitted / 2 rejected
slow D1 -> 1 writer + cooldown
healthy recovery -> 2 writers
independent tenant retains its own limit 2
5xx -> 1
transport pressure -> 1
work loss observed = false
recurring Intelligent Sync changed = false
private identifiers exposed = false
proof cleanup = complete
full quality = 190 test files / 969 tests passed
```

PB0–PB9 remain Production Green within their bounded contracts. PB9/L2 remains the verified Last Known Good authority.

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

Never activate M7E/recurring sync through Instant Catalog work.

---

# 11. NEXT APPROVED SUBMILESTONE — IC4E

## IC4E — Production Detail-Swarm Proof

Engineering outcome:

> Exercise the actual IC4B + IC4C + IC4D production topology on a real large supported catalog and measure accepted-source-decision -> terminal-detail TTFH without weakening any authority, safety, privacy, isolation or recovery rule.

Required IC4E evidence from `docs/IC4-IC6-SLO60-GOVERNANCE.md`:

- real large-catalog production proof;
- exact-SHA application and Queue/runtime deployment;
- authoritative listing identity/count match;
- materially improved TTFH versus the governed baseline;
- error/retry/DLQ within safe documented budget;
- PB9/LKG preserved;
- IC2/IC3 regressions green;
- tenant isolation green;
- recurring Intelligent Sync OFF.

TTFH remains:

```text
accepted source decision
-> every discovered initial detail terminal under success/skipped/deferred
```

IC4E must not:

- redefine TTFH or silently remove scheduler delay;
- touch the canonical merchant's verified LKG merely for benchmarking;
- use a small-category fixture as proof of large-catalog acceptance;
- bypass the actual scheduler/Queue/detail consumers;
- expose source URLs/raw provider IDs/D1 UUIDs/Worker locators/tokens;
- weaken provider or D1 governors;
- activate recurring Intelligent Sync;
- claim the final IC6 6K/60 acceptance target.

Preferred proof boundary is an isolated ephemeral tenant/data plane using a real large supported source resolved server-side, with exact ownership and safe cleanup/recovery.

Only after IC4E is honestly Production Green may IC5A begin.

---

# 12. SLO60 SAFETY ORDER

For IC4–IC6:

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

If speed conflicts with anything above it, speed loses.

Do not use proxy/IP rotation, account multiplication, hidden mirrors or throttling-evasion mechanisms.

The internal 6K/60 target is an engineering objective, never a customer countdown or guaranteed ETA.

---

# 13. PERMANENT SAFETY REMINDERS

Never regress:

- partial scan never means delete;
- LKG remains serving until safe verified promotion;
- supplier taxonomy is evidence, not public merchandising truth;
- private supplier URLs/raw IDs/evidence stay private;
- merchant overrides remain durable business truth;
- tenant isolation is fail-closed;
- default compatibility tenant is never fallback for a merchant;
- application deployment and catalog publication stay separate;
- no global Queue/DLQ purge merely to make evidence look clean;
- no manual Queue injection when the contract requires scheduler/event ownership;
- no fake customer progress/ETA/percentage;
- no tenant/D1/Worker/namespace/private-locator internals in customer UI/evidence;
- no recurring tenant-sync activation before explicit M7E approval.

---

# 14. SAVE-GAME / CLOSURE RULE

For every material Production Green closure record at minimum:

```text
exact application Production SHA
implementation/proof PR chain
required CI
trusted deploy
slice-specific production proof/canary
required regressions
activation flags
root cause/defect and fix when applicable
focused closure doc
CURRENT-STATE.md
this START-HERE snapshot
exact next approved slice
explicit non-goals/not-implemented list
```

Updating documentation may create a later `main` SHA. Keep that separate from the exact application Production SHA.

---

# FINAL BOOT RULE

A new AI must not ask the owner to restate project history when live GitHub + repository documentation can resolve it.

```text
READ THIS FILE
-> REVALIDATE LIVE GITHUB + HUMAN GATE
-> READ AGENTS / GOVERNANCE / MAPPED OWNER DOCS
-> INSPECT LIVE CODE / WORKFLOWS / TESTS
-> RECONCILE CONTRADICTIONS
-> IDENTIFY EXACT APPROVED SLICE
-> EXECUTE GOVERNED WORK
-> PROVE TO REQUIRED LEVEL
-> UPDATE DURABLE STATE
-> CONTINUE ONLY WITHIN THE ACTIVE OWNER-AUTHORIZED CAMPAIGN
```
