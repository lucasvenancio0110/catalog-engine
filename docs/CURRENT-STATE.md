# Catalog Engine — Current State

Status: **Living operational truth**  
Scope: verified implementation/deployment state after the 2026-08-19 audit and M5 production closure on 2026-08-20.  
Purpose: separate what exists now from durable product contracts and future roadmap decisions.

## How to use this document

This document owns **mutable implementation state**, not durable product intent.

- Product/business invariants remain in focused normative documents.
- Architecture contracts remain in `SAAS-ARCHITECTURE.md`, `TENANCY.md`, `PROVIDER-ENGINE.md`, CEI and tenant subsystem documents.
- Future work belongs in `DEVELOPMENT-ROADMAP.md`.
- Full cross-tool continuity is captured in the root `CATALOG_ENGINE_HANDOFF_2026-08-20.md`.
- This file must change when a major capability moves from planned/inert to implemented/proven/retired.

Do not leave temporary activation statements inside durable normative documents after operational truth changes.

---

## Repository baseline

Current repository:

- repository: `lucasvenancio0110/catalog-engine`;
- default branch: `main`;
- application package version: `0.9.0`;
- Node.js: 22+;
- frontend: Vite + vanilla ES modules;
- no React/Vue/Svelte/Angular production application.

Major milestones established:

- M1 safety foundations are partial;
- M2 application deploy / catalog publication separation is complete;
- M3 Design Foundation is complete;
- M4 Provider Engine is complete;
- **M5 Tenant Import / Cloudflare Queue activation is complete and production-proven**;
- **M6 CEI Core + Sports Knowledge Pack v1 is the current execution milestone**.

Important post-audit PR lineage includes PRs #47-#52 for safety/deploy/design foundations and PRs #65-#75 for the final M5 activation/canary/rollback/diagnostic/fix/cleanup sequence.

The audit intentionally did **not** prove a complete account-wide Cloudflare inventory. Only resources evidenced through repository configuration, deployment logs and controlled live tests are treated as confirmed here.

---

## Production safety implemented

### Cloudflare credential boundary

Ordinary pull requests do not receive the targeted production Cloudflare credentials through privileged workflow paths. PR validation is secret-free; production reads/mutations happen from trusted `main` or deliberate privileged dispatches.

### Atomic public catalog publication

The default public catalog replacement path generates one bounded SQL publication artifact and is separated from ordinary application deployment.

### Code/data deployment separation

`.github/workflows/deploy-catalog-api.yml` owns application/schema deployment:

```text
quality
→ build
→ build:verify
→ remote schema migrations
→ Worker/assets deploy
→ Queue producer/automation verification
→ smoke existing catalog
```

It does not rebuild or replace commercial catalog business data.

`.github/workflows/publish-default-catalog.yml` owns deliberate publication of the checked-in sanitized default snapshot. Source-driven sync/recovery workflows own their own catalog-data changes.

### Remaining M1 repository-control gaps

Still open:

- branch protection / required checks / deliberate review enforcement;
- direct-push sync-bot governance;
- third-party Actions/toolchain governance;
- production migration parity verification;
- backup/rollback/recovery runbooks.

---

## Public/default catalog baseline

Latest trusted application deploy verification during M5 closure reported:

- **17,018 products**;
- **49,004 checked proxy routes**;
- supplier leak: false;
- private state published: false;
- opaque public IDs: true;
- media storage mode: `edge-proxy`.

These counts describe the current default dataset at that checkpoint, not a platform limit or permanent commercial contract.

---

## Frontend / design baseline

M3 established a shared brand-neutral responsive/accessibility foundation used by the storefront and customer portal while preserving merchant-vs-platform visual separation.

Implemented decisions include:

- shared design tokens/foundation CSS;
- intrinsic responsive grid and safe-area behavior;
- focus/touch/reduced-motion baseline;
- Lucide iconography;
- Motion for purposeful microinteractions;
- Swiper for product media;
- API/server-backed storefront search;
- reviewed dependency versions rather than mutable `latest` specs;
- deterministic bundle reporting in CI.

Full Storefront UX 2.0 and Portal UX 2.0 remain later roadmap milestones.

---

## Provider Engine baseline

M4 establishes a real source/provider boundary rather than a decorative interface.

Implemented:

- shared `CatalogProvider` registry/contract validation;
- source-provider auto-detection/normalization;
- provider-neutral tenant source connection orchestration;
- provider-neutral scan/detail/finalize consumers;
- normalized scan/detail evidence validation;
- provider-owned category/media identity derivation;
- provider-owned public-text leak signatures;
- provider-neutral private network-verification resolver;
- Yupoo adapter around hardened listing/detail implementations;
- compatibility tests preserving existing opaque identity behavior;
- regression guards preventing central ingestion from directly depending on Yupoo parser modules.

Launch provider remains **Yupoo only**. A second production connector is not claimed and is not part of M6.

Provider-specific source structure is private evidence, not public merchandising truth.

---

## Tenant import / Queues — M5 COMPLETE

Durable runtime path:

```text
scheduler
→ scan Queue
→ scan consumer
→ detail Queue
→ detail consumer
→ finalize barrier
→ classify
→ verify
```

The scan/detail/finalize consumers resolve the registered provider from tenant-private source state and write through the isolated tenant data-plane path.

### Confirmed production resources

Primary Queues:

- `catalog-engine-import-scan`;
- `catalog-engine-import-detail`.

DLQs:

- `catalog-engine-import-scan-dlq`;
- `catalog-engine-import-detail-dlq`.

Dedicated consumers:

- `catalog-engine-import-scan`;
- `catalog-engine-import-detail`.

Main Worker producers:

- `TENANT_IMPORT_QUEUE` -> scan Queue;
- `TENANT_IMPORT_DETAIL_QUEUE` -> detail Queue.

Automatic discovery:

- cron `*/5 * * * *`;
- `TENANT_IMPORT_AUTOMATION_ENABLED="1"` at M5 closure.

### Real happy-path / isolation proof

Trusted Queue smoke previously proved:

- isolated D1 import;
- User Worker dispatch;
- one-tenant import;
- simultaneous two-tenant import;
- cross-tenant isolation;
- product/media publication.

Historical run: `32338235562`.

### Real resilience proof

Trusted resilience smoke proved:

```text
controlled failure
→ real retries
→ DLQ
→ no premature tenant mutation
→ repair
→ replay same message
→ products/media recovered
→ finalize
→ primary + DLQ backlogs return to zero
```

Historical run: `32338762195`.

### Final automatic scheduler proof

M5 final commit:

`b917b023fde537baa0aa797d1230b7df7db5595e`

Application deploy:

- run `32392783507`;
- `catalog-engine/application-deploy = success`;
- Worker version `a7923901-3463-44ac-b8f5-c4ba61804b9e`;
- automation `1`;
- producers/consumers intact;
- 298 tests passed.

Automatic canary:

- run `32392875597`;
- job `96502874428`;
- `catalog-engine/tenant-import-auto-canary = success`.

Evidence:

```text
manualQueueMessagesProduced = false
schedulerDiscovered = true
schedulerAttemptCount = 1
discovered = 1
completed = 1
deferred = 0
published = 1
tenant products = 1
tenant media = 2
supplier leaks = 0
import provisioning step = success
provisioning advanced to classify
default catalog unchanged = true
Queue/DLQ backlogs clean = true
```

This satisfies the M5 Definition of Done:

```text
create tenant
→ connect supported source
→ isolated D1 import completes automatically
```

without one GitHub Action or manual Cloudflare operation per customer.

### Important M5 regression lessons

Do not regress these fixes:

1. `TENANT_IMPORT_AUTOMATION_ENABLED` is an operational `0|1` bit; OFF remains a valid rollback state.
2. Queue consumers must tolerate the scheduler race where a message can arrive while the control job is still `pending`; retry instead of failing.
3. Production canary runs after a successful application deploy via `workflow_run`, not in parallel with deploy.
4. Tenant User Worker identity is canonical `ce-<tenant suffix>`; canaries must use the same resolver convention as the hot path.
5. Historical OFF-only preflight/smoke proofs should not be weakened just because production automation is now ON.
6. Never purge global Queues simply to make a canary pass.

---

## Cloudflare baseline proven

Repository/Actions evidence confirms use of:

- main Worker `catalog-engine`;
- static assets through `ASSETS`;
- D1 `catalog-engine-db` / `CATALOG_DB`;
- Workers for Platforms dispatch namespace `catalog-engine-production`;
- `TENANT_DISPATCH` binding;
- isolated tenant User Worker/data-plane provisioning;
- runtime dispatch/isolation;
- custom hostname/domain workflows;
- scan/detail Queues and DLQs;
- dedicated Queue consumers and main producers;
- application smoke paths.

Known platform host roles include:

- `catalogoengine.com` — platform/marketing target;
- `app.catalogoengine.com` — customer portal;
- `edge.catalogoengine.com` — Cloudflare for SaaS technical role documented by architecture;
- `origin.catalogoengine.com` — fallback/internal origin role documented by architecture.

This is **not** a complete account-wide Cloudflare inventory claim.

---

## Proven tenant isolation checkpoint

Architecture proven:

```text
custom hostname
→ platform Worker
→ trusted tenant resolution
→ Workers for Platforms dispatch
→ isolated tenant Worker
→ isolated D1
```

Controlled tests have demonstrated own-tenant access, cross-tenant/default isolation and fail-closed invalid routing.

---

## Data model baseline

### Control plane

Implemented concepts include:

- tenant/store identity;
- profiles/themes;
- memberships/roles;
- source connections/provider state;
- domains;
- provisioning runs/checkpoints;
- data-plane provider state;
- import/classification/verification/runtime/publish jobs;
- audit-oriented state.

### Tenant data plane

The isolated tenant schema supports concepts including:

- tenant/data-plane identity;
- media sources/product-media mapping;
- catalog products/categories/meta;
- leagues/teams/facets;
- private supplier source/index/fingerprint state;
- sync runs/events;
- detail processing state;
- classification state;
- durable classification overrides.

Some private field/table names still reflect Yupoo-era compatibility. Do not perform destructive renames without a real migration need.

---

## CEI baseline — CURRENT MILESTONE M6

The repository already contains sports-oriented normalization/classification and tenant classification state/override infrastructure. Treat this as **CEI foundation / classifier v1**, not finished CEI Core.

M4 provides the source-neutral provider/evidence boundary and M5 now provides automatic isolated ingestion. M6 owns the next layer:

- normalized CEI evidence model;
- context/domain detection;
- Knowledge Pack interface;
- entity/attribute resolution;
- calibrated confidence;
- semantic conflicts;
- versioned classification;
- merchant overrides/effective-view semantics;
- verification/merchandising output;
- tenant memory boundary;
- schema-validated persistence;
- regression fixtures.

Sports Knowledge Pack v1 must cover competitions/leagues, clubs, national teams, product types, audience/version/style, reliable season/year evidence, ambiguity rules, merchandising hierarchy and review thresholds.

Universal autonomous research and non-sports production Knowledge Packs are not launch requirements.

---

## Storefront state

Functional today:

- API-backed catalog/search;
- category/product discovery;
- media gallery;
- responsive CSS foundation;
- Lucide/Motion/Swiper integration;
- public-data leak guards.

Not yet launch-quality target:

- Storefront UX 2.0;
- premium cards/detail/navigation;
- deep links/URL state;
- loading/empty/error polish;
- browser a11y/E2E/performance;
- SEO/Open Graph/canonical behavior;
- CEI-aware merchandising UX;
- Theme/Brand Engine.

---

## Customer portal state

`src/app/` exists and models merchant-facing state/entitlement concepts, but the complete sellable journey remains unfinished.

Still incomplete:

- production identity-provider journey;
- end-to-end onboarding UX;
- customer-facing source/import progress;
- CEI review experience;
- theme/branding editor;
- domain setup UX end-to-end;
- real billing/subscription integration;
- final Portal UX 2.0.

---

## Billing state

Billing remains architecture/product contract, not completed production subsystem.

Still needed:

- provider selection;
- normalized customer/subscription state;
- trusted webhook/reconciliation;
- entitlements;
- trial/payment policy;
- grace/suspension/reactivation;
- portal recovery UX.

No frontend success state is authoritative billing truth.

---

## Security / reliability debt still open

- protect `main` with required checks/review policy;
- govern/pin third-party Actions deliberately;
- verify production D1 migration parity;
- formalize backup/rollback/recovery runbooks;
- decide lifecycle of retained M5 diagnostic workflows after evidence is safely documented;
- catastrophic sync-diff circuit breaker;
- media redirect/timeout/byte hardening;
- browser E2E/accessibility/performance;
- stop/govern routine direct-push business-data automation where applicable;
- fleet-level observability.

---

## Explicitly not confirmed

Do not claim without new evidence:

- complete Cloudflare account inventory;
- exact live schema parity with every repository migration;
- full browser Core Web Vitals/accessibility quality;
- production billing integration;
- universal CEI research/learning;
- a second production provider.

Do not list automatic tenant Queue ingestion here: **that capability is now production-proven by M5**.

---

## Current execution point

Established path:

```text
M0 truth/governance
→ M1 safety foundations (partial)
→ M2 code/data separation ✅
→ M3 Design Foundation ✅
→ M4 Provider Engine ✅
→ M5 automatic tenant Queue import ✅ production-proven
```

Current execution milestone:

**`M6 — CEI Core + Sports Knowledge Pack v1`**

Then:

```text
M7 intelligent sync
→ M8 media hardening
→ M9+ storefront/theme/portal/commercial productization
→ beta
→ release candidate
→ launch
```

The detailed execution order and gates live in `DEVELOPMENT-ROADMAP.md`.