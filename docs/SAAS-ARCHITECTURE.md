# Catalog Engine SaaS Architecture

## Product contract

The customer experience should stay simple:

1. create an account;
2. create a store;
3. choose branding and a controlled theme;
4. connect a supported supplier source such as Yupoo;
5. let Catalog Engine discover and classify the catalog;
6. preview the storefront privately;
7. connect and verify the customer-owned domain;
8. publish the storefront;
9. keep the store updated through incremental sync;
10. review only ambiguous classifications or supplier failures.

The supplier is a private ingestion source. It is never the public information architecture of the store.

A paid public storefront is white-label and uses the customer’s own domain. Catalog Engine domains are for the platform/admin experience, not the merchant’s public storefront.

## Control plane vs data plane

Catalog Engine is split logically into two planes.

### Control plane

The control plane owns low-volume SaaS metadata:

- tenants;
- memberships and roles;
- plan/subscription references;
- store profile and branding;
- theme selection;
- domains;
- supplier connection metadata and sync health;
- durable provisioning state;
- data-plane locator/status;
- audit events.

During the current single-tenant transition these tables can live in `CATALOG_DB`. Their schema must remain portable to a future dedicated `CONTROL_DB`.

### Tenant data plane

The data plane owns the high-volume catalog for exactly one tenant deployment/database:

- normalized products;
- canonical categories;
- teams, competitions and facets;
- product/media mappings;
- private supplier index and fingerprints;
- sync events and reconciliation state;
- media proxy registry.

The intended scale model is one isolated catalog database per tenant (or another explicitly isolated shard), rather than adding `tenant_id` to every high-volume public catalog query in a single shared database.

This keeps storefront queries simple and prevents a missing SQL predicate from leaking products between stores.

## Tenant #0001

The existing catalog is the first tenant:

- tenant ID: `t_00000000000000000001`;
- current data plane: `catalog-engine-default`;
- existing supplier connection: `primary`.

New code must treat this as a tenant instance, not as a permanent global singleton.

## Store configuration

Store branding is validated at a trust boundary before persistence. Public configuration contains only fields required by the storefront, such as:

- store name;
- same-origin logo path;
- public WhatsApp/Instagram values;
- theme key;
- currency;
- controlled colors;
- ordered home sections.

Supplier URLs, credentials, raw provider identifiers and private sync state are never part of public store configuration.

Themes are controlled presets. Customers can select and configure supported components, but cannot upload arbitrary JavaScript/HTML into the storefront.

## Authentication and authorization

The Worker now contains a provider-neutral authenticated control-plane boundary under `/api/admin/*`.

Authentication uses standards-compatible OIDC/JWT inputs and is deliberately fail-closed. The runtime requires:

- `ADMIN_AUTH_ISSUER`;
- `ADMIN_AUTH_AUDIENCE`;
- `ADMIN_AUTH_JWKS_URL`.

Only signed `RS256` bearer tokens from the configured issuer/JWKS are accepted. When those settings are absent or invalid, the admin API does not fall back to a development identity: it remains unavailable.

The external identity provider owns login, password/MFA and account recovery. Catalog Engine stores only an opaque principal derived from the external issuer + subject.

Authorization rules:

- every tenant read resolves an active membership;
- cross-tenant lookups return `store_not_found` rather than disclosing another tenant;
- tenant mutations require `owner` or `admin`;
- sensitive mutations write audit events;
- admin responses use `no-store`;
- supplier URLs and private locator references are never returned by the admin/public API.

Implemented control-plane routes:

- `GET /api/admin/session` — authenticated principal plus stores the principal can access;
- `GET /api/admin/stores` — tenant list scoped by membership;
- `POST /api/admin/stores` — idempotent merchant/store creation;
- `GET /api/admin/stores/:tenantId/onboarding` — durable onboarding/provisioning status;
- `POST /api/admin/stores/:tenantId/source` — owner/admin supplier connection.

Production identity-provider values are intentionally not hard-coded in the repository. Configuring a real provider is a deployment decision before exposing the merchant admin UI.

## Provisioning lifecycle

Provisioning is modeled as a durable, idempotent state machine:

`tenant -> profile -> source -> data plane -> migrations -> import -> classify -> verify/private preview -> customer domain -> publish`

`tenant_provisioning_runs` stores the current checkpoint and overall state. `tenant_provisioning_steps` stores each step independently so a background workflow can resume from the last safe checkpoint instead of starting the supplier import from zero.

The provisioning planner uses stable opaque identities for the same owner/store request. Retrying the same request therefore targets the same tenant, data-plane locator, membership, domain and provisioning run instead of silently creating duplicates.

The admin store-creation endpoint persists `tenant` and `profile` as completed checkpoints because those records are created transactionally by that request. The next customer-visible onboarding checkpoint becomes `source`.

The onboarding executor already enforces the resume rules:

- successful checkpoints are not replayed;
- a failed checkpoint resumes at that checkpoint;
- after a healthy storefront verification the store can remain privately previewable while waiting for its custom domain;
- publication is impossible until the custom domain is active and storefront verification succeeded.

Suggested states for the customer UI:

- `draft` — basic details not complete;
- `configuring` — source/theme/configuration in progress;
- `ready` — catalog is healthy and available for private preview, but not public yet;
- `published` — customer domain is verified and the storefront is public;
- `suspended` — intentionally unavailable.

## Supplier connections

The authenticated source endpoint accepts a supported Yupoo URL, validates the provider/scope, performs bounded reachability checks and persists the real source URL only in private D1 state.

Provider redirects are constrained to approved Yupoo hosts. A source that already owns imported albums cannot be silently replaced by a different supplier; changing it later requires an explicit reset/migration workflow.

Public/admin source summaries contain safe fields such as provider, source key, status, sync strategy and health timestamps, but never the raw source URL or private locator reference.

The tenant data plane continues to own the detailed supplier index, fingerprints, delta events and media source registry.

## Supplier synchronization

The daily path is incremental:

1. lightweight source listing scan;
2. compare listing fingerprints with the private index;
3. create a delta queue for `NEW`, `CHANGED`, `MOVED` and safe restoration events;
4. fetch album detail only for that queue;
5. run canonical classification only for affected products;
6. update the tenant catalog and affected aggregates;
7. smoke test;
8. promote the private cursor only after success.

A complete listing reconciliation runs periodically to detect removals safely. Full detail re-import is recovery tooling, not the normal schedule.

Incomplete supplier albums use bounded retry/backoff and must not overwrite a healthy published product.

## Canonical classification

Source taxonomy is evidence, not truth.

The ingestion layer preserves source categories privately for diagnostics. The public catalog uses Catalog Engine's canonical merchandising model derived from weighted evidence such as product title, source path, aliases, known entities and explicit rules.

Ambiguous cases are classified as `review`/`unknown` rather than forcing a wrong team or competition.

Manual overrides must survive future syncs and reclassification.

## Domains

Public merchant storefronts use verified customer-owned custom domains.

Catalog Engine platform domains are reserved for first-party surfaces such as the marketing site and authenticated admin application. They are not the public address sold to merchants.

Domain ownership/renewal remains with the customer. Catalog Engine stores and manages the connection state, verification state and routing metadata needed to serve the storefront on that domain.

A hostname is unique across tenants.

The intended lifecycle is:

`customer enters domain -> DNS instructions/verification -> routing + HTTPS healthy -> storefront smoke test -> publish`

If the customer has not connected a domain yet, the store can be `ready` and privately previewable but not publicly `published`.

## Current scale checkpoint

The repository now proves all of the following in CI:

- two independent tenant identities and memberships can coexist;
- tenant/data-plane identities are deterministic and idempotent;
- separate private supplier connections do not leak raw URLs into summaries/audit metadata;
- the Worker-safe planner generates exactly the same durable IDs as the Node provisioning planner;
- signed JWTs are validated for signature, issuer/audience and expiry;
- missing authentication configuration fails closed;
- provider redirects cannot escape the Yupoo host boundary;
- source changes are guarded once imported albums exist;
- the onboarding executor resumes from durable checkpoints;
- all D1 migrations apply cleanly to a fresh database.

These proofs run against test/temporary state. They do not create fake customer stores in production.

## Scale checkpoints

### Phase 1 — reusable single-tenant deployments

Validate onboarding and sales with a small number of stores while each store has an isolated deployment/data plane.

### Phase 2 — automated provisioning

Connect the authenticated control-plane API to background provisioning handlers, automate customer-domain activation and build the merchant admin app.

### Phase 3 — shared SaaS operations

Add billing, fleet-level sync scheduling, observability, per-tenant quotas, retry/dead-letter handling and automated data-plane lifecycle.

The rule for new engineering work is: build features for a tenant, even while tenant #0001 is the only production storefront.
