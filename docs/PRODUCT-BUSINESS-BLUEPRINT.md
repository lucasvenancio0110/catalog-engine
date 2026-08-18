# Catalog Engine — Product & Business Blueprint

This document records the current product, commercial and infrastructure direction for Catalog Engine so future engineering decisions stay aligned with the final SaaS business.

## Product in one sentence

Catalog Engine turns an authorized supplier catalog into a professional, white-label storefront that is organized and kept up to date automatically.

The customer value proposition is not “import a Yupoo”. It is:

> Paste the supplier catalog, apply your brand, and receive a professional store that stays synchronized automatically.

## What we are selling

Catalog Engine is a SaaS subscription, not a one-time website sale and not a hosting resale service.

The customer pays for:

- access to the Catalog Engine platform;
- automated supplier ingestion;
- canonical product classification and organization;
- intelligent incremental synchronization;
- a professional white-label storefront;
- themes and branding controls;
- infrastructure and maintenance;
- admin tools;
- custom-domain operation;
- future analytics, review queues and automation.

The customer does not receive the source code, Worker, database or GitHub repository. The customer receives a license to use the platform while the subscription is active.

## White-label rule

Public customer storefronts must use the customer’s own domain.

Examples:

- `futimports.com.br`
- `arenaimports.com.br`
- `camisa10.com.br`

Catalog Engine domains are reserved for the platform itself, for example:

- `catalogengine.com.br` — marketing/sales site;
- `app.catalogengine.com.br` — customer admin application.

The public storefront must not require a `*.catalogengine.com.br` subdomain and should not display mandatory “Powered by Catalog Engine” branding on paid plans.

Before the customer domain is connected, the store is reviewed through a private preview inside the admin experience. It is not considered publicly published until the customer domain is verified and routing/HTTPS are healthy.

## Domain ownership

The customer should own and renew their own domain.

Catalog Engine should not normally purchase domains in the customer’s name. The customer can buy a domain from their preferred registrar and connect it through DNS instructions in the admin panel.

The control plane stores domain verification and routing state. Domain setup should eventually be automated as much as possible.

## Customer experience

The intended customer flow is:

1. create an account;
2. choose a subscription/plan;
3. create a store;
4. enter store name, logo, WhatsApp, Instagram and branding;
5. choose a controlled Catalog Engine theme;
6. paste a supported supplier catalog URL;
7. Catalog Engine validates and privately connects the source;
8. Catalog Engine discovers products;
9. Catalog Engine classifies and reorganizes the catalog;
10. Catalog Engine prepares media and storefront data;
11. customer previews the store privately;
12. customer connects their own domain;
13. Catalog Engine verifies domain, storefront and HTTPS;
14. storefront is published;
15. Intelligent Sync keeps the catalog current.

The customer should never need to understand GitHub, Workers, D1, queues, CI/CD or supplier crawler internals.

## Provisioning lifecycle

Store creation is a durable, idempotent workflow:

`tenant -> profile -> domain -> data plane -> source -> migrations -> import -> classify -> verify -> publish`

Each step must be persisted independently. If a later stage fails, execution resumes from the last safe checkpoint rather than restarting the full catalog import.

The customer-facing admin can translate this into simple progress such as:

- Loja criada;
- Perfil configurado;
- Fornecedor conectado;
- Analisando catálogo;
- Produtos encontrados;
- Organizando categorias e times;
- Preparando imagens;
- Validando loja;
- Conectando domínio;
- Publicando.

## Multi-tenant model

A tenant represents one customer/store organization inside Catalog Engine.

Each tenant owns its own:

- store profile;
- owner and memberships;
- subscription state;
- theme configuration;
- domains;
- supplier connections;
- provisioning state;
- catalog data plane;
- sync state;
- audit history.

Tenant #0001 is the current production catalog. New engineering work must treat it as one tenant instance, not as a permanent global singleton.

The strategic data model is a low-volume shared control plane plus isolated high-volume tenant catalog data planes. This reduces the chance of cross-store product leakage caused by a missing tenant predicate in catalog SQL.

## Hosting and infrastructure

The intended production stack is Cloudflare-first.

### GitHub

GitHub stores source code, reviews changes and runs CI/CD. It is not the customer-facing hosting product.

There should not be one GitHub repository per customer.

### Cloudflare Workers

Workers serve application APIs, storefront routing, media proxying and orchestration endpoints.

### D1

The control plane stores low-volume SaaS metadata. Tenant catalog data should remain explicitly isolated, with the architecture able to move toward one D1 database or isolated shard per tenant when appropriate.

### R2

R2 is the intended storage layer for first-party customer assets such as:

- logos;
- banners;
- theme assets;
- generated/controlled media copies when required.

Supplier media should not automatically be copied in bulk without a product, reliability, legal or cost reason. Proxy/cache and selective storage remain valid strategies.

### Queues / durable background execution

At scale, synchronization and onboarding should become queued background jobs rather than one GitHub Action per customer.

The system should be able to process independent tenant jobs such as:

- tenant A: 5 catalog deltas;
- tenant B: no changes;
- tenant C: 13 updates;
- tenant D: one new product.

A future durable workflow engine should resume provisioning/sync steps safely after failure.

## Intelligent Sync

Routine synchronization must not re-read every product detail.

The current intended model is:

1. lightweight listing scan;
2. compare fingerprints with the tenant’s private supplier index;
3. identify `NEW`, `CHANGED`, `MOVED`, restoration and safe removal signals;
4. fetch detail only for the delta queue;
5. reclassify only affected products where possible;
6. update the tenant catalog;
7. run smoke checks;
8. promote private cursors only after the public state is healthy.

Complete listing reconciliation runs periodically for safe removal detection. Full detail crawling is recovery/manual tooling, not the normal daily path.

Incomplete supplier albums must use bounded retry/backoff and must never overwrite a healthy public product with bad/incomplete state.

## Canonical organization is our moat

The supplier is a raw data source, not the authority for the public catalog structure.

Supplier categories and paths are retained privately as evidence. Catalog Engine builds a canonical merchandising layer from weighted signals such as:

- product title;
- source path;
- aliases;
- known teams/selections;
- leagues/competitions;
- season/version markers;
- commercial facets;
- explicit classification rules;
- manual overrides.

Ambiguous items should be marked for review or unknown rather than confidently placed in the wrong team/category.

Manual overrides must survive future supplier syncs and classifier-version changes.

The long-term defensible asset is the classification engine and accumulated rules/aliases, not merely the storefront layout.

## Initial market focus

Start focused on sports/football catalog sellers already using Yupoo-like supplier catalogs.

Do not attempt to support every retail vertical at once. The initial positioning can effectively be “Catalog Engine for Sports”, with later specialist engines/modules for other verticals if there is demand.

This gives the classifier a narrow domain in which it can become exceptionally good before expanding.

## Themes

Catalog Engine should provide controlled themes, not arbitrary customer HTML/JavaScript.

Customers can configure supported branding components while Catalog Engine keeps responsibility for quality, responsiveness and upgrades.

Current theme direction includes presets such as:

- Stadium;
- Premium Dark;
- Clean;
- Street;
- Minimal.

Themes should support logo, colors, home-section order and supported presentation settings without allowing code injection.

## Admin panel

The eventual customer admin should expose concepts the merchant understands, such as:

- store health/status;
- product count;
- new products;
- last sync;
- products;
- categories;
- clubs and selections;
- leagues;
- featured content;
- appearance;
- supplier connection;
- synchronization;
- domain;
- subscription;
- settings;
- classification review queue.

It should not expose Cloudflare/GitHub implementation details.

## Authentication and authorization

The public catalog Worker must not gain unauthenticated admin write endpoints just to accelerate development.

The admin layer must use authenticated identity and tenant membership resolution. Catalog Engine should store opaque principal IDs rather than customer passwords where an external auth provider handles authentication.

Roles can include:

- owner;
- admin;
- editor;
- viewer.

Sensitive mutations require authorization and audit logging.

## Payments and subscriptions

The commercial model is recurring subscription billing.

A payment provider should eventually handle checkout, recurring billing, payment methods, invoices and customer billing management. Billing state is mirrored into the Catalog Engine control plane.

Typical subscription states should support concepts such as:

- trialing;
- active;
- past_due;
- canceled;
- suspended/grace-period handling.

Do not immediately delete a storefront after one failed payment. Use a grace period and controlled suspension policy.

## Trial strategy

A short trial can be powerful because the customer can see their own supplier catalog transformed into their own branded storefront.

Initial hypothesis: 3–7 days, with safeguards against repeated abuse.

The strongest sales demonstration is the customer seeing their own catalog organized rather than viewing a generic demo.

## Commercial positioning

Avoid selling the product as “a system that imports Yupoo”.

Better positioning:

> Transform your supplier catalog into a professional store under your own brand and domain, organized and updated automatically.

The before/after story is central:

`messy supplier catalog -> Catalog Engine -> branded organized storefront`

Core visible benefits:

- own brand;
- own domain;
- clubs/leagues/selections organized;
- retro/children/player-version/etc. facets;
- search and filters;
- WhatsApp sales flow;
- no exposed supplier identity;
- automatic synchronization.

## Pricing hypotheses

Pricing is a business hypothesis to validate with real customers, not a fixed engineering requirement.

Because custom domain is a core product rule, avoid a low-end plan whose main limitation is forcing a Catalog Engine public subdomain.

Initial validation ranges could be approximately:

- Essential: R$ 99–149/month;
- Pro: R$ 199–249/month;
- Business: R$ 399+/month.

Possible differentiation should come from capabilities, scale, multiple sources/stores, automation, team access, analytics and support—not from making the basic white-label experience look cheap.

During the early assisted phase, an implementation/onboarding fee can be tested. It can be reduced or removed once provisioning becomes fully automated.

## Sales strategy

Start with direct outreach before heavy paid acquisition.

Target merchants already selling sports products through supplier catalogs on Instagram, WhatsApp and reseller communities.

A strong outreach proposition is to offer a demonstration using the merchant’s own catalog.

Early objectives:

1. prove willingness to pay monthly;
2. learn which feature creates retention;
3. understand onboarding objections;
4. discover how merchants actually use WhatsApp/catalog links;
5. improve classification accuracy;
6. turn assisted setup into automation.

Scale paid marketing after this retention/value proposition is validated.

## Customer vs Catalog Engine responsibilities

### Catalog Engine owns

- platform code;
- classification engine;
- infrastructure;
- synchronization engine;
- admin software;
- themes;
- platform updates;
- operational monitoring;
- tenant provisioning;
- security boundaries.

### Customer owns/is responsible for

- their account and authorized users;
- their brand identity;
- their domain registration/renewal;
- their public contact details;
- their connected supplier relationship;
- their legal right to use product imagery, trademarks and third-party content;
- their sales/customer-service operation.

Hiding a supplier URL is a white-label/privacy implementation detail; it does not create rights to use third-party images or trademarks.

## Legal/operational checklist before broad public sales

Before commercial launch at scale, obtain professional guidance appropriate to Brazil regarding:

- company/tax/fiscal setup;
- recurring SaaS billing and invoicing;
- Terms of Use;
- Privacy Policy;
- LGPD obligations;
- data retention/deletion;
- third-party catalog/content responsibilities;
- domain/customer ownership responsibilities;
- acceptable-use policy;
- suspension/cancellation terms.

## Scale plan

### First clients

Use assisted onboarding where necessary, while keeping the underlying architecture tenant-aware and isolated.

### Tens of clients

Automate:

- authentication;
- supplier connection validation;
- provisioning;
- domain connection;
- billing state;
- sync scheduling;
- support/review tooling.

### Hundreds / thousands of clients

Move recurring work into fleet-level scheduling and queues, add observability, per-tenant quotas, dead-letter/retry processes and automated data-plane lifecycle.

Do not build for 100,000 customers prematurely, but do not make choices that require a full rewrite to reach 100 or 1,000.

## Current roadmap order

The current intended order is:

1. stabilize Intelligent Sync;
2. establish tenant/control-plane boundaries;
3. durable multi-store provisioning;
4. connect a real supplier source to a tenant privately;
5. execute onboarding automatically;
6. authentication/authorization;
7. first customer admin panel;
8. create a real second store end-to-end;
9. controlled themes/branding workflow;
10. custom-domain-only publication flow;
11. recurring billing;
12. pilot customers;
13. queues/workflows and fleet-level SaaS operations as scale justifies them.

## Engineering decision rule

For every new feature ask:

> Is this being built for one hard-coded catalog, or for a tenant in a platform that must eventually serve 10, 100 and 1,000 customers?

Prefer the latter without adding unnecessary complexity before it is useful.
