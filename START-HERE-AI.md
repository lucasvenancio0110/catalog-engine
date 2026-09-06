# CATALOG ENGINE — AI START HERE / CONTINUITY PROTOCOL

Status: **Operational entrypoint for every new AI/contributor session**  
Repository: `lucasvenancio0110/catalog-engine`  
Default branch: `main`  
Purpose: let a brand-new AI understand the entire Catalog Engine, revalidate live truth, execute approved work within the continuity boundary, prove it correctly, and update the repository as durable memory.

---

# 0. READ THIS FIRST — THIS FILE IS A BOOTLOADER, NOT THE FINAL SOURCE OF TRUTH

This file is the single entrypoint a new AI may be told to read first.

It does **not** replace:

- live GitHub;
- `AGENTS.md`;
- the normative documents under `docs/`;
- `docs/CURRENT-STATE.md`;
- `docs/DEVELOPMENT-ROADMAP.md`;
- source code, migrations, workflows or tests;
- trusted-main production evidence.

The repository, not a previous chat, is the durable project memory.

Any snapshot recorded below is only the last known checkpoint. A new session must revalidate live GitHub before trusting it.

If this file conflicts with live `main`, `AGENTS.md`, a focused normative owner document, `CURRENT-STATE.md`, `DEVELOPMENT-ROADMAP.md` or verified production evidence, preserve the safest behavior, label the conflict, reconcile the authoritative documentation, and do not silently continue from this file.

Never expose secrets, credentials, private supplier URLs, provider tokens or private tenant evidence while auditing or documenting the project.

---

# 1. HARD SESSION RULE — ONE CONVERSATION = ONE SUBMILESTONE

The development protocol is intentionally:

```text
one conversation
→ load full project truth
→ execute exactly one officially approved submilestone
→ reach the highest honestly proven evidence level
→ if Production Green, close documentation and continuity
→ identify the next approved submilestone
→ STOP
```

A session may perform prerequisite diagnosis or documentation reconciliation needed to safely begin the selected submilestone, but it must not execute feature scope from the following submilestone.

When the selected submilestone reaches **PRODUCTION GREEN**, the AI must not continue implementing the next submilestone in the same conversation even if time/context remains.

The next conversation must start from this file again.

Do not invent, rename, reorder, merge or split submilestones outside the roadmap/decomposition protocol defined by `docs/DEVELOPMENT-CONTINUITY.md`.

## 1.1 Explicit owner-authorized continuous campaign exception

The default above remains normative. An owner may make a narrower, conversation-specific exception by explicitly naming an ordered campaign boundary. That exception changes only when the conversation stops; it does not combine implementation scope or relax any slice gate.

The owner-authorized continuous campaign begun on 2026-08-30 remains a conversation-scoped exception. It originally targeted M7D10→M11 and was later reordered by owner decisions: M9 work moved forward, then the first-real-merchant Portal Beta campaign PB0→PB12 became the active temporary execution order. None of these decisions silently complete M7D11, activate M7E, complete M8, or close paused M9B.

Every slice still requires its own live revalidation, branch, bounded PR, CI, exact-head merge, trusted-main proof and applicable production canary. M8 and later undecomposed macro milestones still require formal decomposition where needed. The PB campaign is owned by `docs/PORTAL-BETA-EXECUTION.md` and defaults back to paused M9B after PB12 unless the owner makes another explicit sequencing decision.

This authorization is not transferable to a future conversation without fresh owner context and live revalidation.

---

# 2. MANDATORY STARTUP PROTOCOL — NO CODE CHANGES BEFORE THIS IS COMPLETE

A new AI must perform the following sequence before creating a branch or editing code.

## 2.1 Revalidate live GitHub

Use the connected GitHub repository and inspect the live state of `lucasvenancio0110/catalog-engine`.

At minimum:

1. read the current `main` HEAD;
2. record exact SHA, parent, author/date and commit message;
3. inspect the latest commits;
4. identify the latest merged PR and its exact merge SHA;
5. list open PRs;
6. inspect relevant active branches and distinguish active work from stale historical branches;
7. inspect commit statuses/checks for the current HEAD;
8. inspect applicable GitHub Actions runs, deploys, privileged canaries, retained diagnostics and cleanups;
9. open the first real failing job/log if anything applicable is red;
10. distinguish secret-free PR validation from trusted-main production proof;
11. distinguish default-catalog automation from tenant Intelligent Sync;
12. verify production activation flags/configuration when relevant without printing secret values.

Do not assume any repository HEAD recorded later in this file is still current. Updating this file itself creates a newer documentation-only commit, and default-catalog automation may also advance `main`; production implementation checkpoints therefore remain separate from later documentation/data capture points.

Immediately before creating a branch, revalidate `main` again because automation may advance it during the audit.

## 2.2 Read repository governing files in full

Read **integrally**, not from snippets only:

1. `START-HERE-AI.md` — this file;
2. `AGENTS.md`;
3. `README.md`;
4. every root handoff/continuity Markdown file present in the repository;
5. `docs/DOCUMENT-GOVERNANCE.md`;
6. `docs/DOCUMENT-MAP.md`;
7. `docs/DEVELOPMENT-CONTINUITY.md`;
8. `docs/CURRENT-STATE.md`;
9. `docs/DEVELOPMENT-ROADMAP.md`.

While PB0→PB12 is active, also read `docs/PORTAL-BETA-EXECUTION.md` before selecting or implementing the next PB slice.

## 2.3 Read **ALL Markdown files under `docs/`**

This is mandatory for every new submilestone conversation.

Do not rely on a remembered inventory or only the documents that appear relevant.

Required procedure:

1. recursively list the current `docs/` tree from live `main`;
2. enumerate every `*.md` file currently present;
3. record the total count;
4. read every one of those Markdown files integrally;
5. include newly added files that did not exist in the previous checkpoint;
6. classify each document as normative/current/historical/closure/diagnostic/overview according to its own metadata and governance;
7. do not let a historical handoff/closure override current normative documents or live production truth.

For detailed reconstruction of how the repository reached the post-PB5 state, `docs/M7-TO-PB5-EXECUTION-LEDGER-2026-09-05.md` is the historical save-game. It is not a live authority.

Do not trust any old document-count number in a future session; recount live.

## 2.4 Inspect implementation for the intended slice

After the complete document read, inspect the live code relevant to the intended submilestone, including as applicable:

- source modules;
- Worker entrypoints;
- tenant/control-plane orchestration;
- migrations;
- `wrangler.jsonc` and Worker configs;
- Queue/runtime bindings;
- GitHub Actions workflows;
- scripts used by production canaries;
- unit/integration/regression tests;
- deployment ownership/path filters;
- exact prior implementation from the latest related PR.

Do not implement from documentation alone when current code can invalidate the recorded conclusion.

## 2.5 Reconstruct the project before acting

Before coding, the AI must be able to state concisely and correctly:

- what Catalog Engine is as a product;
- the recurring B2B SaaS business model;
- the account → entitlement → store/tenant relationship;
- control-plane vs isolated tenant data-plane responsibilities;
- Workers for Platforms / per-tenant D1 runtime model;
- Provider Engine boundary and Yupoo launch role;
- CEI Core / Knowledge Pack boundary;
- initial Queue import path;
- publication/custom-domain boundary;
- current Intelligent Sync safety model;
- current milestone and last Production Green slice;
- exact next approved slice;
- the next slice's goal, invariants, non-goals, rollback and proof requirements;
- known documentation/code/production contradictions.

If the AI cannot explain those boundaries, it has not finished startup.

---

# 3. AUTHORITY ORDER

Interpret project truth using the governance already defined in the repository.

Operationally, use this order:

1. safety/security/contribution rules in `AGENTS.md`;
2. `docs/DOCUMENT-GOVERNANCE.md`;
3. the focused owner document identified by `docs/DOCUMENT-MAP.md`;
4. narrower subsystem contracts;
5. live code/migrations/workflows/tests and current GitHub evidence;
6. `docs/CURRENT-STATE.md` for mutable implementation/production truth;
7. `docs/DEVELOPMENT-ROADMAP.md` for approved execution order/status;
8. closure documents as historical production evidence;
9. `docs/M7-TO-PB5-EXECUTION-LEDGER-2026-09-05.md` and other historical reconstruction/handoffs;
10. the snapshot section of this file as a convenience only.

When these disagree, do not choose the most convenient source. Reconcile the conflict according to `DEVELOPMENT-CONTINUITY.md` before unsafe advancement.

---

# 4. EVIDENCE VOCABULARY — USE THE REPOSITORY'S EXACT LABELS

Use these labels exactly when reporting state:

- **CONFIRMADO NO CÓDIGO**
- **CONFIRMADO NO GITHUB**
- **COMPROVADO EM PRODUÇÃO**
- **DOCUMENTADO, MAS NÃO COMPROVADO**
- **HISTÓRICO**
- **HIPÓTESE**
- **PENDENTE**
- **DECISÃO DE PRODUTO**

For roadmap slice state use:

- **PROPOSED**
- **PLANNED**
- **IN PROGRESS**
- **CODE GREEN**
- **PRODUCTION GREEN**
- **BLOCKED**
- **DECISION REQUIRED**
- **HISTORICAL**

A skipped privileged job, a preview deploy, a secret-free PR check or missing tool response is never production proof.

---

# 5. BEFORE IMPLEMENTATION — SELECT ONE CLAIM ONLY

After live revalidation and complete reading:

1. identify the exact active milestone;
2. identify the exact next **approved** submilestone from the roadmap/active sequencing contract;
3. verify no open PR already owns it;
4. verify prerequisite Production Green/decision gates actually exist;
5. state the bounded outcome;
6. state explicit non-goals;
7. state owner documents;
8. state expected code/migration/workflow surfaces;
9. state required tests;
10. state required production proof;
11. state rollback/fail-safe behavior;
12. revalidate `main` immediately before branch creation.

If documentation trails already-proven production, reconcile that state first. A documentation correction may be a prerequisite PR; it does not authorize feature scope from a later submilestone.

Do not broaden a submilestone because another improvement is nearby.

---

# 6. IMPLEMENTATION / PR PROTOCOL

For the selected submilestone:

1. create a fresh small branch from the exact current `main`;
2. implement one bounded claim;
3. update code + tests + owner docs together when behavior changes;
4. keep destructive/global activation disabled until its explicit activation slice;
5. preserve Last Known Good and fail closed across uncertainty;
6. do not weaken a verification gate simply to make CI/canary green;
7. run all required local/CI quality gates from `AGENTS.md` plus slice-specific gates;
8. open a PR describing scope, invariants, risks, migration, rollback, evidence and non-goals;
9. inspect every check;
10. fix the first real root cause of failures;
11. integrate latest `main` as required without discarding unrelated automated catalog changes;
12. merge only the exact tested head SHA;
13. never treat the PR merge itself as Production Green when privileged proof is required.

PR validation must remain secret-free unless an explicitly trusted workflow is designed otherwise by existing governance.

---

# 7. PRODUCTION GREEN GATE

A slice may be called **PRODUCTION GREEN** only when every proof applicable to that slice is satisfied on the exact trusted-main implementation SHA.

Typical requirements include:

- merged exact implementation SHA identified;
- all required quality checks green;
- trusted-main application deployment green when applicable;
- Queue/consumer/runtime activation green when applicable;
- schema/fleet canary green when applicable;
- slice-specific privileged production canary green;
- regression canaries for previously proven paths preserved when applicable;
- activation flags remain at the required boundary;
- Queue/DLQ state clean or explicitly explained;
- no manual Queue injection when the production contract requires scheduler-owned proof;
- failed fixtures/evidence retained until diagnosis;
- cleanup only after a newer complete proof passes and only against exact audited identities;
- no secret/private supplier evidence leaked into logs/docs/statuses;
- `CURRENT-STATE.md`, roadmap and owner docs eventually reconciled to the evidence level actually proven.

If exact production evidence is missing, stop at **CODE GREEN** or the appropriate lower state.

---

# 8. MANDATORY END-OF-SUBMILESTONE / SAVE-GAME PROTOCOL

After the selected submilestone reaches the highest supported evidence level, perform closure before ending the conversation.

For **PRODUCTION GREEN**, record and verify at minimum:

```text
[ ] exact final production implementation SHA
[ ] implementation PR number/title
[ ] required PR checks green
[ ] trusted-main deploy run(s)
[ ] privileged canary run(s)/job(s)
[ ] regression statuses that must stay green
[ ] cleanup/retained evidence outcome
[ ] schema/capability boundary if changed
[ ] production activation flags/config boundary
[ ] CURRENT-STATE.md updated
[ ] DEVELOPMENT-ROADMAP.md updated when its status/order changed
[ ] focused owner docs updated when their contract changed
[ ] focused closure document created/updated when project pattern requires it
[ ] START-HERE-AI.md snapshot updated after material production closure
[ ] exact next approved submilestone identified
[ ] explicit list of what was NOT implemented
[ ] no unauthorized work from the next submilestone started
```

Important sequencing:

- do not fabricate future canary IDs in a pre-production PR;
- first obtain the trusted-main production proof;
- then close documentary state to the exact proven level;
- record separately the production implementation SHA and later documentation/default-catalog capture points when those differ;
- revalidate `main` after closure.

The repository should contain enough truth that the next conversation does not need the previous chat transcript.

---

# 9. UPDATE THIS FILE AT EVERY MATERIAL PRODUCTION CLOSURE

Keep this file as a bootloader, not a duplicate of every detailed closure.

It should contain:

- startup protocol;
- authority/evidence rules;
- last known production checkpoint;
- current campaign/milestone boundary;
- next approved slice;
- activation/safety boundary;
- pointers to current/historical owner evidence.

Do **not** attempt to make this file contain its own final repository HEAD as eternal truth. Updating this file creates a new commit. Live HEAD is always discovered at startup.

---

# 10. LAST KNOWN CHECKPOINT — MUST BE REVALIDATED LIVE

Captured against live GitHub on **2026-09-06 (America/Sao_Paulo)**.

## Repository / capture semantics

At the pre-documentation capture:

```text
repository = lucasvenancio0110/catalog-engine
branch = main
latest PB7 runtime implementation = ccd69520607329acf764d3d5d29ddaaf29d0aa98
trusted application deploy = 34038969797
PB7 trusted production proof SHA = 705d7b91ed295cc9a6d62e61fa2144ec56276152
PB7 real-merchant progress proof = 34039346993
```

The documentation closure that updates this file creates a later documentation-only SHA. That later SHA does not replace the exact PB7 runtime implementation/proof points recorded above.

## Current proven milestone state at this capture

```text
M7A–M7D10 = PRODUCTION GREEN within their bounded contracts
M7D11 = PLANNED
M7E = DECISION REQUIRED / recurring tenant sync remains OFF

M9A = PRODUCTION GREEN
M9B = IN PROGRESS — PAUSED by the first-real-merchant PB campaign
M9C/M9D = PLANNED

PB0 = GOVERNANCE GREEN / COMPLETE
PB1 = PRODUCTION GREEN
PB2 = PRODUCTION GREEN
PB3 = PRODUCTION GREEN
PB4 = PRODUCTION GREEN
PB5 = PRODUCTION GREEN
PB6 = PRODUCTION GREEN
PB7 = PRODUCTION GREEN
PB8 = PLANNED — NEXT
PB9–PB12 = PLANNED
```

Detailed evidence is recorded in:

- `docs/M7-TO-PB5-EXECUTION-LEDGER-2026-09-05.md` — historical reconstruction only;
- `docs/PB6-CLOSURE-2026-09-06.md` — final PB6 Production Green evidence;
- `docs/PB7-CLOSURE-2026-09-06.md` — final PB7 Production Green evidence;
- current truth in `docs/CURRENT-STATE.md`.

## Current tenant data-plane / sync boundary

```text
TENANT_DATA_PLANE_SCHEMA_VERSION = 8
migration command capability = v4
TENANT_IMPORT_AUTOMATION_ENABLED = 1
TENANT_SYNC_AUTOMATION_ENABLED = 0
TENANT_SYNC_ACTIVE_COHORT = empty
TENANT_SYNC_MAX_JOBS_PER_TICK = 1
```

Automatic initial import is active. Recurring tenant Intelligent Sync is not.

## First real merchant proof already achieved

A real beta merchant has successfully exercised production through PB7:

```text
OIDC signup/login
-> audited server-side beta entitlement
-> real isolated store creation (CROCCODILOS)
-> persisted branding/logo through private R2
-> persisted private Yupoo source connection
-> durable full-connected-source import decision with authority=merchant
-> trusted isolated D1/User Worker provisioning and schema v8 readiness
-> scheduler-owned initial import
-> merchant-safe resumable progress projected from durable state
```

The final PB7 proof read CROCCODILOS twice from durable production state and observed `stage=importing`, `status=running`, 6104 items discovered/queued, bounded 8-second polling and no private-identifier exposure. That proves PB7 progress/re-entry behavior; it is not proof that the entire PB8 real-import/CEI/verification journey is complete.

Do not store or expose the merchant's private Yupoo URL, email, token, IdP subject, private provider locator, D1 UUID or Worker identifier in documentation/logs.

---

# 11. NEXT APPROVED SUBMILESTONE

Subject to live revalidation, the next active PB slice is:

## PB8 — Real Tenant Import

Customer outcome:

> The first real beta store receives its independently imported and organized catalog through the actual isolated tenant pipeline.

PB8 begins from CROCCODILOS with physical isolated D1/User Worker ready, schema v8 ready, durable merchant import authority already consumed and an automatic initial import already running.

Required proof chain:

```text
real tenant
-> connected private source
-> isolated data plane/runtime
-> schema v8
-> scheduler/Queue-owned initial scan/details/finalize
-> CEI/classification
-> verification
-> verified catalog readiness
```

Required boundaries:

- no default tenant reuse or fallback;
- no manual Queue injection as the normal proof path;
- prove tenant-private product/catalog counts and isolation;
- prove CEI/classifier/intelligence completion under current provider-neutral contracts;
- prove verification reaches success with zero structural blockers required for readiness;
- preserve merchant overrides and LKG/publication boundaries;
- understand Queue and DLQ health rather than hiding residue;
- preserve private supplier/source/runtime evidence;
- keep recurring Intelligent Sync disabled;
- do not require public custom-domain publication for PB8.

PB8 must not activate M7E, recurring sync, public custom-domain publication or PB9 private-preview behavior.

---

# 12. ACTIVE OWNER-AUTHORIZED ORDER

While the first-real-merchant campaign remains active, use the approved sequence from `PORTAL-BETA-EXECUTION.md`:

```text
PB8 — Real Tenant Import
↓
PB9 — Private Preview
↓
PB10 — Merchant Home
↓
PB11 — Beta E2E
↓
PB12 — Production Proof / BETA GREEN
```

After PB12, default return point is the paused **M9B — Product Discovery and Merchandising**, unless the owner explicitly changes sequencing.

Separately:

```text
M7D11 remains PLANNED
M7E remains DECISION REQUIRED
M8 remains incomplete/unproven
M9B remains incomplete/paused
```

Do not invent a new ordering from the historical continuous-campaign text.

---

# 13. PERMANENT SAFETY REMINDERS

Never regress these principles:

- partial scan never means delete;
- Last Known Good remains serving authority until safe verified promotion;
- supplier taxonomy is evidence, not public merchandising truth;
- private supplier URLs/raw IDs/evidence remain private;
- merchant overrides are durable tenant business truth;
- one tenant must never select/read/mutate another tenant's data plane;
- the default compatibility tenant is never a fallback for a real merchant tenant;
- application deployment and commercial catalog publication are separate responsibilities;
- production mutation proof uses trusted-main exact-SHA paths;
- ordinary PR validation remains secret-free;
- never purge global Queues/DLQs to make evidence look clean;
- preserve failed fixtures/evidence until diagnosis;
- no manual Queue injection when the contract requires scheduler-owned proof;
- do not weaken gates after a production canary reveals a real defect;
- no recurring tenant-sync activation before explicit M7E approval;
- distinguish default-catalog bot commits from tenant Intelligent Sync;
- customer-facing progress uses durable real state, never fake percentages;
- customer UI must not expose tenant/D1/Worker/namespace/private-locator internals.

---

# 14. REQUIRED FINAL RESPONSE OF EVERY SUBMILESTONE CONVERSATION

When stopping, give the user a concise handoff summary containing:

1. selected submilestone;
2. final status (`CODE GREEN`, `PRODUCTION GREEN`, etc.);
3. exact implementation SHA;
4. PR number;
5. trusted-main deploy/canary evidence;
6. any production defect found and how it was fixed;
7. activation flags/boundaries preserved;
8. documents updated;
9. exact next approved submilestone;
10. confirmation that unauthorized next-slice work was not started.

---

# FINAL BOOT RULE

A new AI must never ask the user to restate the project if GitHub and this protocol can resolve it.

The required behavior is:

```text
READ THIS FILE
→ REVALIDATE LIVE GITHUB
→ READ AGENTS + README + HANDOFFS
→ ENUMERATE AND READ ALL docs/*.md
→ INSPECT LIVE CODE/WORKFLOWS/TESTS
→ RECONCILE CONTRADICTIONS
→ IDENTIFY EXACT NEXT APPROVED SUBMILESTONE
→ EXECUTE ONLY THE AUTHORIZED SLICE/CAMPAIGN STEP
→ PROVE IT TO THE REQUIRED LEVEL
→ UPDATE CURRENT STATE / ROADMAP / CLOSURE / THIS FILE AS APPLICABLE
→ STOP AT THE AUTHORIZED BOUNDARY
```

The project must remain continuable without relying on memory from any previous chat.