# Catalog Engine — Current State

Status: **Living operational truth**  
Scope: verified implementation/deployment state after the 2026-08-19 repository and Cloudflare audit.  
Purpose: separate what exists now from durable product contracts and future roadmap decisions.

## How to use this document

This document owns **mutable implementation state**, not durable product intent.

- Product/business invariants remain in their focused normative documents.
- Architecture contracts remain in `SAAS-ARCHITECTURE.md`, `TENANCY.md`, CEI and tenant subsystem documents.
- Future work belongs in `DEVELOPMENT-ROADMAP.md`.
- This file must be updated when a major capability changes from planned/inert to implemented/proven/retired.

Do not leave temporary activation statements inside durable normative documents when the operational truth has changed.

## Audit checkpoint

Audit checkpoint date: **2026-08-19**.

Current repository baseline after the P0 safety merges:

- repository: `lucasvenancio0110/catalog-engine`;
- default branch: `main`;
- application package version: `0.9.0`;
- PR #47 merged: Cloudflare production credentials/actions isolated from ordinary pull-request validation;
- PR #48 merged: public catalog D1 replacement is emitted/applied as one validated atomic publication artifact.

The audit intentionally did **not** prove a complete account-wide Cloudflare inventory. Only resources evidenced through repository configuration, deployment logs and controlled live tests are treated as confirmed here.

## Verified stack

### Frontend / product surfaces

- Vite multi-page build;
- vanilla ES modules / framework-agnostic frontend;
- public storefront rooted in `index.html` / `src/`;
- customer portal rooted in `app.html` / `src/app/`;
- Motion, Swiper and Zod are active dependencies;
- Fuse.js is installed but its current runtime ownership must be revalidated before it remains a permanent storefront-search invariant.

There is no React/Vue/Svelte/Angular application in the current production architecture.

### Engine / ingestion

- Node.js 22+;
- Cheerio for static HTML parsing;
- PQueue for bounded concurrency/backpressure;
- Sharp for image validation/processing;
- Yupoo is the first implemented provider path;
- incremental listing/delta sync logic exists for the original/default catalog;
- tenant queue-based ingestion code exists but production Queue bindings are not yet activated in the committed `wrangler.jsonc`.

### Cloudflare

Confirmed repository/runtime architecture:

- Cloudflare Worker: `catalog-engine`;
- Worker entry: `worker/entry-publish.js`;
- static assets: `dist` via `ASSETS` binding;
- main D1 binding: `CATALOG_DB`;
- D1 database: `catalog-engine-db`;
- Workers for Platforms dispatch namespace: `catalog-engine-production`;
- dispatch binding: `TENANT_DISPATCH`;
- cron: every 5 minutes;
- observability enabled in Wrangler configuration.

Confirmed platform host roles:

- `catalogoengine.com` — platform/marketing domain target;
- `app.catalogoengine.com` — customer portal;
- `edge.catalogoengine.com` — Cloudflare for SaaS technical target defined by architecture/docs;
- `origin.catalogoengine.com` — fallback/internal origin role defined by architecture/docs;
- `teste.loja.catalogoengine.com` — retained validation hostname used to prove custom-hostname routing and tenant isolation.

## Proven tenant isolation checkpoint

The production path has proven:

`custom hostname -> platform Worker -> trusted tenant resolution -> Workers for Platforms dispatch -> isolated tenant Worker -> isolated D1`

A retained smoke tenant demonstrated:

- active custom hostname/TLS;
- dedicated tenant runtime;
- dedicated tenant D1;
- tenant could read its own product;
- tenant could not read a default-tenant product;
- default tenant could not read the smoke-tenant product;
- invalid/missing tenant routing fails closed rather than falling through to the default catalog.

This proves the isolation architecture. It does **not** prove that self-service customer onboarding is complete.

## Current data model

### Control plane

Implemented control-plane concepts include:

- tenant/store identity;
- store profiles/themes;
- memberships/roles;
- source connections;
- domains/provider state;
- provisioning runs/checkpoints;
- data-plane provider state;
- import jobs;
- classification/verification jobs;
- runtime activation state;
- publish jobs;
- audit-oriented state.

Current control-plane migrations run through `0016_tenant_publish_jobs.sql` at this audit checkpoint.

### Tenant data plane

The tenant-only schema is deliberately separated from SaaS control-plane tables and supports concepts including:

- tenant/data-plane identity;
- media sources and product-media mapping;
- catalog products/categories/meta;
- leagues/teams/facets;
- supplier source/index/fingerprints;
- sync runs/events;
- detail processing state;
- classification state;
- durable classification overrides.

The strategic model remains one isolated catalog data plane per store/tenant.

## Catalog publication safety

The original/default public catalog currently contains roughly 17k products and tens of thousands of media references.

PR #48 changed the destructive public-catalog replacement path so that:

- exactly one public publication SQL artifact is generated;
- individual SQL statements are size-validated;
- application SQL may not contain explicit transaction-control statements for this path;
- trusted workflows require exactly one public publication file;
- the production-sized artifact was executed successfully against local D1 via Wrangler before merge.

Private media/index delta chunking is a separate concern and was intentionally not collapsed by that P0 fix.

## What is implemented but not yet product-complete

### Customer portal

`src/app/` exists and already models merchant-facing states/entitlement concepts, but the complete sellable journey is not finished.

Missing or incomplete productization includes:

- production identity-provider configuration/journey;
- complete onboarding UX;
- customer-facing source/import progress;
- catalog review experience;
- theme/branding editor;
- domain setup UX wired end-to-end;
- billing/subscription UI backed by a real billing provider;
- polished responsive design system across all portal states.

### Tenant import

Code and durable state exist for queue-oriented tenant import stages, but production queue infrastructure is not yet activated.

The target remains:

`scan -> details -> finalize -> classify -> verify`

with tenant-private source evidence and isolated D1 persistence.

### CEI

The durable CEI product contract is broader than the current implementation.

Current implementation should be considered **CEI foundation / classifier v1**, centered on sports-oriented normalization, known teams/leagues/facets, classification state and overrides.

Not yet complete relative to `CEI.md`:

- general source-neutral evidence schema across providers;
- explicit Knowledge Pack interface;
- calibrated field-level confidence engine;
- generalized semantic conflict engine;
- governed global/supplier/tenant knowledge stores;
- autonomous concept research pipeline;
- domain-pack discovery/learning;
- image-model escalation;
- reusable non-sports packs.

Launch scope should implement a strong **Sports Knowledge Pack v1** on top of a source-neutral CEI core rather than pretending universal CEI is already production-ready.

## Storefront state

The storefront is functional and already has:

- API-backed catalog behavior;
- categories/product discovery;
- media gallery;
- lazy images/prefetch behavior;
- responsive CSS foundation;
- Motion/Swiper integration;
- white-label/public-data leak guards.

It is **not yet the launch-quality design target**.

Major remaining product work includes:

- unified design system/tokens;
- full responsive behavior contract;
- premium product cards/product detail/navigation;
- deep-link/URL-state behavior;
- loading/empty/error states;
- accessibility/E2E browser validation;
- SEO/Open Graph/canonical polish;
- domain-aware merchandising UX;
- controlled theme/brand engine.

## Billing state

Billing is currently a product/architecture contract, not a completed production subsystem.

Before commercial launch the platform still needs:

- provider selection;
- normalized billing customer/subscription state;
- trusted webhook/reconciliation processing;
- entitlement engine integration;
- trial/payment policy decision;
- grace/suspension/reactivation behavior;
- portal billing recovery UX.

No frontend success screen may become authoritative billing truth.

## Security / CI state

Confirmed improvements:

- ordinary PR validation no longer executes the targeted live Cloudflare production jobs from PR context;
- production-live Cloudflare checks require trusted/manual paths as defined by the updated workflows;
- public catalog publication now has an atomic import boundary.

Important remaining work:

- protect `main` with required checks/review policy;
- pin or deliberately govern third-party Action versions;
- split application deployment from catalog data publication;
- prevent routine sync automation from direct-pushing business-data snapshots to `main`;
- validate production D1 migration parity independently;
- formalize rollback/backup/recovery runbooks;
- harden media proxy redirects/timeout/size limits;
- add statistical catastrophic-sync circuit breakers;
- add browser E2E/accessibility testing.

## Explicitly not confirmed by the 360° audit

Do not claim these as proven without new evidence:

- complete Cloudflare account inventory across every Worker/Pages/KV/R2/Queue/Workflow/Durable Object/DNS resource;
- exact live production D1 schema parity with every repository migration;
- full Core Web Vitals/accessibility quality in real browsers;
- production Queue ingestion for customer tenants;
- production billing provider integration;
- universal CEI domain learning/research.

## Current highest-priority path

The approved next sequence is:

1. post-audit documentation realignment;
2. separate application deploy from catalog publication;
3. protect `main` and finish production-safety controls;
4. establish design/library/responsive foundation;
5. formalize provider/source-neutral evidence boundary;
6. activate and prove tenant queue ingestion;
7. build CEI core + Sports Knowledge Pack v1;
8. harden intelligent sync/media;
9. rebuild storefront/theme experience;
10. complete portal/auth/billing/onboarding/domain self-service;
11. observability/security/performance/E2E;
12. closed beta -> release candidate -> public launch.

The detailed execution order and gates live in `DEVELOPMENT-ROADMAP.md`.
