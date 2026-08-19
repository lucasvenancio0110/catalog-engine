# Cloudflare activation readiness — historical checkpoint

Status: **Historical / superseded by proven production activation**  
Original purpose: define the non-mutating readiness gate and controlled activation sequence before Workers for Platforms dispatch/custom-hostname isolation was enabled in production.  
Current truth: see `CURRENT-STATE.md`, `TENANT-RUNTIME-DISPATCH.md`, `TENANT-PUBLISH.md` and `CUSTOM-DOMAINS.md`.

## Why this document is retained

This file records the safety reasoning used before production dispatch activation. It must **not** be used as current-state authority.

The original checkpoint assumed the real `TENANT_DISPATCH` binding was still intentionally disabled. That assumption is no longer true.

The post-audit repository state now has:

- `TENANT_DISPATCH -> catalog-engine-production` committed in `wrangler.jsonc`;
- production dispatch proven end to end;
- custom-hostname routing proven through the retained smoke tenant;
- cross-tenant product reads proven to fail in both directions;
- publish/runtime/domain gates retained after activation.

## Production identity preserved from the readiness plan

The intended platform identities remain useful architecture context:

- `catalogoengine.com` — marketing/platform root;
- `app.catalogoengine.com` — authenticated customer administration;
- `edge.catalogoengine.com` — technical Cloudflare for SaaS CNAME target;
- `catalog-engine-production` — internal Workers for Platforms dispatch namespace.

Merchant storefronts use customer-owned domains. `edge.catalogoengine.com` is infrastructure, not the merchant-facing URL.

## Dedicated provider configuration principle

The readiness plan required separate provider/runtime configuration such as:

- `CLOUDFLARE_PLATFORM_ACCOUNT_ID`;
- `CLOUDFLARE_PLATFORM_API_TOKEN`;
- `CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE`;
- `CLOUDFLARE_SAAS_ZONE_ID`;
- `CLOUDFLARE_SAAS_API_TOKEN`;
- `CLOUDFLARE_SAAS_CNAME_TARGET`.

The durable principle remains valid: provider secrets belong in controlled secrets/configuration, not repository source, public responses or customer-visible state.

## Historical activation plan

Before activation, the intended safety sequence was:

1. create/verify the SaaS edge/fallback path;
2. prepare isolated disposable tenants/D1 databases;
3. provision/import/classify/verify test tenants;
4. stage full tenant Workers;
5. add the real platform dispatch binding in a controlled activation change;
6. prove tenant A cannot read tenant B data;
7. prove tenant B cannot read tenant A data;
8. verify media isolation;
9. verify custom-hostname routing resolves only the intended tenant;
10. keep routing fail-closed;
11. only then retain the production dispatch activation.

The important architectural outcome of that plan has now been achieved and is documented in the current runtime/publish documents.

## Post-activation rule

Future contributors must not "re-run the old activation milestone" as if dispatch were absent.

Changes to production dispatch/custom-domain behavior must instead:

- start from the currently active/proven architecture;
- preserve fail-closed tenant resolution;
- preserve per-tenant D1/runtime isolation;
- use trusted/manual production mutation paths;
- run focused regression/smoke tests;
- update `CURRENT-STATE.md` if the proven activation boundary changes.

## Merchant rollout lesson retained

The readiness plan also established a durable rollout principle:

> A real customer should not be used as the experiment that proves a new provider/isolation path.

New infrastructure primitives should be proven with isolated test tenants before becoming a normal self-service merchant path.
