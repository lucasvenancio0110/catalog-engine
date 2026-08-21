# Catalog Engine — Current State

Status: **Living operational truth**  
Snapshot: **2026-08-21 after M6 production closure**  
Purpose: record what is implemented/proven now, separate from durable product contracts and future roadmap work.

## How to use this document

This document owns mutable implementation/deployment truth.

- Product/business invariants remain in focused normative documents.
- Architecture contracts remain in `SAAS-ARCHITECTURE.md`, `TENANCY.md`, `PROVIDER-ENGINE.md`, `CEI.md` and tenant subsystem documents.
- Execution order lives in `DEVELOPMENT-ROADMAP.md`.
- Cross-tool continuation lives in root `CATALOG_ENGINE_HANDOFF_2026-08-20.md`.
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
- **M7 Intelligent Sync v2: current execution milestone**.

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
```

Current milestone:

**M7 — Intelligent Sync v2**

M7's primary safety goal is that supplier outages, partial scans, malformed scans or implausible complete-scan volume drops cannot silently destroy a healthy published catalog.

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
