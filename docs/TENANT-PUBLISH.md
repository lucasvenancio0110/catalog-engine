# Final tenant publish checkpoint

Status: **Normative implementation contract**

The tenant is not exposed to customers when import, classification, verification, runtime staging, private preview readiness, or custom-domain SSL complete independently. The final `publish` checkpoint is the only place that flips the storefront from provisioning to live.

## Preconditions

A publish job is created only after the provisioning run reaches `publish` and all hard prerequisites are still true:

- isolated tenant D1 schema is current;
- latest catalog verification succeeded with zero findings under the current classifier version;
- full tenant catalog Worker is active and `runtime_status=verified`;
- custom hostname is active at both the business/domain state and provider/SSL state;
- store is not suspended;
- logical tenant catalog instance is still `provisioning`.

The publish runner reloads those prerequisites immediately before activation. A stale job therefore cannot publish a tenant after a domain, runtime, or verification regression.

## Private preview is not publication

Authenticated private preview may use the verified tenant runtime before the custom domain/publication checkpoint, but it is a separate read-only authority on the Catalog Engine admin host.

Preview availability does not mutate custom hostname state, mark the catalog instance `ready`, mark the store profile `published`, complete the provisioning run, or create a public Catalog Engine-branded merchant URL. The private capability is short-lived, membership-bound, server-resolved and fail-closed. Losing preview authority or letting it expire does not alter the tenant's durable catalog/publication state.

The storefront becomes public only through the atomic publish path below.

## Last-mile smoke

The publish runner requires the private Workers for Platforms dispatch binding. Immediately before activation it dispatches to the exact server-resolved tenant script and rechecks `/api/health` plus `/api/catalog/meta`. The runtime version, schema version, API/media capability flags and non-empty product count must match expectations.

The client never supplies the script name or tenant ID used by this smoke.

## Atomic exposure

Only after the last-mile smoke succeeds does one control-plane D1 batch:

1. mark `tenant_catalog_instances.status` as `ready`;
2. mark `tenant_store_profiles.setup_status` as `published` and set `published_at`;
3. keep the tenant account active;
4. complete the `publish` provisioning step;
5. complete the provisioning run;
6. mark the durable publish job successful;
7. append a deduplicated `tenant.store.published` audit event.

Because hostname routing already requires both `setup_status=published` and catalog instance `status=ready`, the merchant hostname cannot enter the dispatch path before this batch finishes.

## Failure behavior

Missing dispatch bindings fail closed before candidate discovery. A runtime/domain/verification regression returns `blocked` without mutating storefront exposure state. A failed final smoke records only a stable safe error code and leaves the catalog in provisioning for a later retry.

## Production activation state

The production Workers for Platforms dispatch path is active:

- dispatch namespace: `catalog-engine-production`;
- platform binding: `TENANT_DISPATCH -> catalog-engine-production`;
- live isolated custom-hostname smoke: `teste.loja.catalogoengine.com`;
- cross-tenant reads were verified to fail with `404` in both directions while each tenant retained its own catalog.

This activation does not weaken the publish gate. A future merchant still requires its own verified runtime, domain, catalog verification and publish checkpoint before public exposure.

## Next productization step

The current productization campaign is building the authenticated/entitled `app.catalogoengine.com` journey that invokes tenant creation, branding, source connection, initial import, preparation and authenticated private preview before later domain/publication slices. Public domain activation remains a distinct downstream checkpoint.