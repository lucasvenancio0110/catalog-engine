# CATALOG ENGINE — AI START HERE / CONTINUITY PROTOCOL

Status: **Operational entrypoint for every new AI/contributor session**  
Repository: `lucasvenancio0110/catalog-engine`  
Default branch: `main`  
Purpose: let a brand-new AI understand the entire Catalog Engine, revalidate live truth, execute exactly one approved submilestone, prove it correctly, update the repository as the durable memory, and stop with a clean handoff for the next conversation.

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

Do not assume any repository HEAD recorded later in this file is still current. In particular, updating this file itself creates a newer documentation-only commit, so the continuity snapshot records **production implementation checkpoints separately from repository documentation capture points**.

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

Baseline note only: on production implementation SHA `725854afc408bb6177aa071e2797051369c4040c`, the `docs/` folder contained 40 Markdown files. **Do not trust the number 40 in a future session; recount live.**

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
9. root handoffs as historical transfer context;
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
2. identify the exact next **approved** submilestone from the roadmap;
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
11. rebase/integrate latest `main` as required without discarding unrelated automated changes;
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
[ ] DEVELOPMENT-ROADMAP.md updated
[ ] focused owner docs updated
[ ] focused closure document created/updated when project pattern requires it
[ ] START-HERE-AI.md snapshot updated
[ ] exact next approved submilestone identified
[ ] explicit list of what was NOT implemented
[ ] no work from the next submilestone started
```

Important sequencing:

- do not fabricate future canary IDs in a pre-production PR;
- first obtain the trusted-main production proof;
- then close the documentary state to the exact proven level using the repository's established closure pattern;
- record separately the production implementation SHA and the later documentation-only capture point when those differ;
- revalidate `main` after closure;
- then stop.

The repository should contain enough truth that the next conversation does not need the previous chat transcript.

---

# 9. UPDATE THIS FILE AT EVERY MATERIAL PRODUCTION CLOSURE

At the end of each Production Green submilestone, update the snapshot below.

Do not turn this file into a duplicate of all 40+ docs. Keep it as:

- startup protocol;
- live revalidation checklist;
- last known production checkpoint;
- known conflict/debt warnings that affect continuation;
- next approved slice;
- activation/safety boundary;
- links to the true owner documents.

If the next milestone has not yet been decomposed/approved, record **DECISION REQUIRED / decomposition required** instead of inventing sub-slices.

Do **not** attempt to make this file contain its own final repository HEAD as an eternal truth. Updating the file creates a new commit. Record the last production implementation SHA and, when useful, a documentation capture point separately. Live HEAD is always discovered at startup.

---

# 10. LAST KNOWN CHECKPOINT — MUST BE REVALIDATED LIVE

Captured against live GitHub on **2026-08-30 (America/Sao_Paulo)**.

## Repository / capture semantics

```text
repository = lucasvenancio0110/catalog-engine
branch = main
production implementation checkpoint = 9214094197b010f46f7bf5144e7dbb445afa90ef
pre-closure live repository capture point = f03a30ca896c8039ec7be9fc80358f3b04b84f73
```

The two SHAs intentionally mean different things:

- `92140941...` is the final **M7D9 trusted-main production implementation/proof SHA**;
- `f03a30ca...` is the later live-main capture point produced by the distinct transitional default-catalog sync and modifies only the sanitized compatibility snapshot `data/catalog.json` relative to the M7D9 proof SHA. It is preserved by the documentation closure and does not replace the production implementation identity.

Neither value is permission to skip live GitHub revalidation.

M7D9 primary feature implementation entered through PR `#157 — m7d9: remove repeatedly missing products safely`; production-proof fixes continued through PRs `#158–#164`, with final proof SHA `9214094197b010f46f7bf5144e7dbb445afa90ef`.

## Exact known trusted-main status on the M7D9 production implementation SHA

The exact SHA `9214094197b010f46f7bf5144e7dbb445afa90ef` completed **SUCCESS** for:

```text
catalog-engine/application-deploy
  run 33262375277

catalog-engine/queue-consumer-activation
  run 33262420873

catalog-engine/tenant-data-plane-fleet-canary
  run 33262420846 / job 99126693083

catalog-engine/tenant-incremental-affected-detail-canary
catalog-engine/tenant-incremental-cei-candidate-canary
catalog-engine/tenant-incremental-candidate-verification-canary
catalog-engine/tenant-incremental-promotion-authority-canary
  cumulative run 33262420886 / job 99126532164

catalog-engine/tenant-incremental-finalization-canary
  run 33262420896 / job 99126532227

catalog-engine/tenant-incremental-safe-removal-canary
  run 33262420879 / job 99126532113

automatic initial-import + CEI regression
  run 33262420865 / job 99127336932
```

This is a last-known checkpoint only. Requery statuses/runs before using it as current truth.

## M7 known state at this checkpoint

Known production evidence supports:

```text
M7A  = PRODUCTION GREEN
M7B  = PRODUCTION GREEN — foundation disabled
M7C1 = PRODUCTION GREEN
M7C2 = PRODUCTION GREEN — read-only foundation
M7C3 = PRODUCTION GREEN
M7C4 = PRODUCTION GREEN
M7D1 = PRODUCTION GREEN
M7D2 = PRODUCTION GREEN
M7D3 = PRODUCTION GREEN
M7D4 = PRODUCTION GREEN
M7D5 = PRODUCTION GREEN
M7D6 = PRODUCTION GREEN
M7D7 = PRODUCTION GREEN
M7D8 = PRODUCTION GREEN
M7D9 = PRODUCTION GREEN
M7D10 = PLANNED — NEXT APPROVED
M7D11 = PLANNED / scope decision before customer UI
M7E = DECISION REQUIRED / activation-only
```

## M7D7 documentation reconciliation

M7D7 closure reconciliation was completed by PR `#153` at documentation-only SHA `f01253dd4b7c5855de0cbfb222a128cab9c48f1b`, and this follow-up reconciles the remaining normative/bootloader wording. Live revalidation still outranks this snapshot.

Additional known documentation debt discovered in the full-doc audit:

- `docs/TENANT-IMPORT-DETAILS.md` contains stale pre-M5 Queue activation wording;
- `docs/TENANT-IMPORT-SCAN.md` contains stale pre-M5 Queue activation wording;
- `docs/DESIGN-SYSTEM.md` contains a stale Fuse.js-installed/candidate sentence, while M3 records that Fuse.js was removed.

These debts do not authorize unrelated runtime changes. Fix them in bounded documentation scope when appropriate.

## Current tenant data-plane boundary

Last known active code target:

```text
TENANT_DATA_PLANE_SCHEMA_VERSION = 8
migration command capability = v4
historical compatibility = v3 -> schema7 remains accepted
```

Schema v8 adds scoped membership/miss authority, immutable removal policy and merchant-override retention on top of the v7 serving-authority CAS state.

## Critical Intelligent Sync activation boundary

Until M7E is explicitly approved and proven:

```text
TENANT_SYNC_AUTOMATION_ENABLED = 0
TENANT_SYNC_ACTIVE_COHORT = empty
recurring Intelligent Sync = disabled
```

Do not enable recurring sync in M7D10 or M7D11; M7D8/M7D9 are already closed with the scheduler still disabled.

Do not create a real cohort merely to make a canary easier.

The scheduled legacy/default-catalog `sync-yupoo-incremental.yml` workflow is a distinct transitional automation and may advance the sanitized `data/catalog.json` snapshot even while tenant Intelligent Sync remains disabled. Preserve and audit those bot commits separately; do not misclassify them as M7 tenant-cohort activation.

---

# 11. NEXT APPROVED SUBMILESTONE

Subject to live revalidation, the next roadmap slice is:

## M7D10 — Recovery, Replay and Operational Observability

Commercial outcome:

> Ordinary failures recover without daily owner intervention while exceptions remain diagnosable.

Normative owner:

- `docs/TENANT-SYNC.md`

Required proof covers duplicate Queue delivery, expired lease/reclaim, crash between listing chunks, affected-detail failure, crash before/after verify, crash before/during/after authority switch, post-promotion redelivery, partial-item error, bounded retry exhaustion, DLQ/replay ownership and unrelated-tenant continuity. Errors must be phase-aware and safe, unresolved failed work must block conflicts, and LKG/evidence must remain preserved until exact audited cleanup.

M7D10 must not absorb M7D11 customer change/review feed scope or M7E activation. Recurring tenant Intelligent Sync remains disabled and no real activation cohort is created in M7D10.

---

# 12. M7 REMAINING ORDER — DO NOT SKIP

Subject to live roadmap revalidation:

```text
M7D10 — Recovery, Replay and Operational Observability
↓
M7D11 — Safe Change and Review Feed
↓
M7E — Deliberate Activation (decision + activation only)
↓
M7 COMPLETE
```

After M7, do not invent M8A/M8B names. Follow the decomposition protocol before implementing M8 if the macro milestone needs multiple slices.

---

# 13. PERMANENT SAFETY REMINDERS

Never regress these principles:

- partial scan never means delete;
- supplier taxonomy is evidence, not public merchandising truth;
- private supplier URLs/raw IDs/evidence remain private;
- merchant overrides are durable tenant business truth;
- one tenant must never select/read/mutate another tenant's data plane;
- application deployment and commercial catalog publication are separate responsibilities;
- production mutation proof uses trusted-main exact-SHA paths;
- ordinary PR validation remains secret-free;
- never purge global Queues/DLQs to make evidence look clean;
- preserve failed fixtures/evidence until diagnosis;
- no manual Queue injection when the contract requires scheduler-owned proof;
- do not weaken gates after a production canary reveals a real defect;
- no recurring-sync activation before M7E;
- one conversation executes at most one approved submilestone.

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
10. confirmation that the next submilestone was **not started**.

Then stop. The next conversation begins from this file again.

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
→ EXECUTE ONLY THAT SUBMILESTONE
→ PROVE IT TO THE REQUIRED LEVEL
→ UPDATE CURRENT STATE / ROADMAP / CLOSURE / THIS FILE
→ STOP
```

The project must remain continuable without relying on memory from any previous chat.
