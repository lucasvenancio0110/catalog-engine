# Tenant runtime staging and dispatch

Status: **Normative implementation contract**

After import, classification and verification, Catalog Engine still does not publish a merchant directly. The verified tenant D1 must first receive the full catalog runtime and pass a dispatch smoke test.

## Runtime lifecycle

`tenant_data_plane_provider_state` distinguishes the original bootstrap Worker from the full catalog runtime through `runtime_kind`, `runtime_status`, `runtime_version` and `runtime_verified_at`. `tenant_runtime_jobs` makes staging/retry state durable.

The runtime runner discovers only tenants whose onboarding is already at `domain` and whose catalog verification job succeeded. It writes only public storefront profile metadata into the isolated D1, uploads the full tenant catalog Worker over the existing deterministic Workers for Platforms script name, and records it as `staged`.

A staged Worker is **not routable to customers**. It becomes `verified` only after the platform can resolve that exact script through the dispatch binding and successfully smoke-test both `/api/health` and `/api/catalog/meta` with a non-empty catalog.

## Tenant Worker boundary

The full tenant Worker is self-contained and receives only:

- that tenant's `CATALOG_DB` binding;
- opaque `TENANT_ID`;
- runtime version metadata.

It exposes catalog/meta/category/team/league/facet/product APIs and the tenant media proxy. It does not expose admin, memberships, domains, audit logs, provisioning jobs or control-plane APIs. Static HTML/CSS/JS remain shared platform assets.

The platform can also invoke two non-public internal paths through the server-owned dispatch binding. The ordinary data-plane command accepts only bounded single-statement read/DML batches and continues to reject DDL. A separate schema-migration command accepts no SQL; it validates the bound opaque tenant, a fixed contract version and the one current schema target, then executes only the immutable versioned statement map embedded in the User Worker through that tenant's `CATALOG_DB` binding. Existing tenant Workers are idempotently refreshed with this capability by trusted deployment CI before maintenance discovery. Only after a successful upload does CI promote the durable migration-command capability marker; until then the previously verified runtime and LKG remain routable. The cron runner never calls the Workers for Platforms administrative API: migration inspection, application and verification use the server-owned dispatch binding and the tenant's native `CATALOG_DB` binding. Neither path is an admin/public storefront API or accepts a client-selected Worker identity.

Media source URLs stay private in the tenant D1. The runtime validates image upstreams as HTTPS `photo.yupoo.com` and never returns those source URLs to storefront JSON.

## Dispatch safety

`worker/tenant-dispatch.js` is the only module that knows the dispatch-binding contract. The platform router never accepts a script name from a client. It resolves the merchant hostname through the control plane and allows tenant dispatch only when:

- custom domain is active;
- store is published;
- logical catalog instance is ready;
- physical worker is active;
- runtime kind is `catalog`;
- runtime status is `verified`;
- a controlled script name exists.

API/media traffic is then sent only to that resolved tenant script. Static assets remain on the platform Worker. An unbound/missing dispatch namespace fails with a 503 and never falls through to tenant #0001.

## Authenticated private preview

Private preview is a separate pre-publication dispatch authority on `app.catalogoengine.com`; it does not reuse the public custom-domain gate and does not make a tenant publicly routable.

The portal may create a private preview session only after the authenticated principal's active tenant membership, tenant storefront state, verified catalog runtime and latest current-classifier verification with zero blocking findings are revalidated server-side. The browser never supplies or receives a Worker script name, D1 identifier or runtime locator as routing authority.

The session contract is intentionally bounded:

- the browser receives only the fixed path `/preview`;
- a cryptographically random capability is stored only in a host-only `__Host-` cookie with `HttpOnly`, `Secure` and `SameSite=Strict`;
- only the SHA-256 hash of that capability plus opaque tenant/principal ownership and expiry is persisted in the control plane;
- the initial PB9 lifetime is 30 minutes and logout explicitly revokes the principal's preview sessions;
- every preview catalog/media request revalidates the still-active membership, runtime and verification authority before dispatch;
- expired, missing, revoked or regressed authority fails closed and never falls back to the default tenant;
- only read-only storefront catalog/media paths are allowlisted; admin, health and internal runtime commands are not preview resources.

`/preview` serves the same shared storefront HTML/CSS/JS used for publication. Its root `/api/*` and `/media/*` requests are intercepted only while the valid private capability exists and are dispatched to the exact server-resolved isolated tenant runtime. This preserves the effective tenant catalog, brand and media behavior instead of maintaining a second simulated preview storefront.

Private preview responses are `private, no-store`, non-indexable and no-referrer. Internal dispatch/cache request identity is tenant-scoped so one tenant's preview media cannot collide with another tenant's cache authority. These preview controls do not modify custom hostname state, `tenant_catalog_instances.status`, `tenant_store_profiles.setup_status`, or the final publish checkpoint.

## Publish gate

Custom-domain SSL readiness alone can no longer advance onboarding to `publish`. `tenant-publish-gate.js` requires **both** an active provider/SSL custom domain and a verified full tenant runtime. Whichever prerequisite completes last re-evaluates the shared gate.

The final publish action remains a separate milestone. Runtime verification or private preview availability does not mark a merchant profile published or a catalog instance ready automatically.

## Production activation state

The production public dispatch boundary is active and proven:

- `wrangler.jsonc` binds `TENANT_DISPATCH` to `catalog-engine-production`;
- the platform resolves the Worker script name from trusted control-plane provider state;
- `teste.loja.catalogoengine.com` proved custom hostname -> platform router -> Workers for Platforms -> isolated tenant D1 end to end;
- the smoke tenant could read its own product but not a default-tenant product;
- the default tenant could not read the smoke-tenant product;
- missing or invalid tenant routing still fails closed.

The retained smoke tenant is validation infrastructure, not a shortcut for future merchant publication. Every real tenant must pass the same runtime/domain/publish gates independently.

PB9's authenticated private-preview implementation is repository/PR-proven until its trusted production deploy and tenant-isolation canary complete. Do not treat PR preview deployment as production activation evidence.