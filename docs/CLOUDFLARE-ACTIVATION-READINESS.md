# Cloudflare activation readiness

Catalog Engine now has the code-side tenant lifecycle through the final publish checkpoint, but real Workers for Platforms dispatch remains intentionally disabled in the committed production configuration.

This readiness stage is deliberately non-mutating. It exists to answer one question before we change any live Cloudflare routing: **are the dedicated provider resources and repository safety boundaries ready for a controlled two-tenant activation test?**

## Dedicated runtime configuration

The readiness CLI expects separate runtime configuration for platform provisioning/dispatch and Cloudflare for SaaS custom hostnames:

- `CLOUDFLARE_PLATFORM_ACCOUNT_ID`
- `CLOUDFLARE_PLATFORM_API_TOKEN`
- `CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE`
- `CLOUDFLARE_SAAS_ZONE_ID`
- `CLOUDFLARE_SAAS_API_TOKEN`
- `CLOUDFLARE_SAAS_CNAME_TARGET`

The repository must not contain any of those secret values. GitHub Actions should provide IDs/tokens as secrets and non-secret managed names/targets as repository variables where appropriate.

## What the manual workflow checks

`.github/workflows/cloudflare-activation-readiness.yml`:

1. runs the normal project quality gate;
2. validates that all dedicated runtime fields are configured;
3. verifies the configured Workers for Platforms dispatch namespace can be read with the dedicated platform token;
4. verifies production still points at the publish-aware Worker entry;
5. refuses readiness if a real `TENANT_DISPATCH`/dispatch namespace binding is already committed prematurely;
6. reports only safe finding codes.

It does not create D1 databases, upload tenant Workers, create custom hostnames, change DNS, deploy the platform Worker, or add dispatch bindings.

## Controlled activation sequence

When readiness is green, the provider activation should still happen in stages:

1. prepare two disposable tenant stores with different isolated D1 databases;
2. provision/import/classify/verify both tenants through the normal pipeline;
3. stage the full catalog Worker for each tenant;
4. add the real platform dispatch binding in a short-lived activation branch;
5. smoke tenant A through its script and prove tenant B product IDs return 404;
6. smoke tenant B and prove tenant A product IDs return 404;
7. verify media lookup is isolated the same way;
8. verify merchant hostname A resolves only to tenant A and hostname B only to tenant B;
9. only after those checks merge the dispatch-binding activation;
10. then allow the final publish job to make the disposable stores routable.

A failed isolation test must stop the activation. Do not fall back to the default tenant D1 for a merchant hostname.

## Merchant rollout

The first real customer should not be the provider-path experiment. After the two disposable tenants pass, enable the admin onboarding UI for a small pilot store, observe sync/runtime/domain/publish telemetry, and only then broaden tenant creation.
