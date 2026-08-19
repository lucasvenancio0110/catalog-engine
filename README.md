# Catalog Engine

Catalog Engine is a white-label B2B SaaS platform that transforms an authorized product source into a professional merchant storefront under the merchant's own brand/domain, then keeps that catalog synchronized automatically.

The product is not a "Yupoo importer" and is not a one-off website generator. Yupoo is the first major source connector; the architecture is being built around source-neutral ingestion, Catalog Engine Intelligence (CEI), isolated tenant data planes and automated publication/synchronization.

## Product flow

The intended self-service journey is:

`account/entitlement -> create store -> connect source -> isolated import -> CEI/classify -> verify/private preview -> appearance -> runtime/domain readiness -> publish -> Intelligent Sync`

The exact commercial gate for launch (payment-before-store vs controlled trial entitlement) is an explicit product decision tracked in `docs/DEVELOPMENT-ROADMAP.md`; durable billing rules remain in the billing/sales contracts until changed deliberately.

## Platform identity

- `catalogoengine.com` — Catalog Engine marketing/company surface;
- `app.catalogoengine.com` — authenticated customer administration;
- `edge.catalogoengine.com` — technical Cloudflare for SaaS CNAME target;
- customer-owned verified domain — public merchant storefront.

Paid/public merchant storefronts are white-label and should not expose supplier identity or require Catalog Engine branding.

## Current architecture

Catalog Engine uses two logical planes.

### Control plane

Owns low-volume SaaS state such as:

- tenant/store identity;
- memberships/roles;
- profile/branding;
- source connections;
- domains/provider state;
- provisioning checkpoints;
- data-plane/runtime locator state;
- import/classify/verify/runtime/publish job state;
- audit-oriented state;
- future normalized billing/entitlements.

### Tenant data plane

Owns the high-volume/private catalog state for one merchant store, including:

- normalized products;
- canonical categories;
- teams/leagues/facets;
- product/media mappings;
- private supplier/source index and fingerprints;
- sync state/events;
- classification state and durable overrides;
- media proxy registry.

The strategic model is one isolated catalog data plane per tenant/store rather than one giant shared public catalog filtered only by `tenant_id`.

## Proven production boundary

The repository/prod path has already proven:

`custom hostname -> platform Worker -> trusted tenant resolution -> Workers for Platforms dispatch -> isolated tenant Worker -> isolated D1`

The production dispatch namespace is `catalog-engine-production`, and `wrangler.jsonc` binds it as `TENANT_DISPATCH`.

The retained smoke tenant proved cross-tenant product access fails closed in both directions. This proves the isolation primitive; it does not mean the full self-service customer journey is finished.

See `docs/CURRENT-STATE.md` for the audited implementation truth.

## Catalog Engine Intelligence

CEI is the proprietary intelligence layer for understanding, validating, classifying and merchandising normalized catalog evidence.

The long-term CEI contract includes domain/context detection, Knowledge Packs, confidence/evidence, conflict handling, learning/research and tenant-scoped memory.

The launch roadmap deliberately narrows implementation to a strong source-neutral CEI Core plus **Sports Knowledge Pack v1** before expanding into other retail domains.

## Supplier/source philosophy

The supplier/source is private ingestion evidence, not public storefront truth.

Raw provider taxonomy/IDs/URLs remain private. Catalog Engine produces canonical merchant-facing names/categories/entities/facets and sends ambiguous cases to review rather than confidently guessing.

## Intelligent Sync

Routine sync is incremental:

1. lightweight source listing scan;
2. compare private fingerprints/state;
3. detect NEW/CHANGED/MOVED/RESTORED and safe removal signals;
4. fetch detail only for the delta/retry queue;
5. reclassify affected products/knowledge where needed;
6. verify the effective catalog;
7. promote state only after success.

Partial scans never infer deletion. The launch roadmap also requires a catastrophic-diff/suspicious-run circuit breaker so an abnormal scan cannot silently remove most of a healthy catalog.

## Store provisioning

Provisioning is idempotent and resumable. The canonical product-level order is:

`entitlement -> tenant -> profile -> source -> data plane -> migrations -> import -> classification -> storefront verification/private preview -> runtime/domain readiness -> publish`

A failed step resumes safely from durable checkpoints instead of restarting the whole import.

## Hosting direction

- **GitHub** — source, review and CI/CD; never one repository per customer.
- **Cloudflare Workers** — platform APIs/routing/media/orchestration.
- **Workers for Platforms** — isolated tenant Workers + dynamic dispatch.
- **Cloudflare for SaaS** — customer-owned custom domains.
- **Cloudflare D1** — control-plane state and isolated tenant catalog data planes.
- **R2 / Cloudflare Images / validated remote proxy+cache** — media strategies selected deliberately by reliability/cost/transform needs.
- **Queues / durable jobs** — tenant ingestion/synchronization/background operations at scale.

Customers should not need GitHub or Cloudflare accounts to operate their stores.

## Frontend / design direction

Current frontend architecture is Vite + browser ES modules without React/Vue/Svelte/Angular.

The post-audit roadmap includes a full **Design Foundation** and **Storefront/Portal UX 2.0** rather than a late CSS facelift:

- design tokens/primitives;
- library ownership review;
- responsive system;
- premium storefront/product experience;
- customer portal/onboarding/domain/billing UX;
- theme/brand engine;
- accessibility;
- browser E2E;
- performance budgets.

See `docs/DESIGN-SYSTEM.md` and `docs/DEVELOPMENT-ROADMAP.md`.

## Documentation map

Start with:

- [`AGENTS.md`](AGENTS.md) — engineering/repository rules;
- [`docs/DOCUMENT-GOVERNANCE.md`](docs/DOCUMENT-GOVERNANCE.md) — documentation governance;
- [`docs/DOCUMENT-MAP.md`](docs/DOCUMENT-MAP.md) — required documents per change;
- [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md) — audited implementation truth;
- [`docs/DEVELOPMENT-ROADMAP.md`](docs/DEVELOPMENT-ROADMAP.md) — ordered milestones to launch;
- [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) — responsive/product UX contract;
- [`docs/CEI.md`](docs/CEI.md) — Catalog Engine Intelligence contract;
- [`docs/SAAS-ARCHITECTURE.md`](docs/SAAS-ARCHITECTURE.md) — SaaS/control-plane/data-plane architecture;
- [`docs/TENANCY.md`](docs/TENANCY.md) — account/store/tenant isolation;
- [`docs/JAVASCRIPT_LIBRARIES.md`](docs/JAVASCRIPT_LIBRARIES.md) — dependency ownership/policy.

`docs/CLOUDFLARE-ACTIVATION-READINESS.md` is retained as a **historical checkpoint**; current activation truth lives in the current-state/runtime/publish/domain documents.

## Stack

### Engine/import

- Cheerio;
- PQueue;
- Zod;
- Sharp.

### Frontend

- Vite;
- Swiper;
- Motion;
- Fuse.js is installed/approved for client-side fuzzy search where that architecture remains appropriate, but its launch ownership is under post-audit re-evaluation.

### Quality

- Vitest;
- ESLint;
- Prettier;
- browser E2E/accessibility tooling is a roadmap requirement before public launch.

## Local development

```bash
npm ci
npm run dev
```

## Baseline quality gate

```bash
npm run deps:check
npm run test
npm run lint
npm run build
npm run build:verify
```

Crawler/import/sync/taxonomy work must run the additional isolated verification/audits required by `AGENTS.md`.

## Engineering decision rule

For every new feature ask:

> Is this strengthening an automated, source-independent, multi-tenant product with a recoverable failure mode and launch-quality customer experience, or is it hard-coding one supplier/store and creating manual work?

Prefer the platform/product path.