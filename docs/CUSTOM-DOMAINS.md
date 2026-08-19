# Customer-owned custom domains

Status: **Normative architecture/product contract**

Catalog Engine public storefronts are sold on customer-owned domains. Platform hostnames are reserved for the Catalog Engine marketing/admin surfaces and private preview infrastructure.

## Product lifecycle

The merchant flow is:

1. finish catalog import/classification;
2. review the store in private preview;
3. enter a customer-owned hostname;
4. Catalog Engine creates durable domain/provider state and a provisioning job;
5. the provider returns hostname/certificate validation information;
6. the admin UI shows only the DNS/HTTP records the customer must configure;
7. Catalog Engine refreshes provider state;
8. the domain checkpoint succeeds only when hostname activation and SSL are both active;
9. a final storefront smoke test runs on the customer hostname;
10. only then can `publish` complete.

Changing a domain that already has a provider allocation requires an explicit disconnect first. A typo in an unprovisioned pending domain can be replaced without leaving an orphan provider hostname.

## Control-plane API

All routes require the authenticated `/api/admin/*` boundary and tenant membership.

- `GET /api/admin/stores/:tenantId/domain` — safe domain/provider state and customer-actionable validation records.
- `PUT /api/admin/stores/:tenantId/domain` — attach an idempotent customer-owned hostname and enqueue provisioning.
- `POST /api/admin/stores/:tenantId/domain/refresh` — enqueue/retry provider state refresh after DNS changes.
- `DELETE /api/admin/stores/:tenantId/domain` — disable the storefront hostname immediately in Catalog Engine and enqueue provider cleanup when needed.

Mutations require the `owner` or `admin` role.

## Durable state

`tenant_domains` remains the business-level domain record. Migration `0009_custom_domain_provider_state.sql` adds:

- `tenant_domain_provider_state` — provider hostname ID, hostname activation status, SSL status, customer DNS/HTTP validation instructions and last safe error code;
- `tenant_domain_jobs` — resumable `provision`, `refresh` and `delete` work with attempts/retry state.

Provider credentials are never stored in these tables.

## Cloudflare for SaaS adapter

The current provider adapter targets Cloudflare Custom Hostnames. It supports:

- creating a custom hostname;
- reading current activation/certificate state;
- restarting HTTP domain-control validation after the customer points DNS;
- deleting the provider hostname;
- extracting ownership TXT and certificate validation records into provider-neutral domain state.

The create request uses HTTP domain validation, DV certificates, no wildcard, and minimum TLS 1.2.

A hostname is **not** considered ready merely because one provider status is green. Catalog Engine requires both the custom-hostname status and SSL status to be `active`. Publication still needs a successful request to the actual customer hostname after routing is configured.

## Current Cloudflare platform setup

The production SaaS zone has completed the platform setup required for the proven custom-hostname path.

Current roles are:

- `origin.catalogoengine.com` — active Cloudflare for SaaS fallback/internal origin;
- `edge.catalogoengine.com` — stable proxied CNAME target customers can be instructed to use;
- wildcard/platform Worker routing — receives activated merchant hostnames;
- `teste.loja.catalogoengine.com` — retained smoke hostname that proved end-to-end custom-hostname routing, TLS, tenant resolution, Workers for Platforms dispatch and isolated D1 behavior.

The runtime/provider contract remains configuration-only:

- `CLOUDFLARE_SAAS_ZONE_ID` — SaaS zone identifier;
- `CLOUDFLARE_SAAS_API_TOKEN` — dedicated least-privilege secret for Custom Hostnames in the long-running application path;
- `CLOUDFLARE_SAAS_CNAME_TARGET` — managed CNAME/fallback target customers point at.

Do not hard-code tokens in source. Do not return any Cloudflare token from an API response, log, audit record or error. Broad bootstrap/CI credentials, when temporarily used for platform administration, must remain secret and must not become the customer-runtime credential model.

## Platform-owned hostnames

Catalog Engine also owns first-party platform hostnames such as `app.catalogoengine.com`.

These are not merchant custom hostnames and therefore are not entries in `tenant_domains`. Their DNS can be managed idempotently by platform automation as long as the automation:

- changes only explicitly declared Catalog Engine hostnames;
- fails closed when a conflicting DNS record type exists;
- never deletes unrelated records to make a desired state fit;
- verifies the live HTTPS surface after the DNS change;
- keeps provider credentials in CI/runtime secrets only.

## Apex/root domains

Subdomain CNAME onboarding (for example `www.customer.com`) is the baseline path. Apex/root-domain onboarding can require Cloudflare for SaaS apex proxying or compatible DNS flattening/provider behavior. Catalog Engine must not claim root-domain support to customers until that platform capability has been explicitly enabled and tested on the production SaaS zone.

## Current activation boundary

The provider path for customer custom hostnames is **production-activated and technically proven** through the retained isolated smoke tenant.

What is not yet product-complete is the self-service customer journey in `app.catalogoengine.com`: authenticated merchant access, billing entitlements, domain entry/status UX and automatic invocation of the already-proven provider/runtime capabilities. Technical activation must not be confused with sellable customer onboarding completeness.
