# Catalog Engine — Current State

Status: **Living implementation/proof truth**  
Snapshot refreshed: **2026-09-03**  
Repository: `lucasvenancio0110/catalog-engine`

This document records the implementation/proof level that is true now. Focused normative documents own durable contracts; historical closure documents retain detailed past evidence.

## Live GitHub / production baseline

Current integrated `main` before the active auth-runtime remediation branch:

- SHA: `9561c41a8d4c230a5c9e2f4bdbb20a1ad1389fa3`;
- commit: `PB3: enable real merchant store creation (#194)`;
- trusted application deploy: run `33710776661`, deployment **#118**, **SUCCESS** on that exact SHA;
- application deploy status: `catalog-engine/application-deploy = success`;
- deploy quality/build/migrations/Worker/static assets/binding verification/automation-boundary checks/catalog smoke: success.

Current production activation boundary remains:

```text
TENANT_IMPORT_AUTOMATION_ENABLED=1
TENANT_SYNC_AUTOMATION_ENABLED=0
TENANT_SYNC_ACTIVE_COHORT=""
TENANT_SYNC_MAX_JOBS_PER_TICK=1
```

Automatic **initial tenant import is enabled**. Recurring tenant Intelligent Sync remains **disabled**. M7E remains separately decision-gated and is not activated by the PB campaign.

## Production platform boundary

Current production foundations include:

- Cloudflare Workers Paid / Workers for Platforms;
- platform Worker `catalog-engine`;
- production dispatch namespace `catalog-engine-production`;
- control-plane D1 binding `CATALOG_DB`;
- per-tenant isolated D1 + User Worker model for non-default tenants;
- scan/detail Queues and DLQs for initial tenant import;
- five-minute scheduler;
- `app.catalogoengine.com` as customer-admin host;
- authenticated `/api/admin/*` control-plane boundary;
- membership/role checks for tenant-scoped authority;
- tenant provisioning checkpoints, isolated runtime provisioning, Queue initial import, CEI/classification, verification, custom-domain path and publication gate.

Supplier URLs, raw provider IDs, source media locators, runtime locators, D1/Cloudflare identifiers, credentials and private CEI evidence remain private.

## Default production tenant

The historical catalog remains one explicit tenant instance:

- tenant ID: `t_00000000000000000001`;
- data-plane/runtime compatibility identity: `catalog-engine-default`;
- source key: `primary`.

The first real merchant beta tenant must be a separate opaque tenant. PB3 regression coverage explicitly proves its deterministic tenant identity does not reuse the historical default tenant.

## M7 / M8 / M9 state

- M7A through **M7D10**: **PRODUCTION GREEN** within their bounded contracts.
- M7D11 — Safe Change and Review Feed: **PLANNED**.
- M7E — Deliberate Activation: **DECISION REQUIRED**; recurring sync remains off.
- M8 Media Engine hardening: future/unproven work.
- M9A: **PRODUCTION GREEN**.
- M9B: **IN PROGRESS — PAUSED** by the owner-authorized first-merchant PB sequencing decision.
- M9C/M9D: planned/unproven.

Known M9B visual debt remains deferred, including the bottom-dock `Produtos` icon audit. Do not mix it into PB blocker remediation unless it directly blocks the customer portal.

## First real merchant PB campaign — current truth

Detailed order and per-slice contracts remain owned by `PORTAL-BETA-EXECUTION.md`.

| Slice | Current status | Evidence / remaining gate |
| --- | --- | --- |
| PB0 — Live Truth + Sequencing Decision | **GOVERNANCE GREEN / COMPLETE** | PR #188 + closure #189; integrated governance baseline `24d7cef2a17ce3f73636611dd80187ada3f578d7`. |
| PB1 — Authentication Foundation | **BLOCKED — code/deploy green, live IdP config missing** | PR #190 head `409dc220c9f8f73e50316e97f4747669faedc7de`; merge `6c0d3e66db4f407c7328bd3924985d29fdee28c5`; application deploy #115 / run `33706767968` success. Live signup/login/logout cannot be proven because the four production OIDC bindings are absent. |
| PB2 — Account + Beta Entitlement | **PRODUCTION GREEN** | PR #192 integrated, remote D1 migration repair #193 integrated as `d810d8b8c4a272f15f17f9b225ffc77ac3296190`; trusted deploy #117 proved migration `0023`, Worker/static smoke and sync-off boundary. |
| PB3 — Create Store | **BLOCKED — code/deploy green, customer proof waits on PB1** | PR #194 final tested head `a1342f404a44fed1788ce79377f3fd0999006c4f`; merge `9561c41a8d4c230a5c9e2f4bdbb20a1ad1389fa3`; 7/7 applicable PR workflows success; trusted deploy #118 success; integrated quality reported 142 test files / 696 tests. Real beta-user tenant creation/reload proof cannot occur until live auth is configured. |
| PB4 — Branding | **PLANNED — NOT STARTED** | Must not begin before PB3 reaches honest Production Green and this state is updated. |
| PB5–PB12 | **PLANNED** | Preserve the approved order and per-slice gates. |

### PB1 implementation that already exists

The repository already contains:

- provider-neutral backend JWT/OIDC validation in `worker/admin-auth.js`;
- Auth0 as the first beta identity-provider adapter;
- Authorization Code + PKCE S256;
- signup/login/logout/callback handling;
- state verification and bounded transaction lifetime;
- access-token refresh with refresh-token rotation requirement;
- browser auth state stored only in `sessionStorage`, not a customer password database;
- admin-host-only `/api/auth/config` projection;
- fail-closed behavior when OIDC runtime configuration is absent;
- responsive portal authentication UI.

The four runtime values required for the live path are:

```text
ADMIN_AUTH_ISSUER
ADMIN_AUTH_AUDIENCE
ADMIN_AUTH_JWKS_URL
PORTAL_AUTH_CLIENT_ID
```

Trusted deploy #118 listed the deployed Worker bindings and none of these four names were present. The deploy workflow at that checkpoint also constructed its Wrangler `--secrets-file` from only the Workers for Platforms account/token bindings. Therefore live Auth0 configuration is a **proven production blocker**, not an assumed one.

The active remediation branch may add an all-or-none trusted deployment path for these four values. That remediation does not itself create the missing external Auth0 tenant/application/API values and does not make PB1/PB3 Production Green.

## PB2 entitlement authority

PB2 introduced the bounded first-beta grant as server-side authority:

```text
explicit auditable pilot grant
-> normalized account entitlement
-> maxStores = 1
-> transaction-local store-creation enforcement
```

Current behavior includes:

- opaque authenticated principal registration only;
- normalized safe entitlement projection on `/api/admin/session`;
- manual trusted-main grant/revoke workflow with explicit confirmation;
- expiry/revocation and immutable entitlement audit events;
- transactional owner-membership/store-slot enforcement in D1;
- no hard-coded email/name/provider-subject authorization bypass;
- no public free-trial or billing claim.

A store entitlement does not enroll recurring sync.

## PB3 create-store implementation

The deployed PB3 path now includes:

- mobile-first create-store UI for name, slug and currency only;
- authenticated POST to the existing canonical `POST /api/admin/stores` control-plane mutation;
- deterministic opaque tenant provisioning distinct from the default tenant;
- same-store idempotent replay;
- concurrent one-store quota race protection;
- server entitlement authority before new creation;
- merchant-safe response projection that excludes data-plane/catalog/membership/runtime locators;
- durable reload behavior: after success the portal reloads and trusts `/api/admin/session`, not client-fabricated store state;
- loading/error/401/mobile/touch/accessibility coverage within the bounded PB3 implementation.

This is **deployed code**, but PB3 Definition of Done still requires a real authenticated beta user to create a durable tenant through production and then recover that store through session reload.

## Exact blocker to the next slice

PB4 must not start yet.

To unblock PB1/PB3:

1. configure the external Auth0 SPA/application and API for `app.catalogoengine.com` according to the PB1 contract;
2. provide all four OIDC runtime values through the trusted deployment path — partial configuration must fail closed;
3. deploy and prove `/api/auth/config` becomes configured without exposing backend secrets;
4. complete a real signup/login/logout/session-expiry/refresh path;
5. grant the authenticated opaque principal the bounded pilot entitlement;
6. create the first real merchant store through the PB3 portal UI;
7. prove in durable control-plane state that the new opaque tenant, owner membership, profile/catalog/provisioning records exist once and that session reload returns the same store;
8. confirm recurring tenant Intelligent Sync remains off;
9. update this state and the campaign evidence to **PB3 PRODUCTION GREEN**;
10. only then begin PB4.

## Explicitly not confirmed / not Green

Do not claim without later evidence:

- configured production OIDC identity provider;
- real signup/login/logout on `app.catalogoengine.com`;
- first real merchant tenant created through the portal;
- first beta customer reload/session recovery proof;
- tenant branding/logo pipeline;
- real beta source connected through portal UX;
- first real beta isolated import/CEI/verification completion;
- authenticated private preview;
- PB end-to-end browser proof;
- M7D11 completion;
- M7E activation;
- M8 completion;
- M9B/M9C/M9D completion;
- public billing integration;
- broad beta/public-launch readiness.

## Current execution rule

The active execution point is **PB1/PB3 production-auth blocker remediation**.

Repository work may improve the safe deployment/proof path required to configure the four OIDC bindings. It may not start PB4 or later PB behavior while real login and real PB3 store creation remain unproven.

Recurring tenant Intelligent Sync remains disabled throughout the PB campaign unless the owner separately authorizes M7E.
