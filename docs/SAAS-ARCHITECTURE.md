# Catalog Engine SaaS Architecture

Status: **Normative architecture contract**  
Scope: control plane, tenant data plane, authentication, provisioning, routing, domains and runtime boundaries.  
Related product contracts: `TENANCY.md`, `CUSTOMER-PORTAL.md`, `BILLING-PAYMENTS.md`, `CEI.md`.

## Product contract

The self-service customer experience is:

1. discover Catalog Engine at `catalogoengine.com`;
2. choose a recurring plan and complete checkout;
3. trusted billing state grants account entitlements;
4. enter `app.catalogoengine.com`;
5. create a store under the available entitlement;
6. configure basic branding/contact information;
7. connect a supported catalog source;
8. Catalog Engine provisions the isolated tenant data plane/runtime;
9. source data is discovered/normalized;
10. CEI understands/classifies/merchandises the catalog;
11. customer previews the store privately;
12. customer connects/verifies their own domain;
13. storefront/runtime/domain smoke checks pass;
14. store is published;
15. incremental sync keeps it current;
16. customer reviews only exceptions/ambiguities that automation cannot safely resolve.

A real tenant/store is not provisioned in the normal self-service path until server-side entitlement evaluation permits it.

The supplier/source is private ingestion evidence. It is never automatically the public information architecture of the store.

## Platform domain roles

Current domain roles are:

- `catalogoengine.com` — marketing/sales;
- `app.catalogoengine.com` — customer admin portal;
- `edge.catalogoengine.com` — stable SaaS/custom-domain CNAME target;
- `origin.catalogoengine.com` — Cloudflare for SaaS fallback/internal origin;
- customer-owned custom hostname — public merchant storefront.

Public merchant storefronts are white-label and use verified customer-owned domains.

## Account, subscription and tenant

The relationship is:

`account -> subscription/entitlements -> one or more tenant stores`

Billing belongs to the account. A tenant is one isolated merchant store.

Do not hard-code `one principal = one tenant` or `one subscription row = one catalog database`.

Store creation checks entitlements server-side before provisioning begins.

See `TENANCY.md` and `BILLING-PAYMENTS.md`.

## Control plane vs data plane

Catalog Engine is split logically into two planes.

### Control plane

The control plane owns low-volume SaaS metadata:

- accounts/principals;
- billing customer/subscription mirror;
- entitlements;
- tenants;
- memberships and roles;
- store profile/branding;
- domains;
- source connection metadata/health;
- durable provisioning state;
- data-plane/runtime locator/status;
- audit events;
- high-level CEI/job state that must coordinate tenant workflows.

During transition, these tables can remain in the current `CATALOG_DB` where implemented, but schema boundaries must remain portable to a future dedicated `CONTROL_DB`.

### Tenant data plane

The tenant data plane owns high-volume/private catalog state for exactly one tenant deployment/database:

- normalized products;
- canonical categories;
- merchandising entities/facets;
- product/media mappings;
- private source index/fingerprints;
- sync events/reconciliation state;
- media proxy registry;
- CEI classification output and tenant-scoped memory where appropriate.

The intended scale model is one isolated catalog database per tenant (or another explicitly isolated shard), rather than relying on a `tenant_id` predicate in every public catalog query.

This reduces cross-store leakage risk and keeps storefront queries/runtime boundaries explicit.

## Current production tenant

The original production catalog is one tenant instance:

- tenant ID: `t_00000000000000000001`;
- current data plane/runtime name: `catalog-engine-default`;
- existing source connection: `primary`.

It is not global catalog truth. New code must work for future tenants.

## Workers for Platforms runtime

Current architecture uses Cloudflare Workers for Platforms for non-default tenant runtimes.

Production dispatch namespace:

`catalog-engine-production`

The platform Worker has a dispatch binding:

`TENANT_DISPATCH -> catalog-engine-production`

Tenant routing resolves a server-owned runtime script name/provider state and dispatches only after tenant/domain/runtime requirements are satisfied.

Never accept an arbitrary client-supplied Worker script name as the routing authority.

## Storefront routing

Normal storefront routing follows:

`hostname -> control-plane tenant/domain resolution -> verified tenant state -> dispatch/runtime -> isolated tenant D1/API`

It fails closed.

An unknown custom hostname must not fall through to another tenant/default catalog.

Platform hosts such as `catalogoengine.com`/`app.catalogoengine.com` follow first-party platform behavior and are not merchant custom hostnames.

Infrastructure health probes may be intentionally outside tenant routing, but they must not expose tenant data or be mistaken for proof of tenant isolation.

## Proven live isolation checkpoint

The platform has already proven live custom-hostname tenant dispatch using `teste.loja.catalogoengine.com`:

- Cloudflare Custom Hostname/TLS active;
- hostname routed through the platform Worker;
- control plane resolved a dedicated smoke tenant;
- Workers for Platforms dispatched to the tenant runtime;
- tenant used its own D1;
- tenant could read its own product;
- tenant could not read a default-catalog product (`404`);
- default catalog could not read the tenant product (`404`);
- default catalog remained independently populated.

This smoke tenant is test infrastructure/state, not a customer product contract. The architectural conclusion is that custom-domain -> tenant resolution -> dispatch -> isolated D1 has been proven end-to-end.

## Authentication and authorization

The Worker contains a provider-neutral authenticated control-plane boundary under `/api/admin/*`.

Authentication uses standards-compatible OIDC/JWT inputs and fails closed. The current implementation expects deployment configuration such as:

- `ADMIN_AUTH_ISSUER`;
- `ADMIN_AUTH_AUDIENCE`;
- `ADMIN_AUTH_JWKS_URL`.

Only valid signed tokens from the configured identity layer are accepted according to implementation rules.

The identity provider owns login/password/MFA/account recovery. Catalog Engine stores opaque principal identities and authorization metadata rather than customer passwords.

Authorization rules:

- every tenant read resolves active membership;
- cross-tenant lookups must not disclose another tenant;
- tenant mutations require appropriate role;
- sensitive mutations write audit events;
- admin responses use safe/no-store behavior as appropriate;
- private source URLs/credentials/runtime locators are not public API data.

## Existing control-plane routes

Implemented routes include concepts such as:

- `GET /api/admin/session`;
- `GET /api/admin/stores`;
- `POST /api/admin/stores`;
- `GET /api/admin/stores/:tenantId/onboarding`;
- `POST /api/admin/stores/:tenantId/source`.

As billing is integrated, `POST /api/admin/stores` must enforce normalized account entitlements before a new tenant is provisioned. Existing test/internal/default flows must not become a production billing bypass.

## Provisioning lifecycle

Provisioning is a durable, idempotent state machine.

Canonical product-level order:

`billing entitlement -> tenant -> profile -> source -> data plane/runtime -> migrations -> import -> CEI/classify -> verify/private preview -> customer domain -> publish`

`tenant_provisioning_runs` and step state/checkpoints should preserve progress so retries resume safely.

Rules:

- successful checkpoints are not replayed unnecessarily;
- a failed checkpoint resumes at/after the failed boundary;
- repeated idempotent create requests do not create duplicate stores/resources;
- a healthy store may remain privately previewable while waiting for domain configuration;
- publication requires verified custom domain + storefront/runtime health;
- one tenant's failure does not block other tenant jobs;
- transition metadata never contains secrets/private source URLs.

## Store lifecycle states

Customer-facing state can normalize to concepts such as:

- `draft`;
- `configuring` / `provisioning`;
- `ready` (private preview healthy);
- `published`;
- `attention`;
- `suspended`.

Subsystems should retain their own detailed states for billing, source, domain, runtime and CEI rather than overloading one string.

## Source connections

Source connectors are tenant-owned private configuration.

The currently implemented Yupoo path validates provider/scope and keeps real source URLs in private state.

The architecture must remain source-neutral so future adapters can support Shopify, WooCommerce, CSV/Excel, PDF, API, website and other catalog providers.

After adapter normalization, CEI consumes source-neutral evidence.

Source changes that would destroy/replace an already imported catalog require explicit migration/reset semantics rather than silently replacing private source identity.

## Catalog Engine Intelligence integration

CEI owns catalog understanding/classification/learning according to `CEI.md`.

Architecture principles:

- CEI runs in explicit tenant context;
- global knowledge is separate from tenant memory;
- normal operation does not require paid token-based LLM calls;
- research/model escalation is optional and bounded;
- results are schema-validated before persistence/publication;
- unknown/conflicting technical claims remain unresolved/review rather than guessed;
- classification/CEI versioning must permit safe reprocessing without losing merchant overrides.

## Supplier/source synchronization

The normal synchronization path is incremental:

1. lightweight source listing scan;
2. compare fingerprints/private index;
3. create delta queue for new/changed/moved/restored candidates;
4. fetch product detail only for the delta;
5. invoke CEI only for affected/new knowledge where possible;
6. update tenant catalog/aggregates safely;
7. smoke check;
8. promote cursor/state after success.

A complete reconciliation can run periodically for safe removal detection. Full detail re-import is recovery/manual tooling, not routine daily behavior.

Partial scans never infer deletion; see `AGENTS.md`.

## Domains

Cloudflare for SaaS/custom-hostname behavior is documented in `CUSTOM-DOMAINS.md`.

Current production infrastructure includes:

- fallback origin `origin.catalogoengine.com`;
- edge target `edge.catalogoengine.com`;
- Worker route capable of receiving custom merchant hostnames;
- active custom-hostname proof using the test hostname.

Desired customer lifecycle:

`enter domain -> exact DNS instruction -> automatic DNS/hostname/certificate checks -> storefront runtime smoke -> publish`

Customer domain ownership/renewal remains with the customer.

## Billing integration

Billing is account-level control-plane state.

The payment provider is authoritative for monetary/subscription facts. Catalog Engine mirrors normalized state and derives entitlements.

Store provisioning, multi-store limits and restricted states consume entitlements, not raw provider fields.

Payment failure must not immediately delete tenant data. Grace/suspension/reactivation follow `BILLING-PAYMENTS.md`.

## Background execution

Long-running work should become durable/queued rather than tied to a browser request or one GitHub Action per customer.

Candidate tenant jobs include:

- data-plane/runtime provisioning;
- source scan/import;
- CEI research/classification;
- sync delta processing;
- domain verification polling;
- publication smoke;
- billing reconciliation/recovery;
- cleanup/retention when future explicit policies exist.

Jobs require bounded retry/backoff, idempotency and per-tenant isolation.

## Automation-first architecture

The target operating model is:

> automate normal paths; expose exceptions.

The owner should not manually create each tenant D1/Worker, run each import, classify each catalog, verify every ordinary payment or execute recurring syncs.

If a per-customer manual step is introduced, document whether it is temporary and what boundary will eventually automate it.

## Current scale direction

### Current checkpoint

The repository/prod infrastructure already proves tenant-aware control-plane behavior, isolated tenant runtime/data-plane behavior and live custom-hostname dispatch.

### Next productization checkpoint

Build the authenticated/billing-gated `app.catalogoengine.com` flow that invokes those capabilities automatically.

### Growth checkpoint

As customer count increases, add fleet-level queues/workflows, observability, quotas, dead-letter handling, automated domain/runtime lifecycle and cost controls.

Do not over-engineer for 100,000 tenants today, but do not choose designs that require a rewrite to reach 100 or 1,000.

## Final architecture rule

For every change ask:

> Which account/tenant owns this, what entitlement permits it, what data plane handles it, what trust boundary authorizes it, and how does it recover automatically when something fails?

If any answer is unclear, the architecture is incomplete.