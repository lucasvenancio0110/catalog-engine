# Customer-owned custom domains

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

## One-time Cloudflare platform setup

Before real customer domain automation is enabled, the Catalog Engine SaaS zone needs its Cloudflare for SaaS platform setup completed. The intended architecture uses the Catalog Engine Worker as the fallback origin. A wildcard Worker route on the SaaS zone can receive traffic from all activated customer custom hostnames, so individual Worker routes do not need to be created for every merchant.

The runtime contract is intentionally configuration-only:

- `CLOUDFLARE_SAAS_ZONE_ID` — SaaS zone identifier;
- `CLOUDFLARE_SAAS_API_TOKEN` — dedicated least-privilege secret for Custom Hostnames;
- `CLOUDFLARE_SAAS_CNAME_TARGET` — managed CNAME/fallback target customers point at.

Do not reuse or hard-code a broad account token in source. Do not return any Cloudflare token from an API response, log, audit record or error.

## Apex/root domains

Subdomain CNAME onboarding (for example `www.customer.com`) is the baseline path. Apex/root-domain onboarding can require Cloudflare for SaaS apex proxying or compatible DNS flattening/provider behavior. Catalog Engine must not claim root-domain support to customers until that platform capability has been explicitly enabled and tested on the production SaaS zone.

## Current activation boundary

The repository now contains the durable domain model, authenticated control-plane endpoints, provider adapter and a resumable provider runner. The real Cloudflare for SaaS runtime values are deliberately not committed or assumed.

Until the production SaaS zone/token/CNAME target are configured and an end-to-end custom hostname is verified, custom-domain automation is considered **implemented but not production-activated**.
