# Catalog Engine SaaS Architecture

Status: **Normative architecture contract**  
Scope: control plane, tenant data plane, authentication, entitlements, provisioning, routing, domains and runtime boundaries.  
Related product contracts: `TENANCY.md`, `CUSTOMER-PORTAL.md`, `BILLING-PAYMENTS.md`, `CEI.md`.

## Product contract

The normal public self-service customer experience is:

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
15. incremental sync keeps it current after its separate activation/eligibility authorities allow it;
16. customer reviews only exceptions/ambiguities that automation cannot safely resolve.

A real tenant/store is not provisioned in the normal public self-service path until server-side entitlement evaluation permits it.

### First real merchant beta path

The owner-authorized PB0–PB12 campaign temporarily pulls forward the minimum merchant portal/onboarding capabilities before public billing is implemented. The architectural substitution is intentionally narrow:

```text
normal public path: trusted billing -> normalized entitlement
first beta path:    explicit auditable pilot grant -> normalized entitlement
```

Everything after entitlement remains the same multi-tenant authority chain. The beta grant:

- is server-side, explicit and auditable;
- may initially allow one store;
- must not be a hard-coded email/name/provider-subject bypass;
- must feed the same store-creation authorization boundary future billing will use;
- does not activate recurring tenant Intelligent Sync;
- does not waive private-preview, domain or publication gates.

The beta sequence/proof is owned by `PORTAL-BETA-EXECUTION.md`.

The supplier/source is private ingestion evidence. It is never automatically the public information architecture of the store.

## Platform domain roles

Current domain roles are:

- `catalogoengine.com` — marketing/sales;
- `app.catalogoengine.com` — customer admin portal;
- `edge.catalogoengine.com` — stable SaaS/custom-domain CNAME target;
- `origin.catalogoengine.com` — Cloudflare for SaaS fallback/internal origin;
- customer-owned custom hostname — public merchant storefront.

Public merchant storefronts are white-label and use verified customer-owned domains.

Private authenticated preview is a separate pre-publication capability and must not become an accidental permanent public Catalog Engine merchant URL.

## Account, entitlement and tenant

The relationship is:

`account -> trusted entitlements -> one or more tenant stores`

Billing belongs to the account when implemented. A tenant is one isolated merchant store.

Do not hard-code `one principal = one tenant` or `one subscription row = one catalog database`.

Store creation checks evaluated entitlements server-side before provisioning begins. The entitlement evaluator may consume normalized billing state and explicitly governed pilot grants, but browser claims and raw identity-provider claims are never store authorization.

See `TENANCY.md`, `BILLING-PAYMENTS.md` and `PORTAL-BETA-EXECUTION.md`.

## Control plane vs data plane

Catalog Engine is split logically into two planes.

### Control plane

The control plane owns low-volume SaaS metadata:

- accounts/principals;
- billing customer/subscription mirror when implemented;
- explicit pilot/admin entitlement grants where governed;
- evaluated entitlements;
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

The first real beta tenant must be newly created and must not reuse or silently fall back to this tenant.

## Workers for Platforms runtime

Current architecture uses Cloudflare Workers for Platforms for non-default tenant runtimes.

Production dispatch namespace:

`catalog-engine-production`

The platform Worker has a dispatch binding:

`TENANT_DISPATCH -> catalog-engine-production`

Tenant routing resolves a server-owned runtime script name/provider state and dispatches only after tenant/domain/runtime requirements are satisfied.

Never accept an arbitrary client-supplied Worker script name as the routing authority.

## Storefront routing

Normal public storefront routing follows:

`hostname -> control-plane tenant/domain resolution -> verified tenant state -> dispatch/runtime -> isolated tenant D1`

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

PB9 must prove the same isolation principle for authenticated private preview without weakening public publish gates.

## Authentication and authorization

The Worker contains a provider-neutral authenticated control-plane boundary under `/api/admin/*`.

Authentication uses standards-compatible OIDC/JWT inputs and fails closed. The current implementation expects deployment configuration such as:

- `ADMIN_AUTH_ISSUER`;
- `ADMIN_AUTH_AUDIENCE`;
- `ADMIN_AUTH_JWKS_URL`.

Only valid signed tokens from the configured identity layer are accepted according to implementation rules.

The identity provider owns login/password/MFA/account recovery. Catalog Engine stores opaque principal identities and authorization/entitlement metadata rather than customer passwords.

Authorization rules:

- authentication proves an opaque principal, not store entitlement;
- store creation re-evaluates trusted entitlements server-side;
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

At the PB0 baseline, `POST /api/admin/stores` already persists a real tenant/profile/catalog instance/owner membership/provisioning run but does **not yet enforce an entitlement**. PB2 owns closing that gap before the portal enables self-service creation. `GET /api/admin/session` also does not yet project the entitlement model expected by the portal.

Existing test/internal/default flows must not become a production entitlement bypass.

## Provisioning lifecycle

Provisioning is a durable, idempotent state machine.

Canonical product-level order:

`trusted entitlement -> tenant -> profile -> source -> data plane/runtime -> migrations -> import -> CEI/classify -> verify/private preview -> customer domain -> publish`

`tenant_provisioning_runs` and step state/checkpoints should preserve progress so retries resume safely.

Rules:

- successful checkpoints are not replayed unnecessarily;
- a failed checkpoint resumes at/after the failed boundary;
- repeated idempotent create requests do not create duplicate stores/resources;
- entitlement allowance is enforced before provisioning mutation;
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

Subsystems should retain their own detailed states for entitlement/billing, source, domain, runtime and CEI rather than overloading one string.

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

The first PB campaign proves **initial import**, not recurring Intelligent Sync activation. `TENANT_SYNC_AUTOMATION_ENABLED=0` and the empty active cohort remain mandatory until the separate M7E decision/proof.

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

Private preview before domain publication is permitted only through an authenticated server-resolved preview authority; it must not bypass final publish requirements.

## Billing and entitlement integration

Billing is account-level control-plane state.

The payment provider is authoritative for monetary/subscription facts. Catalog Engine mirrors normalized state and derives entitlements.

Store provisioning, multi-store limits and restricted states consume evaluated entitlements, not raw provider fields.

Explicit beta/pilot grants are a second bounded trusted entitlement source during the owner-authorized first merchant campaign. They must be normalized/audited and may not masquerade as paid subscription state.

Payment failure or grant expiry must not immediately delete tenant data. Grace/suspension/reactivation follow `BILLING-PAYMENTS.md` and the applicable entitlement policy.

## Background execution

Long-running work should become durable/queued rather than tied to a browser request or one GitHub Action per customer.

Candidate tenant jobs include:

- data-plane/runtime provisioning;
- source scan/import;
- CEI research/classification;
- sync delta processing when activated;
- domain verification polling;
- publication smoke;
- billing reconciliation/recovery;
- cleanup/retention when future explicit policies exist.

Jobs require bounded retry/backoff, idempotency and per-tenant isolation.

Recurring tenant sync adds a separate low-cardinality rollout authority in the control plane. A source is eligible only when the global gate, an explicitly enrolled `(tenant_id, source_key)` row and the configured active cohort all agree. Missing rows and existing tenants default to disabled. A bounded per-tick cap provides operational backpressure, while active/unresolved import, recovery or tenant data-plane migration work blocks conflicting selection. Enrollment metadata must never carry product data, supplier URLs or private evidence, and merchants do not self-enroll into a platform pilot.

A store entitlement does not imply recurring-sync enrollment. PB2/PB3 must not couple those authorities.

## Automation-first architecture

The target operating model is:

> automate normal paths; expose exceptions.

The owner should not manually create each tenant D1/Worker, run each import, classify each catalog, verify every ordinary payment or execute recurring syncs.

An operator-issued beta entitlement grant is acceptable as a bounded commercial admission control for the first merchant, but all downstream tenant provisioning/import/CEI/preview behavior must use normal automated authorities.

If a per-customer manual infrastructure step is introduced, document whether it is temporary and what boundary will eventually automate it.

## Current scale direction

### Current checkpoint

The repository/prod infrastructure already proves tenant-aware control-plane behavior, isolated tenant runtime/data-plane behavior and live custom-hostname dispatch. Initial tenant Queue import is production-activated. The portal shell and provider-neutral JWT validation exist, but real identity-provider UX, server-side entitlement enforcement and the complete first-merchant journey are not yet production-proven.

### First real merchant checkpoint

The PB0–PB12 campaign builds the authenticated/entitled `app.catalogoengine.com` flow that invokes those capabilities automatically through private preview, without claiming public billing/domain/recurring-sync launch completeness.

### Growth checkpoint

As customer count increases, add fleet-level queues/workflows, observability, quotas, dead-letter handling, automated domain/runtime lifecycle and cost controls.

Do not over-engineer for 100,000 tenants today, but do not choose designs that require a rewrite to reach 100 or 1,000.

## Final architecture rule

For every change ask:

> Which account/entitlement/tenant owns this, what data plane handles it, what trust boundary authorizes it, and how does it recover automatically when something fails?

If any answer is unclear, the architecture is incomplete.
