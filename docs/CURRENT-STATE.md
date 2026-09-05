# Catalog Engine — Current State

Status: **Living implementation/proof truth**  
Snapshot refreshed: **2026-09-05**  
Repository: `lucasvenancio0110/catalog-engine`

This document records the implementation/proof level that is true now. Focused normative documents own durable contracts; historical closure documents retain detailed past evidence.

## Live GitHub / production baseline

Current proven PB5 production runtime baseline:

- SHA: `5f01b679804c45246077eb292ad2648ab6b20b48`;
- commit: `PB5: connect real merchant catalog source (#209)`;
- trusted application deploy: run `33955408377`, successful on that exact SHA;
- application deploy status: `catalog-engine/application-deploy = success`;
- deploy quality/build/D1/Worker/static assets/binding verification/automation-boundary checks/catalog smoke: success;
- repository deploy quality proof: 146 test files / 726 tests green;
- private R2 brand-asset binding `BRAND_ASSETS` remains present;
- Images binding remains present;
- the real CROCCODILOS merchant connected a Yupoo source, then reloaded/re-entered and recovered only safe connected state without re-entering or rendering the private supplier URL.

PB5 is **PRODUCTION GREEN**. Detailed evidence is recorded in `PB5-CLOSURE-2026-09-05.md`.

PB6 — Source Scope / Import Decision is **PLANNED — NEXT**. Live-code audit shows the decision must become real server-side import authority rather than a cosmetic selector because automatic initial-import discovery is enabled.

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
- private R2 `BRAND_ASSETS` binding for tenant-owned normalized branding assets;
- Images binding for bounded image inspection/normalization;
- per-tenant isolated D1 + User Worker model for non-default tenants;
- scan/detail Queues and DLQs for initial tenant import;
- five-minute scheduler;
- `app.catalogoengine.com` as customer-admin host;
- authenticated `/api/admin/*` control-plane boundary;
- membership/role checks for tenant-scoped authority;
- tenant provisioning checkpoints, isolated runtime provisioning, Queue initial import, CEI/classification, verification, custom-domain path and publication gate.

Supplier URLs, raw provider IDs, source media locators, runtime locators, D1/Cloudflare identifiers, R2 object keys, credentials and private CEI evidence remain private.

## Default production tenant

The historical catalog remains one explicit tenant instance:

- tenant ID: `t_00000000000000000001`;
- data-plane/runtime compatibility identity: `catalog-engine-default`;
- source key: `primary`.

The first real merchant beta tenant is separate from this compatibility tenant. New merchant flows must never reuse or silently fall back to the default tenant.

## M7 / M8 / M9 state

- M7A through **M7D10**: **PRODUCTION GREEN** within their bounded contracts.
- M7D11 — Safe Change and Review Feed: **PLANNED**.
- M7E — Deliberate Activation: **DECISION REQUIRED**; recurring sync remains off.
- M8 Media Engine hardening: future/unproven work.
- M9A: **PRODUCTION GREEN**.
- M9B: **IN PROGRESS — PAUSED** by the owner-authorized first-merchant PB sequencing decision.
- M9C/M9D: planned/unproven.

Known M9B visual debt remains deferred unless it directly blocks the PB customer journey. The active PB0–PB12 sequencing exception in `PORTAL-BETA-EXECUTION.md` remains the temporary execution order; after PB12 the default return point is the paused M9B work unless the owner makes another explicit sequencing decision.

## First real merchant PB campaign — current truth

Detailed order and per-slice contracts remain owned by `PORTAL-BETA-EXECUTION.md`.

| Slice | Current status | Evidence / remaining gate |
| --- | --- | --- |
| PB0 — Live Truth + Sequencing Decision | **GOVERNANCE GREEN / COMPLETE** | PR #188 + closure #189; integrated governance baseline `24d7cef2a17ce3f73636611dd80187ada3f578d7`. |
| PB1 — Authentication Foundation | **PRODUCTION GREEN** | Auth0 SPA/API configured; all four production OIDC runtime values deployed; real signup/login/callback/session/logout path reached the production portal. Blank deep-callback asset bug was repaired before final proof. |
| PB2 — Account + Beta Entitlement | **PRODUCTION GREEN** | PR #192 + migration repair #193; production migration `0023`; audited pilot entitlement granted to the authenticated opaque principal; portal showed `0/1` before store creation. |
| PB3 — Create Store | **PRODUCTION GREEN** | Real merchant created **CROCCODILOS** through `app.catalogoengine.com`; final integrated SHA `c42e9a5e2d67920678b998d64c6a0923546a7289`; deploy #125/run `33947883746` success; reload returned the persisted store and `1/1` allowance. Detailed evidence: `PB3-CLOSURE-2026-09-05.md`. |
| PB4 — Branding | **PRODUCTION GREEN** | PR #204 shipped branding/profile/validation; PR #205 recovered logo storage to private R2. Exact runtime SHA `dfff6204e42a862c42cc091b70fc06243016e155`; deploy #127/run `33952906777` success; real CROCCODILOS save + reload/re-entry rendered the persisted logo and branding state. Detailed evidence: `PB4-CLOSURE-2026-09-05.md`. |
| PB5 — Source Connection | **PRODUCTION GREEN** | PR #209; exact runtime SHA `5f01b679804c45246077eb292ad2648ab6b20b48`; deploy run `33955408377` success; 146 test files / 726 tests green; real CROCCODILOS source connection persisted across reload/re-entry with safe connected-state projection and no private locator rendering. Detailed evidence: `PB5-CLOSURE-2026-09-05.md`. |
| PB6 — Source Scope / Import Decision | **PLANNED — NEXT** | Must expose one truthful merchant import decision and make initial-import discovery honor the durable decision. Provider-safe discovery may be used only if it can avoid raw supplier IDs/URLs; otherwise beta uses explicit full-catalog import. |
| PB7–PB12 | **PLANNED** | Preserve approved order and per-slice gates. |

## PB1 authentication authority

Production now has the provider-neutral JWT/OIDC boundary plus Auth0 as the first configured beta identity provider:

- Authorization Code + PKCE S256;
- signed token issuer/audience/JWKS validation;
- signup/login/logout/callback/session restoration;
- bounded state/transaction handling;
- refresh-token rotation requirements;
- browser auth state in `sessionStorage`;
- Catalog Engine stores no customer password;
- admin-host-only safe auth configuration projection;
- fail-closed behavior for missing/partial OIDC runtime configuration.

The production runtime values are managed through the trusted deployment path and are not documented with secret values.

## PB2 entitlement authority

PB2 introduced the bounded first-beta grant as server-side authority:

```text
explicit auditable pilot grant
-> normalized account entitlement
-> maxStores = 1
-> transaction-local store-creation enforcement
```

Current behavior includes:

- opaque authenticated principal registration;
- normalized safe entitlement projection on `/api/admin/session`;
- trusted-main grant/revoke workflow with explicit confirmation;
- expiry/revocation and immutable entitlement audit events;
- transactional owner-membership/store-slot enforcement in D1;
- no hard-coded email/name/provider-subject authorization bypass;
- no public free-trial or billing claim.

A store entitlement does not enroll recurring sync.

## PB3 production proof

The PB3 production path now includes and has been exercised by a real merchant:

- mobile-first create-store UI for name, slug and currency;
- authenticated POST to the canonical `POST /api/admin/stores` mutation;
- deterministic opaque tenant provisioning distinct from the default tenant;
- same-store idempotent replay;
- concurrent one-store quota protection;
- server entitlement authority before new creation;
- merchant-safe response projection that excludes data-plane/catalog/membership/runtime locators;
- durable reload behavior through `/api/admin/session` rather than a client-fabricated store object;
- loading/error/401/mobile/touch/accessibility behavior within the bounded PB3 implementation.

The first-real-user proof exposed and repaired four integration defects before PB3 acceptance:

1. deep callback assets used the wrong relative base and produced a blank screen;
2. replay lookup referenced nonexistent `tenant_profiles`;
3. portal create payload used `name` instead of canonical `storeName` when delegating;
4. replay lookup read nonexistent `catalog_tenants.currency` instead of profile currency.

The final merchant attempt succeeded only after all four repairs were integrated and deployment #125 was green.

## PB4 production proof

The deployed PB4 path provides:

- validated store/profile name editing;
- supported theme preset selection;
- primary/secondary semantic colors with deterministic accessible text fallback;
- optional WhatsApp/Instagram fields;
- safe merchant logo upload restricted to approved raster formats for beta;
- MIME, byte-size, decoded-image and dimension validation;
- bounded WebP normalization through the Images binding;
- private R2 persistence through `BRAND_ASSETS`;
- tenant ownership/isolation for uploaded assets;
- public profile state containing only a safe tenant-owned opaque logo path;
- mobile-first Appearance/branding UX with loading, success, error, disabled, focus and touch states;
- no arbitrary merchant HTML/JavaScript/CSS;
- no SVG upload until a separate sanitization contract exists;
- no base64 image blob in D1;
- no supplier-hosted logo dependency.

The first real CROCCODILOS PB4 attempt exposed a production-only Cloudflare Images storage mismatch after validation/transformation had already succeeded. PR #205 recovered storage to private R2. Deployment #127 provisioned `catalog-engine-brand-assets`, bound `BRAND_ASSETS`, deployed the Worker and passed smoke. The owner then retried the real production flow: save succeeded, and a later reload/re-entry showed the crocodile logo and saved branding state again. PB4's final persistence gate is therefore satisfied.

## PB5 production proof

The deployed PB5 path provides:

- authenticated `POST /api/admin/stores/:tenantId/source`;
- active membership and owner/admin mutation-role enforcement;
- Yupoo Provider Engine source verification/canonicalization;
- bounded HTTPS/host/scope/redirect/timeout validation;
- private canonical source storage;
- opaque source locator/public-safe response projection;
- destructive source-change guard once imported private state exists;
- source provisioning checkpoint/audit update without source URL leakage;
- mobile-first Yupoo URL form and Catalog navigation;
- safe client payload limited to `sourceUrl`, `sourceKey=primary`, `syncStrategy=incremental`;
- safe connected-state recovery through the onboarding endpoint;
- explicit loading/error/retry/focus/touch/reduced-motion behavior;
- source URL restricted to the immediate controlled form/request and never rendered back after connection;
- no fake import completion, fake scope selector, second provider or recurring Intelligent Sync enrollment.

The real CROCCODILOS merchant connected its Yupoo source in production. The source screen returned a verified/connected state. After reload/re-entry, `Minhas lojas` recovered `Fonte conectada` with `Próximo passo: Definir importação`, and reopening the Catalog source screen still showed the source connected without displaying or requesting the private supplier URL again. PB5's persistence and privacy acceptance gates are satisfied.

## PB6 execution finding

Before starting PB6, live code was audited against the approved slice contract. The current chain can automatically progress a connected source through data-plane provisioning and migrations toward initial-import discovery while `TENANT_IMPORT_AUTOMATION_ENABLED=1`.

Therefore PB6 must not be a client-only selector. The next implementation must introduce/identify durable provider-neutral import-decision authority and make automatic initial-import candidate discovery honor it. The first-beta fallback remains explicit **full-catalog** import if safe merchant-level scope discovery cannot be exposed without raw provider-private category identifiers/URLs.

Already-running or completed import evidence must not be destructively reset merely to add this gate.

## Explicitly not confirmed / not Green

Do not claim without later evidence:

- PB6 **PRODUCTION GREEN** or a merchant decision that demonstrably gates/controls initial import;
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

Execute **PB6 — Source Scope / Import Decision** next.

The merchant must receive one truthful import-decision path. That decision must be durable and must match what initial import actually consumes. If safe scope discovery is not contractually available, use explicit full-catalog import for beta rather than exposing raw Yupoo category IDs/URLs or a fake selector.

Recurring tenant Intelligent Sync remains disabled throughout the PB campaign unless the owner separately authorizes M7E.