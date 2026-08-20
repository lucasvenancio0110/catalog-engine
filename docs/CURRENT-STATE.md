# Catalog Engine — Current State

Status: **Living operational truth**  
Scope: verified implementation/deployment state after the 2026-08-19 audit and the post-audit safety/design/provider milestones.  
Purpose: separate what exists now from durable product contracts and future roadmap decisions.

## How to use this document

This document owns **mutable implementation state**, not durable product intent.

- Product/business invariants remain in their focused normative documents.
- Architecture contracts remain in `SAAS-ARCHITECTURE.md`, `TENANCY.md`, `PROVIDER-ENGINE.md`, CEI and tenant subsystem documents.
- Future work belongs in `DEVELOPMENT-ROADMAP.md`.
- This file must be updated when a major capability changes from planned/inert to implemented/proven/retired.

Do not leave temporary activation statements inside durable normative documents when operational truth has changed.

## Repository baseline

Current repository:

- repository: `lucasvenancio0110/catalog-engine`;
- default branch: `main`;
- application package version: `0.9.0`;
- Node.js: 22+;
- frontend: Vite + vanilla ES modules;
- no React/Vue/Svelte/Angular production application.

Post-audit milestones now implemented in the repository include:

- PR #47 — Cloudflare production credentials/actions isolated from ordinary pull-request validation;
- PR #48 — public catalog D1 replacement emitted/applied as one validated atomic publication artifact;
- PR #49 — post-audit current-state, roadmap and responsive/design-system contracts established;
- PR #50 — ordinary application deployment separated from catalog business-data publication;
- PR #51 — shared responsive/accessibility frontend foundation;
- PR #52 — Lucide icon system, dependency hardening, Fuse removal and frontend bundle reporting;
- M4 Provider Engine — source/provider-neutral source connection and isolated-ingestion boundary with Yupoo as the first adapter;
- M5 activation prerequisites — real Queue/DLQ resources, dedicated consumers, main producer bindings, manual one-tenant/two-tenant Queue ingestion, retry/DLQ recovery and read-only production preflight have been established while automatic discovery remained OFF.

The audit intentionally did **not** prove a complete account-wide Cloudflare inventory. Only resources evidenced through repository configuration, deployment logs and controlled live tests are treated as confirmed here.

## Production safety implemented

### Cloudflare credential boundary

Ordinary pull requests no longer receive the targeted production Cloudflare credentials through the previously audited privileged workflow paths.

### Atomic public catalog publication

The default public catalog replacement path generates one bounded SQL publication artifact. The production-sized artifact has been exercised against local D1 through Wrangler before trusted publication.

### Code/data deployment separation

`.github/workflows/deploy-catalog-api.yml` owns application/schema deployment:

`quality -> build -> build:verify -> remote schema migrations -> Worker/assets deploy -> smoke existing catalog`

It does not rebuild or replace commercial catalog business data.

`.github/workflows/publish-default-catalog.yml` owns deliberate manual publication of the checked-in sanitized default snapshot. Source-driven sync/recovery workflows own their own catalog-data changes.

Changing application CSS or Worker code therefore does not imply a 17k-product catalog replacement.

### Remaining repository-control gap

`main` has been observed through GitHub metadata as not protected by a branch-protection/ruleset. CI gates exist in repository code, but repository-level required-check/review enforcement remains an M1 debt until it can be configured and independently verified.

## Public/default catalog baseline

The current checked-in/default compatibility catalog is repeatedly verified at approximately:

- 16,953 products;
- 9 leagues;
- 51 teams;
- 14 facets;
- 48,876 checked image/proxy routes.

`build:verify` checks include:

- opaque public IDs;
- no supplier-host leak in the public artifact;
- no private sync state in public artifacts;
- valid JS/CSS bundles;
- edge-proxy media mode.

These counts describe the current default dataset, not a platform limit or permanent commercial contract.

## Frontend / design baseline

M3 established a shared brand-neutral responsive/accessibility foundation used by the storefront and customer portal while preserving separate merchant-vs-platform visual identities.

Implemented decisions include:

- shared design tokens/foundation CSS;
- intrinsic responsive grid behavior and safe-area handling;
- focus/touch/reduced-motion baseline;
- Lucide iconography with separate storefront/portal packs;
- Motion for purposeful microinteractions;
- Swiper for product media gallery;
- API/server-backed storefront search;
- removal of the unused Fuse.js client-search helper/dependency;
- fixed reviewed versions for Lucide/Motion/Swiper/Vite rather than mutable `latest` specs;
- frontend CI with quality/build/build-verify and deterministic raw/gzip bundle reporting.

An isolated Cloudflare UI staging preview also exists for visual validation against demo data without touching production catalog data. It is a preview/testing surface, not a customer tenant or production-data source.

Full Storefront UX 2.0 and Portal UX 2.0 remain later roadmap milestones.

## Provider Engine baseline

M4 establishes a real source/provider boundary rather than a decorative interface.

Implemented:

- shared `CatalogProvider` registry and contract validation;
- source-provider auto-detection/normalization;
- provider-neutral tenant source connection orchestration;
- provider-neutral scan/detail/finalize consumers;
- normalized scan/detail evidence validation before central orchestration accepts provider output;
- provider-owned category/media identity derivation;
- provider-owned public-text leak signatures;
- provider-neutral private network-verification resolver;
- Yupoo adapter wrapping the existing hardened listing/detail implementations;
- compatibility tests proving existing Yupoo category/media opaque identity seeds are preserved;
- architecture regression tests preventing central ingestion consumers from directly importing Yupoo parser modules.

Launch provider remains **Yupoo only**. The architecture can register another provider without changing central ingestion/CEI semantics, but no second production connector is claimed.

Provider-specific source knowledge remains private evidence. It is not public taxonomy truth and it does not redefine CEI merchandising semantics.

## Tenant import / Queues

Durable code/state exists for:

`scan -> details -> finalize -> classify -> verify`

The scan/detail/finalize consumers resolve the registered provider from tenant-private source state and write through the isolated tenant data-plane command/native D1 path.

M5 production prerequisites already proven on trusted infrastructure include:

- real `catalog-engine-import-scan` and `catalog-engine-import-detail` Queues;
- dedicated scan/detail DLQs;
- exactly one dedicated consumer Worker on each primary Queue;
- main Worker producer bindings for scan and detail/finalize dispatch;
- conservative retry/concurrency/backoff policy;
- one controlled isolated tenant import through real Queues;
- simultaneous two-tenant import with cross-tenant isolation checks;
- retry exhaustion -> DLQ -> repair -> replay recovery proof;
- clean read-only production activation preflight while `TENANT_IMPORT_AUTOMATION_ENABLED=0`.

The remaining M5 boundary is the deliberate automatic scheduler activation. The activation change sets `TENANT_IMPORT_AUTOMATION_ENABLED=1`, but M5 must remain open until trusted production evidence proves the five-minute cron discovers an eligible canary tenant itself, produces the initial scan message, completes the Queue-driven isolated import and returns all Queue/DLQ backlogs to a clean state without manually producing that initial message.

Do not describe automatic customer Queue ingestion as production-ready until that final scheduler-driven canary proof exists.

## Cloudflare baseline proven previously

Repository/Actions evidence has proven use of:

- main Worker `catalog-engine`;
- static assets through the `ASSETS` binding;
- D1 `catalog-engine-db` / `CATALOG_DB` compatibility/control binding;
- Workers for Platforms dispatch namespace `catalog-engine-production`;
- `TENANT_DISPATCH` binding;
- tenant User Worker/data-plane provisioning flows;
- runtime dispatch/isolation tests;
- custom hostname/domain workflows;
- tenant import scan/detail Queues and their DLQs;
- dedicated Queue consumer Workers and main producer bindings;
- application smoke paths;
- isolated UI preview Worker/staging path.

Platform host roles include:

- `catalogoengine.com` — platform/marketing target;
- `app.catalogoengine.com` — customer portal;
- `edge.catalogoengine.com` — Cloudflare for SaaS technical target defined by architecture/docs;
- `origin.catalogoengine.com` — fallback/internal origin role defined by architecture/docs;
- `teste.loja.catalogoengine.com` — retained validation hostname used in custom-hostname isolation proof.

This is **not** a complete account-wide Cloudflare inventory claim.

## Proven tenant isolation checkpoint

The production architecture has proven:

`custom hostname -> platform Worker -> trusted tenant resolution -> Workers for Platforms dispatch -> isolated tenant Worker -> isolated D1`

A smoke tenant demonstrated:

- active custom hostname/TLS;
- dedicated tenant runtime;
- dedicated tenant D1;
- own-product read succeeds;
- cross-tenant/default-product reads fail;
- invalid/missing tenant routing fails closed rather than falling through to the default catalog.

This proves the isolation architecture, not complete self-service onboarding.

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

Some private table/queue field names remain Yupoo-era (`supplier_album_*`, `albumSourceId`) for compatibility. M4 makes orchestration provider-neutral without performing destructive schema renames. Generalization can happen through a deliberate migration when a real second provider proves it necessary.

The strategic model remains one isolated catalog data plane per store/tenant.

## CEI baseline

The repository contains sports-oriented normalization/classification and tenant classification state/override infrastructure. The long-term `CEI.md` contract is broader than current implementation.

Current implementation should be considered **CEI foundation / classifier v1**.

M4 now gives CEI the source-neutral provider boundary it needs, but M6 still owns the actual CEI Core + Sports Knowledge Pack v1 work, including:

- normalized CEI evidence model;
- Knowledge Pack interface;
- calibrated confidence/conflict representation;
- merchant overrides/effective view integration;
- verification/merchandising output;
- tenant memory boundary;
- regression fixtures.

Universal autonomous research and non-sports production Knowledge Packs are not launch requirements.

## Storefront state

The storefront is functional and has:

- API-backed catalog behavior/search;
- category/product discovery;
- media gallery;
- lazy images/prefetch behavior;
- responsive CSS foundation;
- Lucide/Motion/Swiper integration;
- white-label/public-data leak guards.

It is **not yet the launch-quality design target**.

Major later work includes:

- full Storefront UX 2.0;
- premium product cards/detail/navigation;
- deep-link/URL state;
- skeleton/loading/empty/error polish;
- browser accessibility/E2E validation;
- SEO/Open Graph/canonical behavior;
- CEI/domain-aware merchandising UX;
- controlled Theme/Brand Engine.

## Customer portal state

`src/app/` exists and models merchant-facing states/entitlement concepts, but the complete sellable journey is unfinished.

Still incomplete:

- production identity-provider journey;
- end-to-end onboarding UX;
- customer-facing source/import progress;
- CEI review experience;
- theme/branding editor;
- domain setup UX wired end-to-end;
- billing/subscription UI backed by a real provider;
- final Portal UX 2.0.

## Billing state

Billing remains a product/architecture contract rather than a completed production subsystem.

Before commercial launch the platform still needs:

- billing provider selection;
- normalized billing customer/subscription state;
- trusted webhook/reconciliation processing;
- entitlement integration;
- trial/payment policy decision;
- grace/suspension/reactivation behavior;
- portal billing recovery UX.

No frontend success state is authoritative billing truth.

## Security / reliability debt still open

Important remaining work includes:

- protect `main` with required checks/review policy;
- pin or deliberately govern third-party GitHub Action versions;
- independently verify production D1 migration parity;
- formalize code/data backup, rollback and recovery runbooks;
- govern retained smoke/test resources;
- complete and retain evidence for the scheduler-driven M5 Queue activation canary;
- add catastrophic sync-diff protection;
- harden media redirect/timeout/byte limits;
- add browser E2E/accessibility/performance validation;
- stop routine business-data automation from direct-pushing snapshots where any such path remains.

## Explicitly not confirmed

Do not claim these as proven without new evidence:

- complete Cloudflare account inventory across every Worker/Pages/KV/R2/Queue/Workflow/Durable Object/DNS resource;
- exact live production D1 schema parity with every repository migration;
- full Core Web Vitals/accessibility quality in real browsers;
- production Queue ingestion for customer tenants after automatic scheduler activation;
- production billing integration;
- universal CEI domain learning/research;
- a second production source provider.

## Current execution point

Completed/established post-audit path:

`M0 truth/governance -> M1 safety foundations -> M2 code/data separation -> M3 Design Foundation -> M4 Provider Engine`

Current execution milestone:

`M5 Tenant Import / Cloudflare Queue activation — final scheduler-driven canary pending`

Then:

`M6 CEI Core + Sports Knowledge Pack -> M7 intelligent sync -> M8 media hardening -> M9+ storefront/theme/portal/commercial productization -> beta -> release candidate -> launch`

The detailed execution order and gates live in `DEVELOPMENT-ROADMAP.md`.
