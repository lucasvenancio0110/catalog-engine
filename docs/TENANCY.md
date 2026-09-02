# Catalog Engine — Tenancy

Status: **Normative product/architecture contract**  
Scope: account, store/tenant, memberships, isolation, provisioning entitlement and lifecycle.

## Definition

A **tenant** is one isolated merchant store inside Catalog Engine.

Customer-facing language normally says **loja**. Internal architecture may say **tenant**.

The relationship is:

`account -> trusted entitlements -> one or more stores/tenants`

For the normal public commercial path, trusted entitlements derive from the account subscription/billing state. Explicit governed pilot grants may exist as a bounded entitlement source when separately authorized.

Do not model the platform as one global catalog with cosmetic store filters.

## Core invariants

1. Every store-owned resource resolves to exactly one tenant unless explicitly global/platform-level.
2. Tenant data must not leak across stores.
3. High-volume catalog data uses an isolated tenant data plane rather than relying only on a `tenant_id` predicate in every public product query.
4. Customer-facing hostnames resolve server-side to one tenant before tenant data is served.
5. A custom hostname belongs to only one tenant.
6. Tenant creation is gated by server-evaluated account entitlements.
7. Provisioning must be idempotent, resumable and checkpointed.
8. A failed tenant job must not corrupt or block another tenant.
9. Tenant private source URLs/credentials/state never become public storefront data.
10. Customer UI says store/shop concepts; infrastructure details remain internal.
11. An identity-provider claim or client-visible flag is never direct tenant provisioning authority.

## Account is not tenant

An account represents the customer/business identity and its commercial/entitlement relationship.

A tenant represents one store/catalog operation.

An account can therefore have:

- zero stores before entitlement/onboarding;
- one store on a basic plan or bounded beta grant;
- several stores on a larger plan/add-on;
- multiple authorized users/memberships.

Do not assume one owner principal maps permanently to one tenant.

## Store-creation entitlement gate

Current public product contract:

> The normal self-service tenant provisioning flow is unavailable until trusted billing state grants the account an entitlement to create a store.

The server checks the evaluated entitlement during store creation.

Creating a UI record without provisioning resources may be possible only if product design explicitly calls it a draft account-level object; do not accidentally create real tenant resources before entitlement.

### First real merchant beta exception

The owner-authorized PB0–PB12 campaign may use an explicit **pilot entitlement grant** as a trusted server-side entitlement source before public billing integration exists.

The beta grant must:

- be auditable and revocable/expirable;
- bind to normalized account/principal authority rather than a hard-coded email/name/provider subject;
- initially enforce a bounded store allowance such as `maxStores=1`;
- be evaluated in the same store-creation server boundary used by future billing entitlements;
- never allow an anonymous or ungranted authenticated principal to provision a tenant;
- avoid destructive tenant deletion merely because the grant later expires/revokes;
- not imply recurring sync/publication capabilities that are separately gated.

This is not a general free-trial contract. See `PORTAL-BETA-EXECUTION.md`, `BUSINESS-MODEL.md`, `BILLING-PAYMENTS.md` and `SALES-SUBSCRIPTIONS.md`.

## Tenant ownership

A tenant owns or references its own:

- store profile/branding;
- memberships/roles;
- source connections;
- CEI tenant memory/manual overrides;
- provisioning run/checkpoints;
- data-plane locator;
- catalog products/taxonomy/facets;
- private supplier/source index;
- sync events/reconciliation state;
- domain(s);
- runtime/provider state;
- audit history;
- storefront publication status.

Billing belongs primarily to the account, while evaluated entitlements govern what tenants can exist/use.

## Control plane

The shared control plane owns low-volume platform metadata such as:

- accounts/principals;
- tenant identities;
- memberships/roles;
- normalized billing/subscription mirror when implemented;
- entitlement grants/evaluation state;
- tenant profile/status;
- source-connection metadata;
- domain state;
- provisioning checkpoints;
- data-plane/runtime locator state;
- audit events.

Control-plane queries must enforce authenticated principal membership/role rules.

## Tenant data plane

Each tenant's high-volume catalog data plane is explicitly isolated.

Current strategic model:

- one D1 database per tenant/store or another equivalently isolated shard;
- one tenant runtime/User Worker where the current Workers for Platforms architecture requires it;
- server-resolved dispatch only after tenant/domain/provider state is verified.

The data plane contains:

- normalized products;
- canonical categories;
- merchandising entities/facets;
- media mappings/registry;
- private source index/fingerprints;
- sync events/reconciliation state;
- CEI classification output/tenant-scoped learning where appropriate.

See `TENANT-DATA-PLANES.md` for detailed implementation rules.

## Default production tenant

The original production catalog remains a tenant instance, not global platform truth.

Current default tenant identity remains documented in `SAAS-ARCHITECTURE.md`/implementation.

New code must not special-case the default catalog in ways that future tenants cannot use unless the exception is an explicitly documented migration/compatibility path.

A beta merchant tenant must be newly created and must not reuse, overwrite, clone as authority from, or silently fall back to the default tenant.

## Tenant routing

Storefront routing follows:

`hostname/authorized preview -> verified tenant resolution -> tenant runtime/data plane -> storefront/API`

It must fail closed.

An unknown/unverified hostname or invalid preview authority may not silently fall through to another merchant's tenant or to the default catalog.

Infrastructure-level health endpoints may exist outside tenant routing only when explicitly designed that way; they must not expose tenant data.

## Custom domains

The merchant's public storefront uses their own verified domain.

Current technical platform roles include:

- `catalogoengine.com` — marketing;
- `app.catalogoengine.com` — customer portal;
- `edge.catalogoengine.com` — SaaS CNAME target;
- `origin.catalogoengine.com` — internal fallback origin.

Customer domains are mapped uniquely to tenants. Publication requires verified/healthy domain + runtime/storefront checks according to `CUSTOM-DOMAINS.md` and `TENANT-PUBLISH.md`.

## Private preview

A tenant can reach a `ready`/previewable state before its public domain is active.

Private preview must:

- require authorized app context;
- resolve membership and the correct tenant server-side;
- derive runtime/data-plane authority from server-owned state;
- reflect the same effective tenant catalog/theme intended for publication;
- not become an unintended public Catalog Engine-branded storefront address;
- fail closed rather than falling back to the default tenant.

## Provisioning lifecycle

The canonical tenant lifecycle is resumable and may include:

`trusted entitlement -> tenant identity -> profile -> source -> isolated data plane -> migrations -> import -> CEI/classify -> verify/private preview -> custom domain -> publish`

Some steps can be transactionally combined, but their durable state/checkpoint semantics must remain clear.

Successful steps are not replayed unnecessarily. Failed steps resume safely.

## Idempotency

Repeated creation/provisioning requests caused by retries, double taps or background recovery must target the same intended tenant/run when the idempotency identity matches.

Do not silently create duplicate tenant databases/runtimes/domains because a request was retried.

Entitlement enforcement and idempotency are both required: an allowed first request must not make a retried second HTTP request consume or create an unintended second store.

## Tenant states

Customer-facing/store lifecycle can map to normalized states such as:

- `draft` — initial configuration incomplete;
- `provisioning/configuring` — background creation/import/classification active;
- `ready` — healthy private preview available, not publicly published;
- `published` — verified custom domain/storefront online;
- `attention` — recoverable issue requiring action/retry;
- `suspended` — intentionally unavailable/restricted;
- `deleting`/`deleted` — only when a future explicit retention/deletion workflow exists.

Do not overload one status with every subsystem failure; domain/source/billing/entitlement/runtime can have their own detailed state.

## Billing/entitlement restriction

A billing problem or pilot-grant expiry does not erase the tenant.

The account entitlement may move through valid/restricted states while tenant resources remain preserved.

Reactivation after trusted entitlement recovery should be automated where policy allows.

Destructive retention/deletion requires a separate explicit policy.

## Membership and authorization

Catalog Engine stores opaque authenticated principals and tenant memberships.

Potential tenant roles:

- owner;
- admin;
- editor;
- viewer.

Every tenant-scoped admin read/write resolves active membership server-side.

Cross-tenant identifiers supplied by a client are never sufficient authorization.

Sensitive mutations require role checks and audit events.

The principal that successfully creates a tenant under a valid entitlement becomes its owner through the canonical store-creation transaction; do not add a beta-only parallel ownership path.

## CEI tenant isolation

CEI has global knowledge plus tenant/supplier memory, but tenant-specific learning must not leak across tenants.

Examples of tenant data:

- merchant override;
- ambiguous alias decision;
- supplier-specific local convention;
- private source evidence.

Promotion into global knowledge must be an explicit governed process that strips private context and requires sufficient evidence.

## Source isolation

A source connection is tenant-owned private configuration.

A source URL/credential must not be returned from public storefront APIs or logs/artifacts where it is not needed.

Multiple tenants may connect the same public supplier, but that does not merge their tenant data planes or merchant overrides.

## Multiple sources per tenant

The model should permit one tenant to have more than one source in the future.

CEI can normalize/merge/deduplicate the resulting catalog while source provenance stays private.

Do not design tenant identity around one permanent `primary Yupoo URL` assumption.

The first beta may intentionally allow one source without weakening this future model.

## Observability

Platform operations should be able to answer without exposing private data:

- how many tenants are active/ready/published/suspended;
- which provisioning step is failing;
- data-plane/runtime health;
- sync/research/classification health;
- domain state;
- billing/entitlement state;
- retry/dead-letter counts.

One tenant's incident should be diagnosable without inspecting another tenant's private catalog.

## Automation-first rule

Normal tenant lifecycle operations must be orchestrated automatically:

- provision;
- migrate;
- import;
- classify;
- verify;
- connect/poll domain state;
- publish;
- sync when the applicable activation/entitlement authority allows it;
- suspend/reactivate where policy allows.

The Catalog Engine owner handles exceptions, not every store.

A bounded beta grant may be operator-issued, but it must still feed the same automated tenant lifecycle rather than triggering manual D1/Worker/source setup.

## Final tenant decision rule

For every new feature ask:

> What account/entitlement/tenant owns this, where is its trust boundary, and could a missing check expose another store?

If ownership/isolation is unclear, the feature is not ready to implement.
