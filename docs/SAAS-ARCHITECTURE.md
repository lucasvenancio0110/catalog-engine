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

Authentication is deliberately not implemented in the catalog Worker yet.

When the admin application is added:

- identity must come from an external/authentication layer;
- Catalog Engine stores an opaque `principal_id`, not passwords;
- every admin operation resolves membership for the current tenant;
- mutations require role checks;
- sensitive mutations create an audit entry;
- there are no unauthenticated public admin write endpoints.

## Provisioning lifecycle

Provisioning is modeled as a durable, idempotent state machine:

`tenant -> profile -> domain -> data plane -> source -> migrations -> import -> classify -> verify -> publish`

`tenant_provisioning_runs` stores the current checkpoint and overall state. `tenant_provisioning_steps` stores each step independently so a future background workflow can resume from the last safe checkpoint instead of starting the supplier import from zero.

The provisioning planner uses stable opaque identities for the same owner/store request. Retrying the same request therefore targets the same tenant, data-plane locator, membership, domain and provisioning run instead of silently creating duplicates.

Suggested states for the customer UI:

- `draft` — basic details not complete;
- `configuring` — source/theme/configuration in progress;
- `ready` — catalog is healthy and available for private preview, but not public yet;
- `published` — customer domain is verified and the storefront is public;
- `suspended` — intentionally unavailable.

Public publication requires a verified customer-owned domain, healthy routing/HTTPS and a successful storefront verification. Before that point the merchant reviews the store through a private preview in the admin experience.

## Supplier connections

Control-plane supplier connections store a private locator reference rather than putting the raw supplier URL into public configuration or logs. The future authenticated onboarding API will validate the pasted supplier URL, write the private source locator, and then advance the `source` provisioning step.

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

The repository now has a repeatable provisioning plan and a CI proof that two independent stores can coexist in the control plane with:

- different tenant identities;
- different data-plane locators;
- different host/domain records;
- different owner memberships;
- separate durable provisioning runs;
- no duplicate tenant/provisioning records when the first request is retried.

This proof is intentionally performed against a clean temporary database. It does not create fake customer stores in production.

## Scale checkpoints

### Phase 1 — reusable single-tenant deployments

Validate onboarding and sales with a small number of stores while each store has an isolated deployment/data plane.

### Phase 2 — automated provisioning

Create the authenticated control-plane API, background provisioning workflow, source job queue, custom-domain setup and customer admin app.

### Phase 3 — shared SaaS operations

Add billing, fleet-level sync scheduling, observability, per-tenant quotas, retry/dead-letter handling and automated data-plane lifecycle.

The rule for new engineering work is: build features for a tenant, even while tenant #0001 is the only production storefront.
