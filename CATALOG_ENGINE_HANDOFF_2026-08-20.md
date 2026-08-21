# CATALOG ENGINE — HANDOFF CANÔNICO DE DESENVOLVIMENTO

**Snapshot técnico:** 2026-08-21 após fechamento production-proven do M6  
**Repositório:** `lucasvenancio0110/catalog-engine`  
**Stack:** Vite + JavaScript ES Modules + Cloudflare Workers + D1 + Workers for Platforms + Cloudflare Queues  
**Node:** >= 22  
**Package:** `0.9.0`

> **REGRA DE CONTINUIDADE:** este arquivo é a fonte canônica de retomada. Antes de qualquer write/merge/deploy/mutação Cloudflare, revalidar `main`, PRs, Actions e o estado real da infraestrutura. Ler `AGENTS.md`, `docs/DOCUMENT-GOVERNANCE.md`, `docs/DOCUMENT-MAP.md`, `docs/CURRENT-STATE.md` e o milestone ativo do roadmap.

---

# 0. ESTADO EXECUTIVO

Catalog Engine é uma plataforma SaaS B2B multi-tenant white-label que transforma fontes privadas de catálogo em vitrines profissionais independentes da origem do fornecedor.

**Yupoo é provider de lançamento, não architecture boundary.**  
**Sports é Knowledge Pack de lançamento, não semântica do CEI Core.**

Milestones relevantes:

| Milestone | Estado |
|---|---|
| M1 — production safety | PARCIAL |
| M2 — code/data deployment separation | CONCLUÍDO |
| M3 — Design Foundation | CONCLUÍDO |
| M4 — Provider Engine | CONCLUÍDO |
| M5 — automatic tenant Queue import | **CONCLUÍDO / PRODUCTION-PROVEN** |
| M6 — CEI Core + Sports Knowledge Pack v1 | **CONCLUÍDO / PRODUCTION-PROVEN** |
| M7 — Intelligent Sync v2 | **ATIVO / PRÓXIMO DESENVOLVIMENTO** |

---

# 1. PONTO EXATO DE RETOMADA

Final production code commit do M6:

`53795ab25600d3c7f44034e610b6f54580fcc9d0`

PR final:

`#90 — m6e: route CEI classification through domain runtimes`

Application deploy final:

- run `32501638102`;
- conclusion **SUCCESS**;
- Worker version `ea387313-a952-4be6-ad27-bc4734cba6ad`;
- automation `1`;
- cron `*/5 * * * *`;
- D1 migrations: none pending;
- scan/detail producers verified;
- existing catalog smoke passed.

Automatic production canary final:

- run `32501722230`;
- job `96832706262`;
- conclusion **SUCCESS**;
- checkout trusted `main` = `53795ab25600d3c7f44034e610b6f54580fcc9d0`.

Canary evidence:

```text
automaticTenantImportCanaryPassed = true
ceiPipelineVerified = true
automationEnabled = true
manualQueueMessagesProduced = false
schedulerDiscovered = true
schedulerAttemptCount = 1
discovered = 1
completed = 1
deferred = 0
published = 1
catalog products = 1
catalog media = 2
public leaks = 0
schemaVersion = 4
classifierVersion = 3
classifierKey = professional-v3
intelligenceContractVersion = 1
classified = 1
intelligence = 1
reviewRequired = 0
researchRequired = 1
conflicts = 0
privateStateLeaks = 0
importStepStatus = success
classifyStepStatus = success
verificationStepStatus = success
verificationFindings = 0
provisioning advanced to domain
defaultCatalogCountUnchanged = true
queueBacklogsClean = true
```

Final quality proof:

```text
75 / 75 test files passed
355 / 355 tests passed
lint passed
dependency policy passed
```

**M6 está oficialmente fechado. O próximo desenvolvimento deve partir do M7.**

Historical closure evidence:

`docs/M6-CLOSURE-2026-08-21.md`

---

# 2. M6 FINAL ARCHITECTURE

## M6A — Normalized Evidence v1

PR `#77`  
Merge `ad35af43f5709d340c69cf2f5b32e9408bfb1b1a`

CEI recebe Evidence source-neutral, não objetos Yupoo.

## M6B — CEI-native runtime + Sports Pack v1

PR `#79`  
Merge `5f8b0e09b118b69087a45bce70f4dcea53f731dd`

Knowledge Pack genérico versionado + Sports v1.

## M6C — Confidence / conflicts / season

PR `#80`  
Merge `9b14cb2f2f1face251f348f9be8ca20cb4f66b6b`

Production:

- deploy `32431795992` SUCCESS;
- canary `32431848821` SUCCESS.

Entregou domain confidence, field confidence, semantic conflicts, season confiável e override resolution.

## M6D1 — CEI state + schema v4 + verification

PRs `#85` e hotfix `#86`.

Final M6D1 merge:

`188648ba747c18907207b83717756ecbdcf9a64d`

Production:

- deploy `32451317260` SUCCESS;
- canary `32451374479` SUCCESS.

Entregou:

- classifier `professional-v3` / version `3`;
- tenant schema v4;
- `catalog_product_intelligence_state`;
- generic claims;
- knowledge states;
- automatic/effective state separation;
- durable override semantics;
- structural verification.

Important production lesson: the first M6D1 canary timed out because classify/verify incorrectly depended on account-level Cloudflare credentials in Worker runtime. PR #86 fixed the hot path to use existing isolated `TENANT_DISPATCH`. Never regress by adding account-level API credentials to the main Worker merely to operate tenant D1.

## M6D2 — Knowledge-Pack-driven merchandising

PR `#87` + diagnostic PR `#88` + D1 coercion fix PR `#89`.

Final M6D2 commit before M6E:

`901c884eb48b4bbcaba6f134fac977b03c04f6e4`

Production:

- deploy `32493858567` SUCCESS;
- canary `32493941506` SUCCESS.

Entregou:

- `CEI_MERCHANDISING_CONTRACT_VERSION=1`;
- merchandising dentro do Knowledge Pack;
- Sports navigation ownership pelo Sports Pack;
- tenant merchandising persistence;
- public-safe navigation;
- verification de merchandising;
- fake Wheels pack proving non-Sports Core.

Important production lesson: verification initially failed with `merchandising_metadata_invalid`. Root cause was SQLite/D1 type coercion between JSON INTEGER and stringified parameter. PR #89 added explicit integer coercion + real SQLite regression. Verification was not weakened.

## M6E — Domain Runtime / Router

PR `#90`  
Final production commit `53795ab25600d3c7f44034e610b6f54580fcc9d0`

Entregou:

- `CEI_DOMAIN_RUNTIME_CONTRACT_VERSION=1`;
- generic runtime validation;
- deterministic Domain Router;
- `SPORTS_DOMAIN_RUNTIME`;
- production registry exatamente `sports-v1`;
- top-level classifier sem direct Sports resolver/claims imports;
- fake Wheels/Automotive runtime proving generic Core;
- provenance-neutral routing;
- duplicate/mismatched runtime fail-closed;
- downstream-safe classification shape validation.

Não ativar Automotive/Fashion/Dental em produção sem milestone/Knowledge Pack deliberado.

---

# 3. CEI INVARIANTS

Normative owner: `docs/CEI.md`.

Core flow:

```text
OBSERVE
→ NORMALIZE
→ CONTEXT / DOMAIN
→ MEASURE KNOWLEDGE
→ DETECT GAPS
→ RESEARCH IF NEEDED
→ VALIDATE EVIDENCE
→ LEARN
→ CLASSIFY
→ VERIFY
→ MERCHANDISE
→ REMEMBER
```

Knowledge states:

```text
VERIFIED
KNOWN
UNCERTAIN
UNKNOWN
CONFLICT
STALE
```

Critical rules:

- CEI must prove knowledge before asserting knowledge;
- Core does not semantically depend on Sports;
- source taxonomy is evidence, not public truth;
- normal operation must not require paid LLM tokens;
- low-confidence/conflicting cases become review/unknown, not confident guesses;
- tenant memory stays tenant-isolated;
- private evidence/provenance stays out of storefront output.

Business model:

```text
SOURCE INFERENCE
+
MERCHANT OVERRIDE
=
EFFECTIVE VIEW
```

---

# 4. CLOUDFLARE / TENANCY BASELINE

Main Worker:

`catalog-engine`

Entrypoint:

`worker/entry-publish.js`

Control/default D1:

- binding `CATALOG_DB`;
- database `catalog-engine-db`;
- ID `12ac414c-4aef-4668-a8f9-dc63d57d449f`.

Workers for Platforms:

- `TENANT_DISPATCH`;
- namespace `catalog-engine-production`.

Cron:

`*/5 * * * *`

Queues:

```text
catalog-engine-import-scan
catalog-engine-import-detail
catalog-engine-import-scan-dlq
catalog-engine-import-detail-dlq
```

Canonical tenant identity:

```text
tenant = t_<suffix>
User Worker = ce-<suffix>
```

Tenant hot path:

```text
scheduler / Queue consumer
→ TENANT_DISPATCH
→ Workers for Platforms
→ ce-<suffix>
→ isolated tenant CATALOG_DB
```

Known hosts:

- `catalogoengine.com`;
- `app.catalogoengine.com`;
- `edge.catalogoengine.com`;
- `origin.catalogoengine.com`;
- Workers.dev deployment host.

Do not claim this is a full Cloudflare account inventory.

---

# 5. M5 REGRESSION RULES

M5 final code:

`b917b023fde537baa0aa797d1230b7df7db5595e`

Production:

- deploy `32392783507` SUCCESS;
- auto-canary `32392875597` SUCCESS.

Never regress:

- automation is reversible `0|1`;
- OFF is valid rollback;
- pending/queued race retries;
- auto-canary runs post-deploy;
- canonical Worker is `ce-<suffix>`;
- do not create `ce-auto-*` hot-path identities;
- no global Queue purge to make canary green;
- no manual first Queue message in automatic canary;
- preserve failure evidence before cleanup.

---

# 6. CODE DEPLOY != CATALOG PUBLICATION

Application deploy:

`.github/workflows/deploy-catalog-api.yml`

Default commercial catalog publication:

`.github/workflows/publish-default-catalog.yml`

Do not recouple CSS/Worker/code deploy with replacement of catalog business data.

---

# 7. M7 — ACTIVE MILESTONE

Normative roadmap owner:

`docs/DEVELOPMENT-ROADMAP.md`

Goal:

**make recurring synchronization safe enough that supplier outages, malformed scans, partial scans or implausible complete-scan drops cannot silently destroy a healthy published catalog.**

Required M7 areas:

- per-tenant sync scheduling;
- lightweight listing comparison;
- delta detail fetch;
- `NEW / CHANGED / MOVED / RESTORED / removal` semantics;
- incomplete scan never means delete;
- repeated-miss rules where applicable;
- catastrophic-diff circuit breaker;
- suspicious-run quarantine;
- last-known-good preservation;
- idempotent retries;
- CEI reprocessing only for affected products/knowledge;
- change/review feed;
- safe state/cursor promotion only after verification.

Key M7 invariant from `AGENTS.md`:

> A partial scan may never infer deletion.

Also:

> An abnormal complete-scan volume drop must be guarded before launch; a technically complete but implausible scan must not silently remove most of a healthy catalog.

Before M7 code, re-read the synchronization union from `docs/DOCUMENT-MAP.md`, especially Provider Engine, import pipeline/queues, relevant scan/detail docs, CEI, CURRENT-STATE and deployment ownership where publication state changes.

---

# 8. M7 RECOMMENDED FIRST SLICE

Do not jump directly into a production destructive sync runner.

Recommended first slice:

**M7A — Sync Decision Contract / Catastrophic Diff Guard**

Start by making the decision model explicit and testable:

```text
previous known-good snapshot
+
current scan evidence
+
scope completeness
+
run health
→ safe delta decision
```

M7A should define/validate:

- explicit scan completeness;
- safe per-item state transitions;
- `not observed != removed`;
- scope membership detach vs global removal;
- catastrophic drop thresholds/guard inputs as versioned policy rather than scattered magic constants;
- suspicious/quarantine decision;
- last-known-good preservation;
- deterministic fixtures for normal delta, partial scan and catastrophic drop.

Do not mutate production catalog as part of the first contract-only slice unless the focused docs and tests justify it.

---

# 9. SECURITY / RELIABILITY DEBT

M1 remains partial. Open debt includes:

- branch protection / required checks;
- direct-push automation governance;
- third-party Actions/toolchain governance;
- production schema parity evidence;
- backup/rollback/recovery runbooks.

Non-blocking toolchain warning observed in final M6 runs:

- some `actions/checkout@v4` / `actions/setup-node@v4` internals target deprecated Node 20 and are being forced to Node 24.

Treat under M1/toolchain governance; it did not fail M6 quality/deploy/canary.

---

# 10. RETOMADA CHECKLIST

1. Read `AGENTS.md`.
2. Read `docs/DOCUMENT-GOVERNANCE.md`.
3. Read `docs/DOCUMENT-MAP.md`.
4. Read `docs/CURRENT-STATE.md`.
5. Revalidate `main` and Actions.
6. Treat M5 as closed unless a real regression appears.
7. Treat M6 as **CLOSED / production-proven** unless a real regression appears.
8. Read M7 in `docs/DEVELOPMENT-ROADMAP.md` and the synchronization document union.
9. Start M7 from a fresh branch off current `main` after the documentation-closure PR is merged.
10. Keep PR validation secret-free; production evidence comes from trusted-main deploy/canary workflows.

---

# 11. DO NOT CLAIM YET

- universal autonomous CEI research;
- production non-Sports Knowledge Packs;
- second production provider;
- complete Cloudflare account inventory;
- production billing;
- full storefront UX 2.0 / launch-ready browser quality;
- public-launch readiness.

Those belong to later milestones.
