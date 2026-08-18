# Isolated tenant data planes

## Decision

Catalog Engine's target SaaS data-plane model is **one isolated D1 catalog database per tenant, attached only to that tenant's Worker inside a shared Workers for Platforms dispatch namespace**.

The platform Worker remains the hostname/control-plane boundary. It resolves the merchant hostname and, once the tenant data plane is ready, can dynamically dispatch catalog/API/media requests to the tenant Worker. Static storefront code can remain a shared platform asset because the merchant-specific data still comes from the isolated tenant Worker/database.

This replaces the unsafe alternative of placing every merchant's catalog rows into one giant public D1 and depending on a `tenant_id` predicate in every product query.

## Why Workers for Platforms

Workers for Platforms is designed around one dispatch namespace containing many isolated user Workers. A dynamic dispatch Worker selects the correct user Worker at request time. A user Worker can receive explicit resource bindings, including D1.

Catalog Engine controls all tenant Worker code; merchants do not upload code. We still use the same isolation primitive because it gives each merchant an independently bound database and prevents one tenant Worker from reading another tenant's D1 unless the platform explicitly binds it.

One production namespace is intended for all production tenant Workers. Do not create one namespace per merchant.

## Resource model

For a tenant such as `t_0123456789abcdefabcd`, the provisioning planner derives stable provider resource names:

- dispatch namespace: `catalog-engine-production`;
- user Worker: `ce-0123456789abcdefabcd`;
- D1 database: `ce-0123456789abcdefabcd`;
- logical Catalog Engine data-plane key remains separate and opaque in `tenant_catalog_instances`.

Provider IDs such as the D1 UUID and Worker/version identifiers remain control-plane-only state.

`tenant_data_plane_provider_state` records:

- tenant;
- provider;
- dispatch namespace;
- Worker script name/status/version;
- D1 database name/UUID/status;
- last provider check and safe error code.

`tenant_data_plane_jobs` records resumable provider-resource work. `tenant_data_plane_migration_jobs` separately records schema migration attempts so an infrastructure retry and a database-schema retry cannot corrupt each other's state.

## Provisioning lifecycle

A merchant must connect a supplier before Catalog Engine spends provider resources on an isolated data plane. The scheduled provisioner discovers tenants with:

- an active source connection;
- logical catalog instance still `provisioning`;
- no physical provider state yet.

It then:

1. creates deterministic provider state/job;
2. verifies that the single production dispatch namespace already exists;
3. looks up the deterministic D1 database name;
4. reuses it if a previous interrupted attempt already created it;
5. otherwise creates the tenant D1;
6. stores the D1 UUID privately;
7. uploads a tenant bootstrap Worker to the dispatch namespace;
8. binds exactly that D1 as `CATALOG_DB` to that Worker;
9. binds only the opaque tenant ID as non-secret tenant context;
10. marks the physical `data_plane` provisioning checkpoint complete;
11. advances onboarding to tenant database migrations.

The initial user Worker intentionally exposes only `/api/health`. Every catalog route returns `tenant_catalog_provisioning` until migrations/import/classification are complete. This prevents an empty or partially imported tenant catalog from being treated as ready.

## Tenant-only schema migration

Once the physical D1 and bootstrap Worker exist, a separate bounded runner discovers tenants at the `migrations` checkpoint. It reads the private supplier connection from the control plane and installs schema version 1 directly into that tenant D1 using Cloudflare's D1 Query API batch form.

The tenant database contains only the high-volume/private catalog structures needed by ingestion and storefront serving:

- media registry and product/media positions;
- normalized public categories/products/meta;
- leagues, teams and facets;
- private supplier source configuration;
- private supplier album fingerprints/retry state;
- sync runs/events;
- a tenant identity row and data-plane migration ledger.

It deliberately does **not** contain SaaS control-plane tables such as memberships, domains, subscriptions, theme catalog, audit log or provisioning runs.

The raw supplier URL is never embedded in static migration SQL. It is passed as a bound D1 query parameter at runtime and remains private tenant data.

After the schema batch, the runner performs a second D1 query to verify both the expected tenant/schema identity and exactly one active source connection. Only then does it:

- set the logical catalog instance schema version;
- mark the `migrations` checkpoint successful;
- advance onboarding to `import`.

Migration jobs have bounded attempts, retry delay and stale-job recovery. The schema and source initialization are idempotent (`IF NOT EXISTS`, conflict-safe upserts and a migration ledger), so a Worker interruption can safely retry the same D1.

CI additionally materializes the same tenant-only schema into a standalone SQLite database and asserts that required catalog/sync tables exist while control-plane tables do not.

## Idempotency and crash recovery

D1 creation cannot be treated as a one-shot action. A Worker could create a database and terminate before persisting its UUID.

For that reason, provisioning always performs a deterministic D1 name lookup before creation. Retrying the same tenant therefore reuses the already-created database rather than producing duplicates.

The user Worker upload uses a deterministic script name and an idempotent `PUT`, so retrying updates the same tenant Worker.

Provider jobs and schema-migration jobs have independent bounded automatic attempts, retry delays and stale-running reclamation. Provider error messages are collapsed to safe error codes before persistence.

## Runtime configuration

Physical provisioning and remote tenant-D1 migration remain disabled unless dedicated platform credentials are supplied:

- `CLOUDFLARE_PLATFORM_ACCOUNT_ID`;
- `CLOUDFLARE_PLATFORM_API_TOKEN`;
- `CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE` (defaults logically to `catalog-engine-production`).

The token should be dedicated to this provisioning role and have only the permissions required to create/manage D1 resources, query tenant D1 for migrations, and upload Workers for Platforms scripts. Do not reuse the broad deployment token in merchant-facing runtime code.

No platform account ID/token is committed by this implementation. With the configuration absent, both the physical provisioner and schema migration runner exit before querying control-plane D1 state or making a Cloudflare API call.

## Dispatch is a separate activation step

Creating a user Worker and isolated D1 does not automatically make that tenant routable through the public storefront Worker.

The current hostname routing guard deliberately returns `tenant_data_plane_not_attached` for tenant #0002+ instead of falling through to tenant #0001 data.

The next dispatch milestone is:

1. configure the production dispatch namespace binding on the platform Worker;
2. after hostname resolution, read the tenant's private Worker script name;
3. invoke only that user Worker for catalog/API/media traffic;
4. keep admin/auth/static platform responsibilities in the platform Worker;
5. add end-to-end isolation tests with two user Workers bound to two different D1 databases;
6. only then change a new tenant catalog instance from `provisioning` to `ready`.

## Import milestone

After schema migration, onboarding advances to `import`. The next engine milestone is to adapt the existing Yupoo ingestion/classification pipeline so a newly provisioned tenant imports into **its isolated D1**, not the control-plane/default D1.

The target import path must preserve the existing intelligent-sync properties:

- bounded supplier concurrency;
- private raw source state;
- canonical Catalog Engine taxonomy;
- media proxy registry inside the tenant data plane;
- no public supplier URLs;
- safe retry for incomplete albums;
- future incremental sync continues from the tenant's private index without rereading every product detail.

The tenant Worker remains in bootstrap/provisioning mode until that import, classification and verification are complete.

## Cost boundary

The isolated model intentionally creates one D1 and one Workers for Platforms script per active merchant. Plans/quotas should therefore account for platform script usage and D1 storage/query usage. Provisioning should happen only after the merchant has provided enough onboarding information to justify allocating resources.
