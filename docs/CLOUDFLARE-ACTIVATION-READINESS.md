# Cloudflare activation readiness

Catalog Engine now has the code-side tenant lifecycle through the final publish checkpoint, but real Workers for Platforms dispatch remains intentionally disabled in the committed production configuration.

This readiness stage is deliberately non-mutating. It exists to answer one question before we change any live Cloudflare routing: **are the dedicated provider resources and repository safety boundaries ready for a controlled two-tenant activation test?**

## Production identity

The public product domain is `catalogoengine.com`.

The canonical Cloudflare for SaaS technical edge/CNAME target is:

- `edge.catalogoengine.com`

Merchant storefronts never use that hostname as their public URL. A merchant domain such as `www.lojadojoao.com.br` points to `edge.catalogoengine.com` through DNS while the browser continues to display the merchant domain.

The recommended Workers for Platforms dispatch namespace remains an internal implementation name:

- `catalog-engine-production`

It is not customer-facing and does not need to match the public brand spelling.

Reserved platform hosts are:

- `catalogoengine.com` — marketing/platform root;
- `app.catalogoengine.com` — authenticated customer administration;
- `edge.catalogoengine.com` — SaaS edge target only; it must not be treated as an admin/platform-preview host.

## Dedicated runtime configuration

The readiness CLI expects separate runtime configuration for platform provisioning/dispatch and Cloudflare for SaaS custom hostnames:

- `CLOUDFLARE_PLATFORM_ACCOUNT_ID`
- `CLOUDFLARE_PLATFORM_API_TOKEN`
- `CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE`
- `CLOUDFLARE_SAAS_ZONE_ID`
- `CLOUDFLARE_SAAS_API_TOKEN`
- `CLOUDFLARE_SAAS_CNAME_TARGET`

For production, `CLOUDFLARE_SAAS_CNAME_TARGET` must be exactly `edge.catalogoengine.com`. The readiness gate rejects a different valid-looking hostname to prevent a merchant DNS rollout against the wrong edge.

The repository must not contain secret values. GitHub Actions should provide IDs/tokens as secrets and non-secret managed names/targets as repository variables where appropriate.

## What the manual workflow checks

`.github/workflows/cloudflare-activation-readiness.yml`:

1. runs the normal project quality gate;
2. validates that all dedicated runtime fields are configured;
3. validates that the SaaS CNAME target is exactly `edge.catalogoengine.com`;
4. verifies the configured Workers for Platforms dispatch namespace can be read with the dedicated platform token;
5. verifies production points at the publish-aware Worker entry;
6. refuses readiness if a real `TENANT_DISPATCH`/dispatch namespace binding is already committed prematurely;
7. reports only safe finding codes.

It does not create D1 databases, upload tenant Workers, create custom hostnames, change DNS, deploy the platform Worker, or add dispatch bindings.

## Controlled activation sequence

When readiness is green, the provider activation should still happen in stages:

1. create/verify `edge.catalogoengine.com` as the Cloudflare for SaaS CNAME target and fallback path;
2. prepare two disposable tenant stores with different isolated D1 databases;
3. provision/import/classify/verify both tenants through the normal pipeline;
4. stage the full catalog Worker for each tenant;
5. add the real platform dispatch binding in a short-lived activation branch;
6. smoke tenant A through its script and prove tenant B product IDs return 404;
7. smoke tenant B and prove tenant A product IDs return 404;
8. verify media lookup is isolated the same way;
9. verify merchant hostname A resolves only to tenant A and hostname B only to tenant B;
10. only after those checks merge the dispatch-binding activation;
11. then allow the final publish job to make the disposable stores routable.

A failed isolation test must stop the activation. Do not fall back to the default tenant D1 for a merchant hostname.

## Merchant rollout

The first real customer should not be the provider-path experiment. After the two disposable tenants pass, enable the admin onboarding UI for a small pilot store, observe sync/runtime/domain/publish telemetry, and only then broaden tenant creation.
