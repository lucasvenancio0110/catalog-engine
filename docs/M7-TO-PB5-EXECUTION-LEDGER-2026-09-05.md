# Catalog Engine — M7 through PB5 Execution Ledger

Status: **HISTORICAL / continuity evidence**  
Captured: **2026-09-05 (America/Sao_Paulo)**  
Repository: `lucasvenancio0110/catalog-engine`  
Scope: detailed reconstruction of the execution path from M7 through M9A/M9B and the first-real-merchant Portal Beta campaign through PB5.

## Authority and intended use

This document is deliberately detailed so a future contributor can understand **how Catalog Engine reached the current state**, including production failures, hotfixes, safety decisions, proof topology and first-real-merchant acceptance evidence.

It is **not** the live source of truth and it does not override:

1. live GitHub;
2. `AGENTS.md`;
3. `DOCUMENT-GOVERNANCE.md`;
4. focused normative owner documents;
5. `CURRENT-STATE.md`;
6. `DEVELOPMENT-ROADMAP.md`;
7. `PORTAL-BETA-EXECUTION.md` while the PB campaign is active.

Use the evidence vocabulary from `DEVELOPMENT-CONTINUITY.md`. Historical closure/PR/run facts below remain useful evidence, but every new session must revalidate live GitHub before acting.

Never put customer credentials, private supplier URLs, provider tokens or raw private tenant evidence in this ledger. The real merchant's Yupoo URL and identity-provider account details are intentionally omitted.

---

# 1. Capture point and current boundary

## CONFIRMADO NO GITHUB

At this capture point:

- live branch: `main`;
- live repository HEAD: `ef975c86da66c210b970ec0a25217dd60ab4a851`;
- HEAD message: `sync supplier catalog incrementally`;
- HEAD author: `catalog-engine-bot`;
- parent: `7ee3d5460ca320da530e805f42c6e168450ce770`;
- `7ee3d546...` is the documentation closure that marked PB5 Production Green and advanced the living execution point to PB6;
- latest PB5 application/runtime implementation SHA: `5f01b679804c45246077eb292ad2648ab6b20b48`;
- open pull requests at the audit point: none.

The later `ef975c86...` bot commit is a **distinct default/compatibility-catalog data update**. It must not be confused with activation of recurring tenant Intelligent Sync.

## COMPROVADO EM PRODUÇÃO — activation boundary preserved throughout this history

```text
TENANT_IMPORT_AUTOMATION_ENABLED=1
TENANT_SYNC_AUTOMATION_ENABLED=0
TENANT_SYNC_ACTIVE_COHORT=""
TENANT_SYNC_MAX_JOBS_PER_TICK=1
```

Interpretation:

- automatic **initial tenant import** is allowed/active;
- recurring tenant **Intelligent Sync remains OFF**;
- no real tenant/source recurring cohort is authorized by the global sync path;
- M7E remains a separate owner decision and was never silently activated by M7, M9 or the PB campaign.

The historical/default tenant remains separate from all real beta tenants:

```text
tenant = t_00000000000000000001
runtime/data-plane compatibility identity = catalog-engine-default
source = primary
```

New merchant flows must never reuse or silently fall back to this tenant.

---

# 2. Executive execution ledger

## M7

| Slice | Historical outcome at this capture | Core result |
| --- | --- | --- |
| M7A — Sync Safety Decision | **PRODUCTION GREEN** | Provider-neutral run-safety decision and catastrophic-diff guard. |
| M7B — Recurring Scheduler Foundation | **PRODUCTION GREEN — foundation disabled** | Durable scheduler control plane with global activation kept OFF. |
| M7C1 — Shared Listing Delta | **PRODUCTION GREEN** | One provider-neutral delta semantic core. |
| M7C2 — Incremental Planning | **PRODUCTION GREEN — read-only foundation** | Tenant LKG + provider observation planning with no premature canonical write. |
| M7C3 — Private Staged Sync State | **PRODUCTION GREEN — listing foundation** | Private run-scoped staging while LKG remains authority. |
| M7C4 — Schema v5 Fleet Activation | **PRODUCTION GREEN** | Safe fleet migration/maintenance model and trusted deployment ownership. |
| M7D1 — Candidate State Schema v6 | **PRODUCTION GREEN** | Additive run-owned candidate tables and migration capability v2. |
| M7D2 — Controlled Enrollment Guard | **PRODUCTION GREEN** | Zero-by-default server-side recurring enrollment authority. |
| M7D3 — Incremental Dispatch / Scan-to-Stage | **PRODUCTION GREEN** | Real dispatcher/Queue scan reaches private staged candidate state. |
| M7D4 — Staged Affected Detail | **PRODUCTION GREEN** | Only affected detail/media/evidence is fetched and staged. |
| M7D5 — Affected-only CEI | **PRODUCTION GREEN** | Only changed candidate evidence enters CEI; merchant overrides preserved. |
| M7D6 — Candidate Verification | **PRODUCTION GREEN** | Private candidate composed view verified fail-closed before promotion. |
| M7D7 — Promotion Authority Primitive | **PRODUCTION GREEN** | One atomic bounded D1 serving-authority switch. |
| M7D8 — Verified Promotion / Cursor Commit | **PRODUCTION GREEN** | Control metadata commits exactly once only after durable promotion. |
| M7D9 — Repeated Miss / Safe Removal | **PRODUCTION GREEN** | Scoped misses, detach/removal, restoration and override retention. |
| M7D10 — Recovery / Replay / Observability | **PRODUCTION GREEN** | Revisions, phase leases, bounded recovery, replay and redacted operations. |
| M7D11 — Safe Change / Review Feed | **PLANNED** | Not implemented at this capture. |
| M7E — Deliberate Activation | **DECISION REQUIRED** | Recurring tenant sync remains disabled. |

## M9 / storefront pivot

| Slice | Status | Result |
| --- | --- | --- |
| M9A — Commerce Shell and URL State | **PRODUCTION GREEN** | Premium responsive shell, server search and durable URL/history state. |
| M9B — Product Discovery and Merchandising | **IN PROGRESS — PAUSED** | Many mobile/merchandising refinements merged; not closed. |
| M9C / M9D | **PLANNED** | Not started/closed as complete. |

## First real merchant Portal Beta

| Slice | Status at capture | Result |
| --- | --- | --- |
| PB0 — Live Truth + Sequencing | **COMPLETE / GOVERNANCE GREEN** | PB0–PB12 formally approved without declaring M9B complete. |
| PB1 — Authentication | **PRODUCTION GREEN** | Real Auth0-backed OIDC/PKCE login against provider-neutral JWT boundary. |
| PB2 — Account + Beta Entitlement | **PRODUCTION GREEN** | Auditable server-side pilot grant, one-store quota and immutable events. |
| PB3 — Create Store | **PRODUCTION GREEN** | First real merchant created persistent CROCCODILOS tenant through the portal. |
| PB4 — Branding | **PRODUCTION GREEN** | Real profile/colors/contacts/logo persisted; logo recovered through private R2. |
| PB5 — Source Connection | **PRODUCTION GREEN** | Real Yupoo source connected and persisted without re-rendering private URL. |
| PB6 — Source Scope / Import Decision | **PLANNED — NEXT** | Must become real server authority before automatic initial import progresses. |
| PB7–PB12 | **PLANNED** | Preserve approved order and per-slice proof gates. |

---

# 3. M7 detailed execution history

## 3.1 M7A — Sync Safety Decision / Catastrophic Diff Guard

### CONFIRMADO NO GITHUB

PR **#92 — `m7a: add sync safety decision and catastrophic-diff guard`** introduced the provider-neutral safety contract.

Key behavior:

- versioned sync decision contract;
- outcomes `proceed`, `preserve_last_known_good`, `quarantine`;
- partial scans and scans with disqualifying failures cannot infer missing/removal;
- empty complete scans quarantine;
- implausible complete volume collapse quarantines even when the upstream claims completeness;
- unsafe runs cannot promote cursor authority;
- normal safe runs remain eligible only after downstream verification;
- `TENANT-SYNC.md` becomes the focused synchronization contract.

Initial policy v1 was deliberately explicit/injectable rather than buried in provider code. M7A did not activate recurring sync.

## 3.2 M7B — Gated Recurring Scheduler Foundation

### CONFIRMADO NO GITHUB

PR **#93 — `m7b: add gated recurring tenant sync scheduler`** added the low-volume scheduling control plane.

Important properties:

- additive `tenant_sync_schedules` state;
- reuses `tenant_import_jobs mode='incremental'` rather than creating a competing execution system;
- deterministic recurring job identity from tenant/source/scheduled UTC slot;
- active jobs and unresolved recovery work block duplicate scheduling;
- first schedule is placed in the future to avoid historical catch-up storms;
- existing five-minute cron remains the orchestration clock;
- `TENANT_SYNC_AUTOMATION_ENABLED` is introduced but set to literal `0`.

M7B therefore shipped a **disabled foundation**, not a live recurring-sync launch.

## 3.3 M7C1 — Shared Listing Delta Semantics

### CONFIRMADO NO GITHUB

PR **#94 — `m7c: unify listing delta semantics behind sync safety`** established one provider-neutral delta engine.

It centralizes:

```text
NEW
RESTORED
CHANGED_MOVED
CHANGED
MOVED
MISSING
REMOVED
```

The delta engine is composed with M7A safety so partial/quarantined evidence suppresses absence-driven state. Duplicate source identity fails closed. No tenant incremental consumer or recurring Queue dispatch was activated in this slice.

## 3.4 M7C2 — Read-only Tenant Incremental Planning

### CONFIRMADO NO GITHUB

PR **#95 — `m7c2: add read-only tenant incremental planning foundation`** mapped isolated tenant Last Known Good state and normalized provider observations into the shared M7 delta contract.

Critical architecture correction before merge:

- an early draft attempted to write canonical private index state immediately;
- review against D1 batch limits and LKG safety showed that chunked writes could leave a partially promoted baseline after interruption;
- the canonical write path was removed before merge;
- the slice became intentionally read/plan-only;
- the next staging slice became responsible for private candidate materialization.

The Provider Engine contract was also clarified to distinguish a validated observation (`complete: boolean`) from an authoritative initial-import scan (`complete: true`).

## 3.5 M7C3 — Private Staged Sync State

### CONFIRMADO NO GITHUB

PR **#96 — `m7c3: add private staged sync state foundation`** defined tenant data-plane schema v5 staging.

Delivered:

- private stage run/observation/event/category tables;
- opaque `scope_id` plus bounded `scope_kind`;
- bounded JSON chunk staging instead of one statement per product;
- explicit `preserved` vs `quarantined` states;
- strict stage integrity seals;
- LKG remains canonical until safe promotion;
- detail-required work stays pending rather than being falsely promoted.

CI found a real foreign-key design bug in the first draft: staged event promotion referenced a sync run before that run existed in the canonical run ledger. The design was fixed so staging binds to the existing run ledger first.

## 3.6 M7C4 — Schema v5 Fleet Activation

### CONFIRMADO NO GITHUB / COMPROVADO EM PRODUÇÃO

Core PR **#97 — `m7c4: activate tenant schema v5 fleet upgrades`** made v5 the real tenant fleet target while recurring sync remained disabled.

The production path exposed multiple infrastructure realities, resulting in focused hardening PRs rather than weakened gates:

- **#111** moved fleet migration inspection/verification to binding-first tenant dispatch and added bounded retry;
- **#112** added a closed versioned schema-migration command instead of accepting arbitrary caller SQL;
- **#113** serialized fleet proof after trusted application deployment to avoid CI cancellation/deadlock;
- **#114** enabled strict-public egress only for the exceptional Workers API User Worker administrative upload path;
- **#116** moved User Worker migration capability preparation into trusted CI and introduced control-plane migration `0019`;
- **#117–#120** fixed dispatch-namespace input, deploy path ownership and D1 parameter-affinity/cast issues;
- **#121** cleaned only exact audited retained fleet fixtures after a newer complete proof passed.

Closure PR **#122** records:

- production implementation SHA `0d08daae7d78ea90d62816443b8ab56bde8a13c4`;
- application deploy `32685409063` — SUCCESS;
- automatic import/CEI canary `32685477694` — SUCCESS;
- dedicated fleet v4→v5 canary `32685477736` — SUCCESS;
- exact retained cleanup `32687014275` — SUCCESS, 24/24 audited fixtures removed;
- cleanup commit `8640ce3588c410daee2fb1e00b2b0f1e8115247a`.

This closed only the safe foundation through M7C4; recurring execution remained OFF.

## 3.7 M7D1 — Candidate State Schema v6

### CONFIRMADO NO GITHUB / COMPROVADO EM PRODUÇÃO

PR **#123** added schema v6 as an additive candidate-state model:

- 12 private run-owned relational candidate tables;
- bounded evidence/intelligence metadata rather than a giant opaque catalog blob;
- candidate deletion scoped by exact run identity;
- canonical catalog/media/LKG/merchant override authority kept outside the candidate tree;
- migration command capability advanced to v2.

Production evidence initially exposed a D1 proof-query limitation. PRs **#124–#125** diagnosed and replaced a compound aggregate with bounded simple count queries. PR **#126** cleaned only the exact retained proof fixtures.

Closure **#127** records:

- implementation commit `50d48c77a7cb3b2e172efe7f338622068b4f2bd4`;
- final production-proven application SHA `91a931986f1e67948688cefa8b97b09c4345bcac`;
- deploy `32735164418`;
- automatic import/CEI regression `32735316780`;
- read-only diagnostic `32735164386`;
- fleet v5→v6 `32735316785`;
- cleanup run `32738847875`.

## 3.8 Development continuity became a first-class contract

PR **#128** added `DEVELOPMENT-CONTINUITY.md` and formalized:

- mandatory live-GitHub revalidation;
- exact evidence vocabulary;
- milestone decomposition rules;
- one bounded claim per slice;
- exact-head CI/merge/trusted-main proof;
- truthful state/roadmap updates before advancing;
- M7E as an explicit decision, not an implied activation.

This governance change is why later production defects were retained/diagnosed instead of hidden behind optimistic status claims.

## 3.9 M7D2 — Controlled Enrollment and Scheduling Guard

### CONFIRMADO NO GITHUB / COMPROVADO EM PRODUÇÃO

PR **#129** introduced migration `0020_tenant_sync_controlled_enrollment.sql`.

Contract:

- no enrollment row means disabled;
- global activation flag **and** explicit cohort enrollment are both required;
- per-tick cap defaults to 1, with bounded hard maximum;
- active import, recovery and migration conflicts block recurring claims;
- final job creation rechecks all authority before mutation;
- no tenant/source identifiers are emitted in aggregate cron summaries.

Closure **#130** records:

- deployed SHA `f49ad81b6dbb64e07e5e7a6b5ab63b0433e00b16`;
- deploy `32754985570`;
- fleet regression `32755082787`;
- automatic import/CEI regression `32755082862`;
- zero recurring enrollment rows;
- empty active cohort;
- cap 1;
- zero manual Queue messages;
- recurring sync still OFF.

## 3.10 M7D3 — Incremental Dispatch and Scan-to-Stage

### CONFIRMADO NO GITHUB / COMPROVADO EM PRODUÇÃO

PR **#131** connected the real incremental dispatcher/Queue path to the private stage while keeping canonical LKG untouched.

Production-shaped proof exposed provider/taxonomy and D1-affinity defects. The project fixed the causes instead of weakening stage integrity:

- **#132** normalized duplicate Yupoo taxonomy identities before staging;
- **#133/#135** added read-only retained diagnostics;
- **#134** normalized only persistable taxonomy identity/count semantics;
- **#136** explicitly cast the expected category count because production D1 transport stringifies bound parameters.

Closure **#137** records:

- final application SHA `75060957930a451c37dace8ad883bcfbe042485c`;
- Queue activation `32817727889` — SUCCESS;
- application deploy `32817727900` — SUCCESS;
- scheduler-owned scan-stage canary `32817891164`, job `97709775593` — SUCCESS;
- stage reached `details_pending` with one expected affected detail;
- canonical LKG/storefront unchanged;
- Queue/DLQ clean;
- recurring sync OFF.

## 3.11 M7D4 — Staged Affected Detail

### CONFIRMADO NO GITHUB / COMPROVADO EM PRODUÇÃO

PR **#138** made only `needs_detail=1` events fan out through the existing public-safe detail Queue/provider boundary into private run-scoped candidate detail/media/evidence.

Important production failure:

- the first post-stage run-scoped read had no tenant-shaped SQL parameter;
- tenant dispatch identity resolution therefore failed closed;
- **#139** preserved/read the retained fixture;
- **#140** allowed an explicit already-server-resolved tenant identity at the common D1 transport boundary while rejecting mismatches.

Closure **#141** records:

- production SHA `95d3f3ba76adf5638576b212ccd5c94113e0eaa5`;
- Queue activation `32839467856`;
- app deploy `32839467904`;
- affected-detail canary `32839544016`, job `97775777786`;
- automatic initial-import/CEI regression `32839544093`;
- private stage `details_complete`;
- one affected candidate, two media relationships, zero FK findings;
- canonical LKG/storefront unchanged;
- recurring sync OFF.

## 3.12 M7D5 — Affected-only CEI Candidate Processing

### CONFIRMADO NO GITHUB / COMPROVADO EM PRODUÇÃO

PR **#142** ran CEI only for affected private candidates whose normalized detail evidence was complete.

It deliberately reused:

- the existing Evidence → Domain Router → Knowledge Pack → classifier v3 path;
- Sports Knowledge Pack v1 through the production registry;
- durable merchant override reapplication;
- private candidate intelligence state.

It did not refetch supplier detail and did not mutate canonical serving authority.

Closure **#143** records:

- production SHA `acf09a32b6ae357132df9b871225305e653d50aa`;
- deploy `32854458874`;
- Queue activation `32854459796`;
- canary `32854564604`, job `97823266548`;
- 106 test files / 529 tests at that proof;
- clean Queue/DLQ;
- recurring sync OFF.

## 3.13 M7D6 — Candidate Verification

### CONFIRMADO NO GITHUB / COMPROVADO EM PRODUÇÃO

PR **#144** added the private verification barrier for the composed proposed view: unchanged LKG + affected candidates + safe removal events.

The verifier fails closed on product identity, detail/media, taxonomy, CEI, override, merchandising, privacy and referential-integrity blockers.

The first production canary failed because the tenant SQL command allowlist correctly rejected `PRAGMA foreign_key_check`. PR **#145** did **not** broaden the allowlist. It normalized only that exact read-only operation to SQLite's table-valued equivalent:

```sql
SELECT * FROM pragma_foreign_key_check
```

Closure **#146** records:

- production SHA `c757b779e3822a360b1fff4594d8387b4c6fd6e5`;
- Queue activation `32866176282`;
- deploy `32866176706`, job `97862324052`;
- cumulative candidate-verification canary `32866423144`, job `97862709090`;
- private stage reached `verified`;
- zero FK findings;
- merchant override v7 preserved;
- no promotion/cursor/removal activation;
- recurring sync OFF.

## 3.14 M7D7 — Atomic Promotion Authority Primitive

### Architecture decision before implementation

M7D7 deliberately stopped for measured D1 evidence before choosing its authority model.

PRs:

- **#147** measured real Cloudflare D1 rollback, large set-based mutation, concurrent reader behavior and a generation/pointer alternative using isolated ephemeral D1;
- **#148** corrected the descriptive write-count evidence and repeated the probe;
- **#149** accepted the bounded set-based D1 transaction as the V1 authority-switch design.

### Implementation and production proof

PR **#150** introduced:

- schema v7 authority revision and immutable run base-authority snapshot;
- verified-only promotion admission;
- stale-base compare-and-swap;
- competing-run exclusion;
- one atomic D1 transaction for affected canonical product/taxonomy/media/CEI/merchandising/source-index state plus authority revision;
- measured launch envelope around 20k products / 40k media relations;
- merchant-override preservation;
- MISSING/REMOVED fail-closed until D9.

Closure **#153** records production implementation SHA:

`725854afc408bb6177aa071e2797051369c4040c`

with:

- Queue activation `33034446742`;
- application deploy `33034446810`;
- fleet canary `33034549918`;
- cumulative M7D4→M7D7 canary `33034549923`;
- automatic tenant import canary `33034549968`;
- provider/frontend quality green.

PR **#154** then reconciled the focused normative continuity docs.

## 3.15 M7D8 — Verified Promotion and Cursor/Control Commit

### CONFIRMADO NO GITHUB / COMPROVADO EM PRODUÇÃO

PR **#155** introduced migration `0021_tenant_sync_finalization.sql` and moved control authority behind durable promotion.

Contract:

- deterministic scheduled run may be created without prematurely advancing schedule authority;
- exact due slot is persisted as immutable run ownership;
- promotion remains the M7D7 atomic primitive;
- schedule/control metadata commits only after durable promotion success;
- crash after promotion but before control commit is recoverable;
- replay of an already-promoted run commits only the remaining control metadata;
- stale ownership CAS fails closed.

Closure **#156** records:

- tested PR head `6be534ad52948c38f23e7747c190da3742f8d700`;
- implementation main SHA `cb09e35b753a37726d74b18eab12761885e38faa`;
- Queue activation `33100902745`;
- application deploy `33100902771`;
- fleet regression `33101085125`;
- cumulative M7D4→D7 canary `33101085323`, job `98618651668`;
- dedicated D8 canary `33101085492`, job `98618652912`.

## 3.16 M7D9 — Repeated Miss and Safe Removal

### CONFIRMADO NO GITHUB / COMPROVADO EM PRODUÇÃO

PR **#157** introduced tenant schema v8 and the bounded removal model:

- absence progresses only from complete, healthy, safety-authorized evidence;
- removal threshold/policy is frozen per run;
- duplicate/replayed promoted runs cannot double-increment misses;
- category/scope detachment is distinct from global removal;
- canonical product removal occurs only after the final valid scope is gone at threshold;
- durable merchant override survives removal and is reapplied on RESTORED;
- migration protocol preserves historical compatibility while current capability targets v8.

Production proof itself exposed CI/orchestration debt and triggered hardening PRs **#158–#164**:

- current-schema fleet preparation;
- exact-SHA deploy/Queue/fleet proof ownership;
- production D1 mutation lock serialization;
- 100-statement bounded D1 schema bootstrap chunking;
- exact trigger ownership for D9/automatic-import proof;
- automatic canary upgraded to schema v8.

Closure **#165** records final M7D9 production implementation/proof SHA:

`9214094197b010f46f7bf5144e7dbb445afa90ef`

and explicitly preserves:

- tenant data-plane schema v8;
- migration-command capability v4;
- repeated-miss/removal/restoration safety;
- merchant override retention;
- recurring tenant sync OFF, cohort empty, cap 1;
- the distinction between tenant Intelligent Sync and the legacy/default-catalog scheduled process.

## 3.17 Continuous campaign authorization

PR **#166** recorded the owner's conversation-scoped campaign authorization to continue from M7D10 toward later milestones while still requiring:

- one bounded slice/PR;
- exact-head CI;
- exact tested merge;
- trusted-main proof;
- applicable canaries;
- no silent activation.

This changed only the conversation stop boundary, not the evidence standard.

## 3.18 M7D10 — Recovery, Replay and Operational Observability

### CONFIRMADO NO GITHUB / COMPROVADO EM PRODUÇÃO

PR **#167** delivered the recovery/replay slice without enabling recurring sync or changing tenant schema v8.

Control-plane migration `0022` added:

- monotonic job revisions;
- tokenized phase leases;
- bounded recovery state;
- durable CEI checkpoint;
- strict replay-request authority.

Runtime behavior includes:

- stale/expired owners fail closed;
- bounded backoff/reclaim for ordinary scan/classify/verify/finalize failures;
- detail recovery remains candidate-scoped;
- exhausted work requires durable owner/admin replay authority;
- replay Queue messages are derived from private durable evidence rather than arbitrary browser payloads;
- operations projection is tenant-scoped and redacted;
- malformed/wrong-queue poison follows configured retry/DLQ policy;
- duplicate delivery after durable completion becomes a no-op.

The M7D10 implementation/proof checkpoint is associated with trusted-main SHA:

`be627f1896f1f3775b53f0e5a77e771858ee1483`

Subsequent proof fixes:

- **#168** repaired the older cumulative D8 ephemeral fixture after M7D10 added recovery/revision columns;
- **#169** made trusted application deployment own D8/D10 proof-input changes so the D7→D8→D9→D10 chain revalidates the same SHA.

PR **#170** then recorded the M7D10 Production Green checkpoint and the next owner sequencing decision.

## 3.19 What M7 did NOT complete

At this capture:

- **M7D11 is still PLANNED** — safe change/review feed is not a completed production customer authority;
- **M7E remains DECISION REQUIRED** — recurring tenant Intelligent Sync is still OFF;
- therefore **M7 as a macro launch capability must not be described as globally activated recurring sync**.

---

# 4. M9 storefront pivot before the Portal Beta campaign

After M7D10, the owner deliberately prioritized storefront UX work before finishing M7D11/M7E/M8. This did not mark those milestones complete.

## 4.1 M9 planning

PR **#170 — `docs: approve M9 UX execution slices`**:

- records the M7D10 Production Green checkpoint;
- approves M9A–M9D as bounded execution slices;
- keeps recurring sync disabled;
- preserves the opaque media/private-source boundary.

## 4.2 M9A — Commerce Shell and URL State

### COMPROVADO EM PRODUÇÃO

PR **#171** delivered:

- premium responsive storefront shell/navigation;
- prominent API/server-backed search;
- compact root discovery;
- structured skeleton/empty/retry states;
- bounded URL state for `q`, `page`, `teamId`, `leagueId`, `facetId`;
- reload and browser back/forward restoration.

PR **#172** fixed the isolated UI staging proof to smoke the canonical extensionless `/app` route.

Closure **#173** records:

- application SHA `0b2c4fd8f21db5d86cf6981ba510875a637985ed`;
- trusted proof SHA `f5366ac7b281ce8326ceb74efe051d58ff6758df`;
- application deploy `33408598897`;
- isolated UI staging `33409329391`;
- live production search `Almeria` returned 11 products;
- browser back/forward restored root/query states;
- recurring sync remained OFF.

M9A is Production Green.

## 4.3 M9B — Product Discovery and Merchandising

M9B accumulated many merged refinements but remained **IN PROGRESS** when the beta campaign paused it.

Notable merged PRs:

- **#174** — crest-led discovery and retail merchandising; owner-provided ZIPs normalized into opaque bundled crest assets, server-allowlisted sorting, no fake `new` claims;
- **#175** — mobile-first Luxury Marketplace visual direction;
- **#176** — stable mobile shell, dock state, VisualViewport/keyboard handling;
- **#177** — compact hero and dedicated mobile search dialog;
- **#178** — compact discovery rails;
- **#179** — centralized motion/experience-stack responsibility, reduced-motion safe;
- **#180** — denser phone catalog cards/toolbars/dock while retaining touch targets;
- **#181** — compact mobile country/league/team entity browser;
- **#182** — team collection filter density and real facet state;
- **#183** — mobile quick-view polish while preserving Swiper ownership;
- **#184** — stacked full-width root discovery groups on phones;
- **#185** — dock active state follows the real reading section;
- **#186** — bounded incremental/infinite feed over the existing paginated API;
- **#187** — truthful club discovery copy, replacing an unsupported featured/curated implication.

The owner then authorized the Portal Beta first-real-merchant sequencing. M9B was paused, **not closed**. M9C/M9D remain planned/unproven.

---

# 5. First Real Merchant Portal Beta campaign

The beta campaign exists to prove a real merchant chain without waiting for every later portal/storefront milestone:

```text
real person
-> OIDC authentication
-> server entitlement
-> fresh isolated store/tenant
-> branding
-> private source
-> import decision
-> provisioning/import
-> CEI/verification
-> private preview
-> persisted merchant portal
```

It must not reuse the default tenant, fake backend state or activate recurring Intelligent Sync.

## 5.1 PB0 — Live Truth + Sequencing Decision

### CONFIRMADO NO GITHUB

PR **#188 — `PB0: formalize first real merchant beta sequencing`** added `PORTAL-BETA-EXECUTION.md` and approved:

```text
PB0 -> PB1 -> PB2 -> PB3 -> PB4 -> PB5 -> PB6 -> PB7 -> PB8 -> PB9 -> PB10 -> PB11 -> PB12
```

Baseline:

- main `3221c92945750596a3b52ae29dcb51bfcb687cea`;
- trusted app deploy `33537313254` — SUCCESS;
- M9B deliberately paused/incomplete;
- initial tenant import remains allowed;
- recurring tenant sync remains OFF.

PB0 also documented a bounded **auditable pilot entitlement** as the first merchant's authority source. This is not a public free trial and not a hard-coded identity bypass.

Closure PR **#189** records:

- tested head `c88ee4b66176873561d6814ace7bba4bd5970be0`;
- SaaS control-plane validation `33588925793` — SUCCESS;
- tenant-ingestion validation `33588925775` — SUCCESS;
- integrated PB0 main `75afe81880a856bb44493daf8b61e1578cd68451`.

## 5.2 PB1 — Authentication Foundation

### CONFIRMADO NO GITHUB / COMPROVADO EM PRODUÇÃO

PR **#190** connected a real external OIDC flow while preserving the existing provider-neutral Worker JWT boundary.

Portal behavior:

- Authorization Code + PKCE S256;
- signup/login/logout;
- callback state validation;
- session restoration;
- refresh-token handling/rotation;
- browser auth material in `sessionStorage`;
- no customer password database;
- no SPA client secret;
- backend remains issuer/audience/JWKS/signature/expiry authority;
- missing configuration fails closed.

PR **#195** made the four required runtime auth bindings an all-or-none trusted deployment bundle. A partial bundle fails before Worker mutation; 0/4 preserves fail-closed behavior.

PR **#198** proved the secret-only trusted-main redeploy path and caused production to receive the complete configured OIDC bundle. Trusted deploy #121 proved all four runtime auth values were present without exposing their secret values.

### Real-user production defect: blank callback page

The first real mobile Auth0 signup/login returned to `/auth/callback?...` but rendered a blank white page.

PR **#199** diagnosed the root cause:

- shared Vite build intentionally uses a relative base;
- on nested portal callback routes, relative asset URLs resolved under `/auth/assets/...` instead of `/assets/...`;
- HTML loaded but JS/CSS did not.

Fix:

- add root `<base href="/">` only for the customer portal entry;
- preserve the storefront/shared portable relative-base contract;
- add regression coverage for deep portal routes.

The repaired auth runtime was merged/deployed and the real merchant successfully reached the authenticated portal.

## 5.3 PB2 — Account + Beta Entitlement

### CONFIRMADO NO GITHUB / COMPROVADO EM PRODUÇÃO

PR **#192** added migration `0023` and the server-side beta entitlement model.

Durable authority includes:

- opaque authenticated account principals;
- normalized account entitlements;
- immutable entitlement events;
- explicit pilot-grant source;
- expiry/revocation;
- `maxStores=1` first-beta policy;
- permanent one-slot concurrency barrier;
- transaction-local revalidation when owner membership/store slot is created;
- safe evaluated entitlement projection to `/api/admin/session`;
- no hard-coded email/name/IdP subject bypass.

Trusted pilot grant operation:

- trusted-main-only workflow;
- explicit `PILOT` confirmation;
- opaque principal input;
- immutable audit event;
- serialized with production D1 mutation lock.

### Production migration defect

The first trusted deployment stopped at migration 0023 with Cloudflare D1 `incomplete input`; Worker/static deployment was skipped and the previous production remained intact.

PR **#193** repaired the still-unapplied migration rather than inventing a later migration:

- replaces trigger `SELECT CASE ... RAISE()` with equivalent `SELECT RAISE(...) WHERE ...` form;
- enforces LF for migrations;
- adds regression checks for the remote parser boundary.

Merged repair main:

`d810d8b8c4a272f15f17f9b225ffc77ac3296190`

Trusted deploy #117 applied 0023 and passed smoke.

An audited pilot grant was then successfully applied to the first real authenticated merchant's **opaque principal**. This ledger intentionally omits the personal identity/email and private account details.

## 5.4 PB3 — Create Store

### CONFIRMADO NO GITHUB / COMPROVADO EM PRODUÇÃO

PR **#194** connected the portal to the real `POST /api/admin/stores` path:

- name / slug / currency only;
- server generates durable opaque tenant identity;
- entitlement is authoritative before new creation;
- exact same-store retries are idempotent;
- concurrent one-store quota races remain bounded;
- merchant response excludes internal data-plane/catalog/membership/runtime locators;
- no default tenant reuse;
- no source/import/domain bundled into the create request.

PR **#197** exposed only a safe copyable opaque account code for the pilot-grant operation, avoiding DevTools inspection.

### First real merchant exposed three PB3 integration defects

These failures are important historical evidence because tests were strengthened after each one.

1. **PR #200 — wrong replay profile relation**  
   Replay lookup queried nonexistent `tenant_profiles`; canonical table is `tenant_store_profiles`.

2. **PR #201 — browser/internal payload contract mismatch**  
   Browser form submitted `name`; canonical provisioning planner requires `storeName`. The portal wrapper now rebuilds the delegated internal request from the authoritative server plan.

3. **PR #202 — wrong replay currency relation**  
   Replay lookup selected nonexistent `catalog_tenants.currency`; currency is owned by `tenant_store_profiles`.

Together with the earlier PB1 deep-callback bug, these became explicit first-real-user integration lessons in `CURRENT-STATE.md`.

### Final production acceptance

Final PB3 runtime SHA:

`c42e9a5e2d67920678b998d64c6a0923546a7289`

Production deploy #125 / run `33947883746` — SUCCESS.

The real merchant then created **CROCCODILOS** through `app.catalogoengine.com`.

Observed acceptance:

- store persisted after reload;
- account allowance changed from `0/1` to `1/1`;
- server returned the store from durable session state;
- the tenant is separate from the historical default tenant.

Closure PR **#203** records PB3 Production Green.

## 5.5 PB4 — Branding

### CONFIRMADO NO GITHUB

PR **#204** introduced the real Appearance/branding workspace.

Backend/safety:

- authenticated tenant-scoped profile read/write;
- owner/admin mutation authority;
- controlled theme presets;
- validated store name;
- semantic primary/secondary colors with deterministic accessible foreground choice;
- optional WhatsApp/Instagram;
- logo PNG/JPEG/WebP only;
- SVG disabled;
- 2 MiB source limit;
- decoded-image and dimension/pixel validation;
- bounded WebP normalization through Cloudflare Images Worker binding;
- additive brand-asset registry;
- public merchant profile contains only opaque Catalog Engine asset identity/path;
- no arbitrary merchant HTML/JS/CSS;
- no base64 image blob in D1.

Portal UX became deliberately premium/mobile-first with live preview, status/next-action copy, keyboard/focus/error/loading/success handling and clear journey language.

PR #204 passed its complete exact-head CI set and deployed as part of the PB4 runtime.

### Real production defect: Cloudflare Images hosted storage

The first real CROCCODILOS logo attempt passed validation/transformation but returned `brand_asset_storage_failed` at hosted-image persistence.

The file itself was not the problem. The production architecture had assumed hosted Cloudflare Images storage where the account did not have that separate storage capability enabled.

PR **#205** changed only the storage ownership model:

- keep Images binding for decode/inspection/normalization;
- store normalized logo bytes in private **R2** through `BRAND_ASSETS`;
- expose only `/brand-assets/bas_<opaque>.webp` publicly;
- never expose the R2 object key;
- preserve active/replaced/deleted lifecycle;
- migration `0025` expands provider state for R2.

First deploy #127 failed safely because R2 had never been enabled on the Cloudflare account. Cloudflare returned safe platform code `10042` requesting initial R2 account activation. The merchant/owner enabled R2 once through the Cloudflare Dashboard.

The same trusted deployment was rerun successfully.

### COMPROVADO EM PRODUÇÃO

PB4 runtime SHA:

`dfff6204e42a862c42cc091b70fc06243016e155`

Trusted deployment #127 / run `33952906777`:

- SUCCESS;
- migration 0025 applied;
- 145 test files / 714 tests passed;
- private bucket `catalog-engine-brand-assets` provisioned;
- Worker binding `BRAND_ASSETS` confirmed;
- Images binding retained;
- smoke passed;
- recurring sync still OFF.

The merchant retried the same real branding flow:

- identity save succeeded;
- crocodile logo rendered;
- reload/re-entry showed the same logo and saved branding state.

Governance history:

- **#206** recorded runtime checkpoint while final merchant persistence proof was still pending;
- one accidental direct documentation write was explicitly repaired through **#207** instead of being normalized as acceptable behavior;
- **#208** closed PB4 only after the real persistence proof.

## 5.6 PB5 — Source Connection

### CONFIRMADO NO GITHUB / COMPROVADO EM PRODUÇÃO

The sensitive backend source authority already existed. PB5 intentionally added only the missing merchant bridge.

PR **#209 — `PB5: connect real merchant catalog source`** added:

- mobile-first Catalog/source entry;
- Yupoo as the only enabled beta provider;
- authenticated client for `POST /api/admin/stores/:tenantId/source`;
- membership + owner/admin mutation enforcement remains server-side;
- Provider Engine verifies/canonicalizes Yupoo privately;
- browser request contains the supplied URL only for the immediate controlled mutation;
- connected state is recovered through safe onboarding projection;
- the canonical/private supplier URL is not rendered back after connection;
- destructive source replacement remains blocked after imported private state exists;
- no fake scope selector;
- no claim that import/CEI/preview already completed;
- no recurring-sync enrollment.

Exact PR head that passed portal/frontend validation:

`40555ad9bf26cca2a24e80a6f21285879934b5f1`

Merged PB5 runtime SHA:

`5f01b679804c45246077eb292ad2648ab6b20b48`

Trusted application deploy run `33955408377`:

- SUCCESS on exact SHA;
- 146 test files / 726 tests passed;
- build/public artifact verification passed;
- D1 step passed with no new migration required;
- Worker/static deploy passed;
- platform/auth binding verification passed;
- initial-import automation boundary checks passed;
- public catalog smoke passed;
- recurring sync still OFF.

### First real merchant acceptance

The CROCCODILOS merchant connected the real Yupoo catalog in production.

The UI returned verified/connected state. After reload/re-entry:

- `Minhas lojas` still reported the source connected;
- next action changed to **Definir importação**;
- reopening the Catalog source flow still showed Yupoo connected;
- the supplier URL did not have to be re-entered and was not rendered back.

Closure PR **#210** records PB5 Production Green and advances the living execution point to PB6.

---

# 6. Cross-cutting engineering lessons from the execution history

## 6.1 Production proof is part of implementation

M7 repeatedly demonstrated that a green local/PR suite is not equivalent to a production-safe distributed path.

Examples that only production-shaped proof exposed:

- D1 parameter affinity after transport stringification;
- strict D1 statement/batch limits;
- tenant dispatch identity resolution for run-scoped queries;
- SQL allowlist interaction with foreign-key inspection;
- Cloudflare Worker administrative egress boundaries;
- Actions concurrency deadlocks/cancellations caused by multiple workflows sharing one mutation lock;
- exact-SHA proof path filters that failed to retrigger deployment after canary-only changes;
- old cumulative canary fixtures that no longer matched newer runtime schema.

The resulting repository rule is intentional: fix the first real root cause, retain failed evidence, and never weaken a safety gate just to make a workflow green.

## 6.2 Last Known Good remains the safety anchor

Across M7:

- planning/staging happens privately;
- partial/unsafe scans do not infer absence;
- affected detail/CEI is candidate-scoped;
- verification happens before promotion;
- serving authority changes atomically;
- cursor/control state commits only after promotion;
- removal requires repeated complete safe evidence;
- crash/replay/recovery does not create a second promotion authority.

This is why recurring sync can remain globally OFF while the full internal safety machinery is production-proven through D10.

## 6.3 Provider evidence is not public merchandising truth

Yupoo is the first provider, not the product architecture boundary.

Raw provider categories/IDs/URLs remain private evidence. CEI/public taxonomy is separately owned. This rule becomes especially important for PB6: a merchant scope selector cannot simply expose raw Yupoo category IDs because they are provider-private locators, not durable customer-facing authority.

## 6.4 The first real merchant found integration gaps that isolated tests missed

The CROCCODILOS journey found real defects in:

- deep-route Vite asset resolution;
- schema/table naming used by PB3 replay;
- portal-to-control-plane payload canonicalization;
- profile vs tenant ownership of currency;
- Cloudflare Images hosted-storage assumption.

Every issue was repaired in code/tests before the milestone was closed. The user was never asked to accept fake success as evidence.

## 6.5 Cloudflare resource activation is a separate operational boundary

Workers Paid / Workers for Platforms did not implicitly mean every other Cloudflare product was already account-enabled. R2 required one account-level activation before trusted deployment could provision/bind its bucket.

The final branding design therefore separates:

- Images binding: bounded image decode/normalize responsibility;
- R2 private storage: merchant logo bytes;
- public profile: only opaque Catalog Engine asset path.

## 6.6 Default-catalog automation and tenant Intelligent Sync are different systems

Several later `main` heads can be automatic sanitized `data/catalog.json` updates from the legacy/default compatibility path.

A bot commit on `main` is **not evidence** that recurring tenant Intelligent Sync was enabled. Always inspect the activation flags/cohort and current owner contracts.

---

# 7. Current platform snapshot after PB5

The production foundations now include:

- Cloudflare Workers Paid / Workers for Platforms;
- control-plane Worker and D1;
- per-tenant isolated D1/User Worker model;
- production dispatch namespace;
- scan/detail Queues and DLQs for initial import;
- five-minute scheduler;
- Provider Engine with Yupoo launch adapter;
- CEI Core + Sports Knowledge Pack v1 path;
- tenant data-plane schema v8;
- safe incremental staging/verification/promotion/removal/recovery machinery through M7D10;
- Auth0 as the first configured external OIDC provider behind provider-neutral JWT validation;
- auditable beta entitlement authority;
- first real merchant tenant CROCCODILOS;
- private R2 brand asset storage;
- real private Yupoo source connection;
- `app.catalogoengine.com` merchant portal.

The platform must still not be described as broadly launch-complete. Current-state and roadmap remain the source for what is unfinished.

---

# 8. Exact current handoff after PB5

## PRODUCTION GREEN through PB5

The first real merchant has proven:

```text
real OIDC login
-> audited beta entitlement
-> fresh durable store/tenant creation
-> persisted branding/logo
-> persisted private Yupoo source connection
```

## PLANNED — NEXT: PB6 — Source Scope / Import Decision

PB6 has a critical implementation constraint discovered by live-code audit:

- source connection advances the provisioning run toward data-plane work;
- data-plane provisioning can advance to migrations;
- migrations advance toward `current_step='import'`;
- the initial-import dispatcher automatically discovers eligible `current_step='import'` tenants because `TENANT_IMPORT_AUTOMATION_ENABLED=1`.

Therefore PB6 cannot be merely a UI card or a client-side selector.

The merchant decision must become **durable server-side authority that the automatic initial-import discovery path actually honors**.

Safe beta fallback permitted by `PORTAL-BETA-EXECUTION.md`:

- if provider-safe merchant scope discovery cannot expose durable choices without leaking raw Yupoo identifiers/URLs, offer one truthful explicit decision: **Importar catálogo completo**;
- persist the decision;
- make automatic import require/consume that decision;
- preserve already-running/completed evidence safely;
- do not destructively reset the real tenant just to introduce the gate.

## PENDENTE after PB6

- PB7 — truthful durable provisioning/import progress;
- PB8 — first real isolated tenant import + CEI + verification proof;
- PB9 — authenticated private preview;
- PB10 — persistent merchant home;
- PB11 — beta E2E journey;
- PB12 — consolidated production proof / BETA GREEN;
- return to paused M9B by default after PB12 unless the owner changes sequencing;
- M7D11 remains planned;
- M7E remains decision-required;
- recurring tenant Intelligent Sync remains OFF.

---

# 9. Continuation checklist for a future contributor

Before using this ledger:

```text
[ ] Re-read live main HEAD and recent commits.
[ ] List open PRs/active branches.
[ ] Re-read AGENTS.md, governance, document map and development continuity.
[ ] Re-read CURRENT-STATE.md and DEVELOPMENT-ROADMAP.md.
[ ] Re-read PORTAL-BETA-EXECUTION.md while PB0–PB12 remains active.
[ ] Read focused owner documents for the next slice.
[ ] Confirm TENANT_IMPORT_AUTOMATION_ENABLED and tenant sync-off boundaries without exposing secret values.
[ ] Distinguish bot/default-catalog commits from tenant Intelligent Sync.
[ ] Inspect live code/workflows/tests; do not implement from this historical ledger alone.
[ ] Stop/reconcile if live evidence disagrees with this capture.
```

This document is a **save-game and historical reconstruction**, not permission to skip the repository's live-truth protocol.