# Catalog Engine — Current State

Status: **Living operational truth**  
Snapshot: **2026-08-24 after M7D1 production closure**
Purpose: record what is implemented/proven now, separate from durable product contracts and future roadmap work.

## How to use this document

This document owns mutable implementation/deployment truth.

- Product/business invariants remain in focused normative documents.
- Architecture contracts remain in `SAAS-ARCHITECTURE.md`, `TENANCY.md`, `PROVIDER-ENGINE.md`, `CEI.md` and tenant subsystem documents.
- Execution order lives in `DEVELOPMENT-ROADMAP.md`.
- Contributor startup, evidence labels, milestone decomposition and handoff updates are governed by `DEVELOPMENT-CONTINUITY.md`.
- Root handoffs remain historical context and do not override this living state or focused normative contracts.
- M6 historical production evidence lives in `docs/M6-CLOSURE-2026-08-21.md`.

## Repository baseline

- repository: `lucasvenancio0110/catalog-engine`;
- default branch: `main`;
- package: `0.9.0`;
- Node: 22+;
- frontend: Vite + vanilla ES modules;
- no React/Vue/Svelte/Angular production application.

Milestone state:

- M1 production safety foundations: **partial / still open**;
- M2 code/data deployment separation: **complete**;
- M3 Design Foundation: **complete**;
- M4 Provider Engine: **complete**;
- M5 automatic tenant Queue import: **complete / production-proven**;
- M6 CEI Core + Sports Knowledge Pack v1: **complete / production-proven**;
- **M7 Intelligent Sync v2: current execution milestone; safety/scheduling/delta/staging/schema-fleet/candidate-state foundations through M7D1 are production-proven**.

## Final M6 production checkpoint

Final production code commit:

`53795ab25600d3c7f44034e610b6f54580fcc9d0`

PR:

`#90 — m6e: route CEI classification through domain runtimes`

Application deploy:

- run `32501638102`;
- conclusion: **SUCCESS**;
- Worker version `ea387313-a952-4be6-ad27-bc4734cba6ad`;
- `TENANT_IMPORT_AUTOMATION_ENABLED=1`;
- cron `*/5 * * * *`;
- scan/detail Queue producer verification passed;
- existing public catalog smoke passed;
- remote D1 migrations reported no pending migration.

Automatic scheduler canary:

- run `32501722230`;
- job `96832706262`;
- conclusion: **SUCCESS**;
- trusted `main` checkout matched `53795ab25600d3c7f44034e610b6f54580fcc9d0`;
- zero manual Queue messages;
- scheduler discovered isolated tenant;
- import/classify/verify completed;
- verification findings: `0`;
- Queue/DLQ backlogs clean;
- default catalog count unchanged.

Final canary CEI evidence:

```text
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
```

Final canary catalog evidence:

```text
products = 1
media = 2
public leaks = 0
```

Final quality gate:

```text
75 test files passed
355 tests passed
ESLint passed
dependency policy passed
```

Final build verification on application deploy:

```text
products = 17018
checkedImages = 49004
checkedProxyRoutes = 49004
supplierLeak = false
privateStatePublished = false
opaqueIds = true
storageMode = edge-proxy
```

## Production safety currently implemented

### Credential boundary

Ordinary PR validation is secret-free. Production Cloudflare credentials are used only by trusted-main or deliberately privileged workflows.

### Code/data separation

Application deploy owns:

```text
quality
→ build
→ build:verify
→ schema migrations
→ Worker/assets deploy
→ producer/automation verification
→ smoke existing catalog
```

Application deploy does not replace commercial catalog business data.

Default catalog publication remains a separate deliberate workflow.

### Remaining M1 debt

Still open:

- protect `main` with required checks/review policy;
- govern direct-push automation;
- review/pin third-party Actions/toolchain deliberately;
- production migration parity verification;
- backup/rollback/recovery runbooks.

GitHub Actions currently emits a non-blocking warning that some `actions/checkout@v4` / `actions/setup-node@v4` internals target deprecated Node 20 and are being forced onto Node 24. This belongs to toolchain governance, not M6 correctness.

## Cloudflare baseline proven

Confirmed through repository configuration and controlled production evidence:

- main Worker `catalog-engine`;
- static assets via `ASSETS`;
- control/default D1 `catalog-engine-db` through `CATALOG_DB`;
- Workers for Platforms dispatch namespace `catalog-engine-production`;
- `TENANT_DISPATCH` binding;
- isolated tenant User Worker/data-plane path;
- cron `*/5 * * * *`;
- scan/detail primary Queues and DLQs;
- dedicated Queue consumers;
- main Worker producers;
- custom hostname/domain workflows;
- application/API smoke paths.

Known host roles include:

- `catalogoengine.com` — platform/marketing target;
- `app.catalogoengine.com` — customer portal;
- `edge.catalogoengine.com` — Cloudflare for SaaS technical role;
- `origin.catalogoengine.com` — fallback/internal origin role.

This is not a complete account-wide Cloudflare inventory claim.

## M5 tenant import state — production-proven

Durable path:

```text
scheduler
→ scan Queue
→ scan consumer
→ detail Queue
→ detail consumer
→ finalize
→ classify
→ verify
```

M5 final production proof remains:

- final M5 commit `b917b023fde537baa0aa797d1230b7df7db5595e`;
- deploy `32392783507` = SUCCESS;
- automatic canary `32392875597` = SUCCESS.

Do not regress these M5 rules:

- OFF (`TENANT_IMPORT_AUTOMATION_ENABLED=0`) remains a valid rollback state;
- scheduler pending/queued races retry instead of failing;
- canary is post-deploy and scheduler-driven;
- canonical tenant Worker identity is `ce-<suffix>`;
- never purge global Queues merely to make a smoke/canary pass;
- preserve failure evidence before cleanup.

## M6 CEI state — production-proven

M6 now provides the launch CEI architecture required by the roadmap.

### Normalized Evidence

CEI consumes strict/versioned source-neutral Evidence rather than Yupoo-shaped objects.

### Knowledge Pack boundary

Sports is the launch Knowledge Pack (`sports-v1`), not CEI Core semantics.

The generic Knowledge Pack contract owns versioned domain knowledge and merchandising definitions.

### Confidence / conflict / season

Classifier `professional-v3` retains the M6C Sports recognition behavior and supports:

- domain confidence;
- field-level confidence;
- team/league/facet/season claims;
- explicit semantic conflicts;
- reliable two-year season evidence;
- `unknown` / `needs_review` rather than forced guesses.

### Durable CEI intelligence state

Tenant data-plane schema v4 persists generic CEI intelligence state in `catalog_product_intelligence_state`.

The persisted model keeps:

```text
automatic CEI inference
+
merchant override
=
effective view
```

Merchant overrides remain durable tenant business data and survive reclassification.

### Verification

Verification blocks structural corruption such as missing/stale CEI state, override mismatch, public source leaks and invalid catalog/media relationships.

Normal CEI exceptions such as review/research/conflict counts are operational metrics, not automatic whole-tenant corruption.

### Merchandising

Merchandising is versioned and Knowledge-Pack-driven.

Sports navigation now belongs to Sports Knowledge Pack v1. Tenant classification persists public-safe navigation plus internal versioned merchandising metadata.

### Domain Runtime / Router

CEI Core now has a generic Domain Runtime contract and deterministic Domain Router.

Production runtime registry contains exactly:

`Sports v1`

A test-only Wheels/Automotive runtime proves another domain can use the same Core without teaching CEI Core automotive vocabulary. It is not a production Automotive Knowledge Pack.

The top-level classifier no longer directly imports Sports resolver/claims.

### M6 production defects found and fixed by gates

M6D production canaries found two real issues before closure:

1. classification/verification initially required account-level Cloudflare credentials in Worker runtime; fixed by using isolated `TENANT_DISPATCH` instead;
2. merchandising verification compared JSON INTEGER metadata against a stringified D1 parameter; fixed with explicit integer coercion plus SQLite regression coverage.

The final canary passed after both were corrected. Verification was not weakened to obtain green status.

## M7 foundation state — M7A through M7D1 production-proven

M7 remains the active milestone, but its safety and data-plane foundations through additive tenant schema v6 candidate-state activation are now proven in production.

Implemented foundation:

- M7A catastrophic-diff safety decision preserves LKG on partial/disqualified scans and quarantines implausible complete drops;
- M7B per-tenant recurring scheduler foundation reuses incremental `tenant_import_jobs`, has deterministic opaque slot identity and keeps unresolved failures durable;
- M7C1 shared provider-neutral listing delta semantics own NEW/CHANGED/MOVED/RESTORED/MISSING/REMOVED;
- M7C2 native incremental scan planning reads paginated LKG and remains strictly read/plan-only;
- M7C3 private schema-v5 staged sync state keeps canonical LKG untouched until verification/promotion and deliberately leaves detail-bearing runs in `details_pending`;
- M7C4 activates schema v5 for fresh tenants and additive maintenance upgrades of already-ready v4 tenants;
- M7D1 adds private relational candidate detail/media/CEI/merchandising storage in schema v6 without writing candidate rows, changing canonical authority or enabling recurring sync.

M7C4's final production boundary is:

```text
trusted-main deploy CI
→ upload current existing-tenant User Worker capability
→ conditionally promote durable migration_command_version marker
→ cron discovers only prepared ready/idle v4 tenants
→ TENANT_DISPATCH inspect/apply/verify
→ control-plane schema promotion only after verification
```

The cron runner does not call the Workers for Platforms administrative upload API and maintenance D1 work does not fall back to D1 REST. A ready storefront continues serving its previous LKG throughout preparation/migration failure. Active imports prevent maintenance discovery/claim.

Final M7C4 production implementation commit:

`0d08daae7d78ea90d62816443b8ab56bde8a13c4`

Trusted-main application deploy:

- run `32685409063` = **SUCCESS**;
- exact tested/deployed SHA matched `0d08daae7d78ea90d62816443b8ab56bde8a13c4`;
- control-plane migrations `0018` and `0019` applied;
- schema target `5`, migration-command contract `1`;
- Worker secret binding names verified without exposing values;
- trusted-CI fleet preparation completed without failure;
- `TENANT_SYNC_AUTOMATION_ENABLED=0` remained enforced;
- default catalog build/smoke stayed valid and private/supplier leak checks remained zero.

Automatic import/CEI production canary:

- run `32685477694` = **SUCCESS**;
- scheduler-owned discovery and Queue processing, zero manual Queue messages;
- fresh isolated tenant schema v5;
- classifier v3 / `professional-v3` and intelligence contract v1;
- verification findings and public/private leaks zero;
- default catalog unchanged and Queue/DLQ backlogs clean.

Dedicated existing-tenant fleet maintenance canary:

- run `32685477736` = **SUCCESS**;
- scheduler-owned, zero manual Queue messages;
- trusted-CI capability preparation used the same production helper;
- success fixture upgraded v4→v5 with exact ledger `1,2,3,4,5` and four private staging tables;
- controlled failure fixture remained v4 with LKG, merchant override and historical onboarding intact;
- active-import fixture remained v4 and received no migration job;
- all fixtures had zero foreign-key findings;
- unrelated-tenant isolation and default catalog preservation passed;
- healthy-run fixtures were cleaned only after the complete proof.

Production defects found and fixed before M7C4 closure:

1. runtime Worker-to-Workers-API preparation was unreachable; ownership moved to trusted deploy CI and maintenance remained binding-native;
2. the fleet canary initially omitted its trusted dispatch namespace when invoking the preparation helper; fail-closed validation caught it;
3. D1 stringifies bound parameters, so the retained-fixture opt-in required explicit integer casts; production-style string-bound regression coverage was added;
4. deploy path ownership did not initially include fleet canary script/test changes; the trusted deploy trigger and regression were corrected.

Failure evidence was retained through diagnosis. After the final production proof, cleanup commit `8640ce3588c410daee2fb1e00b2b0f1e8115247a` ran targeted workflow `32687014275` successfully: all 24 audited historical fleet fixtures were found and removed, with no Queue send/purge operation. `TENANT_SYNC_AUTOMATION_ENABLED` remained `0`.

### M7D1 candidate-state schema v6 — production-proven

M7D1 entered `main` through PR `#123` at commit `50d48c77a7cb3b2e172efe7f338622068b4f2bd4`. The final production-proven application code, including the D1-safe proof-query correction from PR `#125`, is:

`91a931986f1e67948688cefa8b97b09c4345bcac`

PR `#124` added read-only diagnosis for the retained v5/v6 fleet evidence. It did not mutate D1, Workers, Queues or DLQs.

Trusted-main application deploy:

- run `32735164418`, job `97456296604` = **SUCCESS**;
- exact tested/deployed SHA matched `91a931986f1e67948688cefa8b97b09c4345bcac`;
- `95` test files / `488` tests passed on Node 22 after `npm ci` installed 158 packages with zero reported vulnerabilities;
- schema target `6`, migration-command contract `2`;
- Worker version `fc91e925-3e27-42cf-a5b6-5c122c1bc3d0`;
- no control-plane D1 migration remained pending;
- public build verification passed for 17,039 products and 49,046 opaque proxy routes with supplier/private-state leaks at zero;
- `TENANT_IMPORT_AUTOMATION_ENABLED=1` and `TENANT_SYNC_AUTOMATION_ENABLED=0`;
- Queue producers and existing-catalog smoke passed.

Automatic import/CEI regression canary:

- run `32735316780`, job `97456605679` = **SUCCESS** on the exact application SHA;
- scheduler discovered and completed one isolated automatic import without a manual Queue message;
- fresh tenant schema v6, one product/two media, classifier v3 / `professional-v3`, zero verification findings and zero public/private leaks;
- default catalog stayed unchanged and Queue/DLQ backlogs were clean.

Dedicated v5→v6 fleet maintenance canary:

- run `32735316785`, job `97462323561` = **SUCCESS** on the exact application SHA;
- scheduler-owned maintenance and trusted-CI User Worker preparation both executed;
- zero manual Queue messages and recurring sync remained disabled;
- success fixture upgraded v5→v6 in one attempt, retained four v5 listing-stage tables, gained twelve candidate tables, created zero candidate rows and had zero foreign-key findings;
- controlled namespace-mismatch fixture remained ready on v5 with migration status `failed` and safe error `tenant_dispatch_namespace_mismatch`;
- active-import fixture remained ready on v5, received no migration job and stayed excluded from maintenance;
- all three fixtures preserved LKG, merchant override and historical onboarding;
- default catalog preservation and unrelated-tenant isolation passed;
- the canary removed its own new fixtures after the complete proof.

The first v5→v6 fleet run `32732232684` retained its success/failure/blocked fixtures because D1 rejected a compound `UNION ALL` aggregate used only by the proof query (`cloudflare_platform_7500`). The additive migration itself had reached the expected outcomes. Read-only diagnostic run `32735164386`, job `97456121698`, confirmed those outcomes after the proof was changed to twelve bounded simple counts in one D1 batch; no assertion was weakened.

After the newer canary passed, PR `#126` updated the exact cleanup list. Commit `945d0d80ec4d721b62d74e56e2fdd4058969efb7` ran cleanup workflow `32738847875`, job `97468141754` = **SUCCESS**: three audited targets, three removed, zero absent, control state removed, no Queue send/purge path and recurring sync still disabled.

This proves the additive v5→v6 mechanism and representative success/failure/blocked/isolation boundaries. It does not prove that every real tenant is already on v6: the trusted deploy selected zero ordinary tenants for preparation, and no complete live fleet inventory was reopened.

### M7D2 controlled enrollment and scheduling guard — production-proven

M7D2 entered `main` through PR `#129` at commit:

`f49ad81b6dbb64e07e5e7a6b5ab63b0433e00b16`

The PR's ten secret-free validation workflows passed on exact head `6f10d4df55b2ce174c4284430d6d982f52a48b94`; `95` test files / `498` tests passed. Privileged fleet, Queue and automatic-import jobs were correctly skipped in PR context and were not treated as production proof.

Trusted-main application deploy:

- run `32754985570`, job `97520332890` = **SUCCESS** on the exact merged SHA;
- migration `0020_tenant_sync_controlled_enrollment.sql` applied successfully;
- the remote proof found the enrollment table with `0` rows and `0` enrolled sources;
- deployed configuration kept `TENANT_SYNC_AUTOMATION_ENABLED=0`, an empty active cohort and a per-tick cap of `1`;
- Worker version `1e1a7eff-16ae-440a-ba99-e2b2db31562c` was deployed;
- `95` test files / `498` tests, public build/leak verification, Queue producer checks and application smoke passed.

Dedicated tenant data-plane fleet regression canary:

- run `32755082787`, job `97520639483` = **SUCCESS** on the exact application SHA;
- scheduler-owned success/failure/blocked/isolation coverage remained green;
- the success fixture upgraded v5→v6 with twelve candidate tables, zero candidate rows and zero foreign-key findings;
- the controlled failure stayed on v5, the blocked fixture stayed on v5 and the unrelated tenant remained isolated;
- cleanup completed, recurring sync stayed disabled and `manualQueueMessagesProduced=false`.

Automatic import/CEI regression canary:

- run `32755082862`, job `97522279085` = **SUCCESS** on the exact application SHA;
- cron discovered and completed one isolated import without any manual Queue message;
- one product/two media reached schema v6, classifier v3 / `professional-v3`, classification and verification with zero findings or public/private leaks;
- default catalog preservation and clean Queue/DLQ backlogs passed;
- the secret-free validation job was correctly skipped because the event was the trusted deploy's `workflow_run`.

This proves the M7D2 control boundary in production while it is inert: no tenant/source is implicitly enrolled, both global activation and an exact active cohort remain required, selection is capped, and conflicting imports, sync/recovery failures and data-plane migrations are blocked by code and tests. It does **not** prove recurring Intelligent Sync end to end, create a real pilot cohort or authorize changing the recurring-sync flag.

Still not active in production:

- recurring incremental scan execution;
- affected-detail fan-out into private stage;
- affected-only CEI reprocessing;
- staged detail completion/verification;
- verified canonical promotion and cursor advancement;
- repeated-miss removal activation;
- merchant-facing durable change/review feed.

These are the next M7 slices, beginning with M7D3 incremental dispatch and scan-to-stage. The schema/scheduler foundation does not authorize enabling recurring sync early.

## Provider Engine state

Launch provider remains **Yupoo only**.

Provider Engine is source-neutral and central import orchestration consumes provider contracts. Provider-specific structure remains private evidence and does not define public merchandising truth.

A second production provider is not claimed.

## Tenant isolation state

Proven runtime model:

```text
custom hostname
→ trusted tenant resolution
→ Workers for Platforms dispatch
→ isolated tenant User Worker
→ isolated tenant D1
```

Controlled tests cover own-tenant access, cross-tenant/default isolation and fail-closed invalid routing.

## Storefront state

Functional now:

- API-backed catalog/search;
- category/product discovery;
- media gallery;
- responsive foundation;
- Lucide/Motion/Swiper integration;
- CEI-generated public taxonomy/merchandising data;
- public leak guards.

Still later roadmap work:

- Storefront UX 2.0;
- premium navigation/cards/detail;
- deep links/history state;
- loading/empty/error polish;
- browser E2E/a11y/performance;
- SEO/Open Graph/canonical behavior;
- Theme/Brand Engine.

## Customer portal / billing state

Portal scaffolding and merchant-facing model concepts exist, but the complete sellable journey is unfinished.

Still later roadmap work includes:

- production authentication journey;
- end-to-end onboarding UX;
- CEI review experience;
- branding/theme editor;
- custom-domain UX;
- billing/subscription integration;
- entitlement/trial/recovery behavior.

## Explicitly not confirmed

Do not claim without new evidence:

- complete Cloudflare account inventory;
- universal CEI autonomous research;
- a second production provider;
- production Automotive/Fashion/Dental Knowledge Packs;
- every real tenant currently running tenant data-plane schema v6;
- full browser Core Web Vitals/accessibility quality;
- production billing integration;
- public-launch readiness.

## Current execution point

Established production-proven path:

```text
M0 truth/governance
→ M1 safety foundations (partial)
→ M2 code/data separation ✅
→ M3 Design Foundation ✅
→ M4 Provider Engine ✅
→ M5 automatic tenant Queue import ✅ production-proven
→ M6 CEI Core + Sports Knowledge Pack v1 ✅ production-proven
→ M7A–M7D1 sync safety, delta/staging, schema fleet and candidate-state foundations ✅ production-proven
```

Current milestone:

**M7 — Intelligent Sync v2**

M7's primary safety goal is that supplier outages, partial scans, malformed scans or implausible complete-scan volume drops cannot silently destroy a healthy published catalog.

Immediate next slice: M7D3 incremental dispatch and scan-to-stage, still without changing canonical LKG or enabling recurring sync. Then connect affected detail, affected-only CEI, staged verification and verified promotion in separate slices. Recurring sync remains disabled until that complete path and its scheduler-owned production canary exist.

The complete approved M7 slice ledger now lives in `DEVELOPMENT-ROADMAP.md`, with detailed contracts in `TENANT-SYNC.md`. M7D2 is **PRODUCTION GREEN**; M7D3 is **PLANNED — NEXT**; M7D4–M7D11 are planned in order; M7E remains an explicit activation decision. This planning record does not change production behavior or prove any pending slice.

Future macro milestones such as M8 and M9 do not yet have approved A/B subdivisions. Their sub-slices must be proposed and merged through the decomposition protocol immediately before execution; a future contributor may not invent those names or treat a conversational proposal as approved scope.

Then:

```text
M8 Media Engine hardening
→ M9 Storefront UX 2.0
→ M10 Theme/Brand
→ M11 Portal UX
→ M12 CEI Review
→ authentication/billing/onboarding/operations
→ beta
→ release candidate
→ launch
```
