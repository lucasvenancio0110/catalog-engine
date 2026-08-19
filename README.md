# Catálogo Engine

Catálogo Engine is a white-label SaaS platform that transforms an authorized supplier catalog into a professional storefront under the merchant’s own brand and domain, then keeps that storefront synchronized automatically.

The product is not “a Yupoo importer” and is not a one-off website generator. The target customer experience is:

`create account -> create store -> configure brand -> connect supplier -> classify -> preview -> connect own domain -> publish -> Intelligent Sync`

## Product rule

Public customer storefronts use the customer’s **own domain**.

The platform identity is:

- `catalogoengine.com` — public product/company domain;
- `app.catalogoengine.com` — customer administration;
- `edge.catalogoengine.com` — technical Cloudflare for SaaS CNAME target only.

`edge.catalogoengine.com` is infrastructure, not a merchant-facing storefront URL. A customer domain points to it through DNS while the browser continues to show the customer’s own domain.

Paid storefronts should not expose the supplier or require “Powered by Catálogo Engine” branding.

Before the customer domain is connected, the storefront is reviewed through a private preview.

## Current architecture

Catálogo Engine is being split into two logical planes:

### Control plane

Owns low-volume SaaS state:

- tenants/stores;
- memberships and roles;
- store branding and theme;
- custom domains;
- supplier connection metadata;
- provisioning state;
- subscription references;
- audit history;
- tenant data-plane locator/status.

### Tenant data plane

Owns the high-volume catalog for a tenant:

- normalized products;
- canonical categories;
- teams, leagues and facets;
- product/media mappings;
- private supplier index and fingerprints;
- sync state/events;
- media proxy registry.

The existing production catalog is **Tenant #0001**, not a permanent global singleton.

## Supplier philosophy

The supplier is a private ingestion source, not the authority for the public storefront structure.

Raw supplier taxonomy is kept privately as evidence. Catálogo Engine builds a canonical merchandising layer from product text, source path, aliases, known sports entities, facets, explicit rules and future manual overrides.

Ambiguous products should be sent to review/unknown instead of being confidently misclassified.

## Intelligent Sync

Routine sync must not re-read every product detail.

The intended flow is:

1. lightweight supplier listing scan;
2. compare listing fingerprints;
3. detect `NEW`, `CHANGED`, `MOVED`, restoration and safe removal signals;
4. fetch album detail only for the delta queue;
5. reclassify/update only affected products where possible;
6. smoke test the public state;
7. promote private cursors only after success.

Complete listing reconciliation runs periodically for safe removal detection. Full detail crawling is recovery/manual tooling, not the normal daily path.

## Durable store provisioning

Store creation is modeled as an idempotent, resumable workflow:

`tenant -> profile -> domain -> data plane -> source -> migrations -> import -> classify -> verify -> publish`

If a later step fails, onboarding must resume from the last safe checkpoint instead of restarting the full supplier import.

## Hosting direction

- **GitHub** — source code, review and CI/CD; not one repository per customer.
- **Cloudflare Workers** — APIs, storefront routing, media proxy and orchestration endpoints.
- **Cloudflare Workers for Platforms** — isolated tenant Workers and dynamic dispatch.
- **Cloudflare for SaaS** — customer-owned custom domains routed through `edge.catalogoengine.com`.
- **Cloudflare D1** — control-plane metadata and isolated/explicit tenant catalog data planes.
- **Cloudflare R2** — first-party assets such as logos/banners and controlled media copies when needed.
- **Queues / durable workflows** — tenant-level onboarding and synchronization jobs at scale.

Customers should not need GitHub or Cloudflare accounts to operate their stores.

## Commercial direction

Catálogo Engine is sold as a recurring SaaS subscription.

Positioning:

> Transform your supplier catalog into a professional store under your own brand and domain, organized and updated automatically.

Initial market focus is sports/football merchants already using supplier catalogs. Expansion to other verticals should happen only after the sports classification engine is strong.

Pricing, trial duration and plan packaging are hypotheses to validate with real customers, but custom-domain white-label operation is a core product rule rather than a premium cosmetic add-on.

## Documentation

- [`docs/PRODUCT-BUSINESS-BLUEPRINT.md`](docs/PRODUCT-BUSINESS-BLUEPRINT.md) — product, business model, hosting, sales, pricing hypotheses, ownership model and roadmap.
- [`docs/SAAS-ARCHITECTURE.md`](docs/SAAS-ARCHITECTURE.md) — multi-tenant/control-plane/data-plane architecture and provisioning model.
- [`docs/CLOUDFLARE-ACTIVATION-READINESS.md`](docs/CLOUDFLARE-ACTIVATION-READINESS.md) — controlled production activation and `edge.catalogoengine.com` infrastructure identity.
- [`AGENTS.md`](AGENTS.md) — engineering rules and repository policy.
- [`docs/JAVASCRIPT_LIBRARIES.md`](docs/JAVASCRIPT_LIBRARIES.md) — approved JavaScript-library guidance.

## Stack

### Engine/import

- Cheerio — HTML parsing.
- PQueue — bounded concurrency/backpressure.
- Zod — schema validation.
- Sharp — image validation/processing.

### Storefront

- Vite — build/dev server.
- Fuse.js — tolerant search where client-side search is appropriate.
- Swiper — touch product galleries.
- Motion — restrained micro-interactions.

### Quality

- Vitest — tests.
- ESLint — static analysis.
- Prettier — formatting.

## Local development

```bash
npm ci
npm run dev
```

## Quality gate

```bash
npm run deps:check
npm run test
npm run lint
npm run build
npm run build:verify
```

For crawler/import changes, also run the relevant isolated real-source crawl/sync verification and audits required by `AGENTS.md`.

## Engineering decision rule

Every new feature should answer this question:

> Is this being built for one hard-coded catalog, or for a tenant in a platform that must eventually serve 10, 100 and 1,000 customers?

Build for the tenant/platform model without adding scale complexity before it is useful.
