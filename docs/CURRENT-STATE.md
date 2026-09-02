# Catalog Engine — Current State

Status: **Living implementation/proof truth**  
Snapshot refreshed: **2026-09-02**  
Repository: `lucasvenancio0110/catalog-engine`

This document records what is implemented/proven now and the current execution point. Focused normative documents own durable contracts; historical closure documents own detailed evidence from completed milestones.

## Live GitHub baseline

The first-merchant PB campaign was formalized from the production-proven M9B baseline:

- pre-PB0 `main`: `3221c92945750596a3b52ae29dcb51bfcb687cea`;
- commit: `M9B: make club discovery copy truthful (#187)`;
- trusted application deploy `33537313254`: **SUCCESS** on that exact SHA;
- exact-SHA Queue/fleet/affected-detail/CEI/verification/promotion/finalization/removal/automatic-import/recovery regressions: **SUCCESS**.

PB0 planning/governance integration:

- PR `#188 — PB0: formalize first real merchant beta sequencing`;
- tested PR head: `c88ee4b66176873561d6814ace7bba4bd5970be0`;
- `Validate SaaS control plane` run `33588925793`: **SUCCESS**;
- `Validate tenant ingestion` run `33588925775`: **SUCCESS**;
- squash-integrated `main` SHA: `75afe81880a856bb44493daf8b61e1578cd68451`.

PB0 was documentation/governance-only and changed no runtime/application code, migration, Cloudflare resource, customer data or activation flag. Therefore it is classified **GOVERNANCE GREEN / COMPLETE**, not as a new runtime Production Green deployment. Detailed proof: `PB0-CLOSURE-2026-09-02.md`.

Historical branch names or closure snapshots are not current execution authority.

## Production platform boundary

Current production/application configuration includes:

- Cloudflare Workers Paid / Workers for Platforms;
- platform Worker `catalog-engine`;
- production dispatch namespace `catalog-engine-production`;
- control-plane D1 binding `CATALOG_DB`;
- per-tenant isolated D1 + User Worker model for non-default tenant runtimes;
- scan/detail Queues and DLQs for initial tenant import;
- five-minute scheduler;
- `app.catalogoengine.com` as the customer-admin host;
- `catalogoengine.com`, `edge.catalogoengine.com` and `origin.catalogoengine.com` in their documented platform roles.

Current activation values remain:

```text
TENANT_IMPORT_AUTOMATION_ENABLED=1
TENANT_SYNC_AUTOMATION_ENABLED=0
TENANT_SYNC_ACTIVE_COHORT=""
TENANT_SYNC_MAX_JOBS_PER_TICK=1
```

Automatic **initial tenant import is enabled**. Recurring tenant Intelligent Sync is still **disabled**. M7E remains outside the PB campaign and requires separate owner authorization.

## Default production catalog

The historical production catalog remains one explicit tenant instance, not platform-global truth:

- tenant ID: `t_00000000000000000001`;
- data-plane/runtime compatibility identity: `catalog-engine-default`;
- source key: `primary`.

A first real merchant beta store must be created as a separate new tenant and must not reuse, overwrite or silently fall back to this tenant.

## Multi-tenant infrastructure already proven

Production-proven foundations include:

- authenticated control-plane API boundary under `/api/admin/*`;
- membership/role checks for tenant-scoped reads/mutations;
- tenant provisioning state machine/checkpoints;
- Workers for Platforms tenant runtime provisioning;
- isolated tenant D1 schema migration through current schema v8;
- Queue-driven initial tenant import;
- CEI/classification + durable merchant override model;
- tenant verification gate;
- full tenant runtime staging/dispatch;
- custom-domain Cloudflare for SaaS path;
- final publication gate;
- cross-tenant custom-hostname isolation proof.

The retained custom-hostname smoke proved the smoke tenant could read its own product while default/other-tenant sentinel reads failed in both directions.

## Provider / import state

Yupoo is the only production-targeted v1 provider adapter. Provider-specific source recognition/crawl/detail/media rules live behind Provider Engine contracts.

Supplier/source data remains private evidence, including source URL/hostname, raw provider IDs, source media locators, provider-private taxonomy, credentials and runtime locators.

Initial tenant import is production-activated through scan/detail Queues. PB0 reconciled stale pre-M5 wording in `TENANT-IMPORT-SCAN.md` and `TENANT-IMPORT-DETAILS.md` with the already-proven production topology.

Recurring sync is a separate M7 authority and remains off despite initial-import automation being enabled.

## CEI state

CEI Core + Sports Knowledge Pack v1 are production-proven for the current launch domain.

Current durable behavior includes:

- normalized source-neutral CEI Evidence;
- versioned domain/runtime/classifier contracts;
- automatic classification separated from merchant overrides;
- schema-validated intelligence state;
- verification of public/source/media/catalog invariants;
- review/research/conflict represented as exceptions rather than guessed truth.

Do not claim universal autonomous research or production Automotive/Fashion/Dental Knowledge Packs without new proof.

## M7 state

M7A through **M7D10** are production-proven across their scoped safety foundations, staged delta/candidate state, enrollment authority, live scan, affected detail/CEI, verification, atomic promotion/finalization, safe repeated-miss removal/restoration and recovery/replay.

Compact latest M7D10 proof:

- trusted-main proof SHA: `caaa12340e3038e5c1ad5824b8b329c8880b5b98`;
- application deploy `33343450164`: success;
- Queue proof `33343603174`: success;
- fleet proof `33343603238`: success;
- M7D7 regression `33343603170`: success;
- M7D8 regression `33343603168`: success;
- M7D9 regression `33343603212`: success;
- automatic initial-import/CEI regression `33343603183`: success;
- dedicated M7D10 recovery/replay canary `33343603219`: success.

M7D11 — Safe Change and Review Feed remains unfinished. M7E deliberate activation remains decision-gated and unfinished.

## M8 state

M8 Media Engine hardening remains future/unproven work. Existing opaque media-proxy behavior is not equivalent to M8 completion.

The PB campaign may use the existing safe media boundary but may not silently declare M8 complete or weaken its security requirements.

## M9 storefront state

Owner-authorized 2026-08-31 sequencing moved M9 ahead of remaining M7D11/M7E/M8.

### M9A — Commerce Shell and URL State

**PRODUCTION GREEN**.

### M9B — Product Discovery and Merchandising

**IN PROGRESS — PAUSED by the later 2026-09-02 first-merchant PB sequencing decision.**

Recent Production Green increments include:

- `#179` Experience Stack Foundation;
- `#180` catalog mobile density;
- `#181` entity browser density;
- `#182` team page/facets;
- `#183` mobile quick-view polish;
- `#184` mobile Explore density;
- `#185` mobile dock section-state;
- `#186` incremental catalog infinite scroll;
- `#187` truthful club-discovery copy.

`#187` exact production baseline SHA `3221c92945750596a3b52ae29dcb51bfcb687cea` remains runtime Production Green.

Known M9B visual debt retained for later audit:

- bottom-dock `Produtos` icon appeared absent in captured screenshots;
- suspected Lucide naming mismatch around `grid-2x2` / `Grid2X2`; `LayoutGrid` is already used elsewhere;
- do not mix that repair into PB work unless it blocks the portal itself.

M9B is **not complete**. M9C and M9D remain planned/unproven.

## Customer portal baseline

`app.html` and `src/app/main.js` already provide a responsive portal shell for authentication state, Minhas lojas, Catálogo, Aparência, Domínio, Plano e cobrança, Conta and loading/empty/error presentation.

The merchant journey is not yet real end to end.

Current concrete implementation facts:

- the `Entrar` control is disabled;
- `src/app/main.js` expects provider-neutral `window.__CATALOG_ENGINE_AUTH__.getAccessToken()`;
- no customer password database exists or should be added;
- `worker/admin-auth.js` already validates Bearer JWT/OIDC with RS256, issuer, audience, subject, expiry/time claims and JWKS;
- a stable opaque principal ID is derived from issuer + subject;
- `GET /api/admin/session` returns principal expiry and membership-scoped stores;
- `GET /api/admin/stores` returns membership-scoped stores;
- `POST /api/admin/stores` already persists a real tenant/profile/catalog instance/owner membership/provisioning run;
- at the PB0 baseline, `POST /api/admin/stores` **does not evaluate entitlement before provisioning**;
- `src/app/portal-model.js` expects `session.entitlements`, but the session API does not yet return that projection;
- `GET /api/admin/stores/:tenantId/onboarding` returns durable onboarding/source/domain/provisioning state with bounded public errors;
- `POST /api/admin/stores/:tenantId/source` validates mutation membership/role and private source connection;
- changing an imported source without explicit reset fails with a safe conflict.

Therefore the portal is a scaffold over real control-plane foundations, not yet a sellable onboarding product.

## First real merchant PB sequencing exception — ACTIVE

The owner explicitly authorized pulling forward the minimum customer portal/onboarding work required to become the **first real beta merchant**.

Detailed execution contract: `docs/PORTAL-BETA-EXECUTION.md`.

Formalized campaign order:

```text
PB0 Live Truth + Sequencing Decision ✅ GOVERNANCE GREEN
-> PB1 Authentication Foundation 🚧 NEXT
-> PB2 Account + Beta Entitlement
-> PB3 Create Store
-> PB4 Branding
-> PB5 Source Connection
-> PB6 Source Scope / Import Decision
-> PB7 Provisioning Progress
-> PB8 Real Tenant Import
-> PB9 Private Preview
-> PB10 Merchant Home
-> PB11 Beta E2E
-> PB12 Production Proof
```

Default return point after PB12 is the exact paused **M9B** state unless a later owner decision changes sequencing again.

This exception does **not** complete M9B, M10/M11/M13/M14/M15/M16/M22; introduce a public free trial; implement public billing; activate M7E; enable recurring tenant Intelligent Sync; reuse the default tenant; or permit frontend-only authorization shortcuts.

## Beta entitlement decision

The public commercial default remains payment-before-store provisioning.

For the bounded first-merchant beta, the accepted architecture is:

```text
explicit auditable pilot grant
-> normalized server-side entitlement
-> initial maxStores=1 policy
-> ordinary tenant creation/provisioning authority
```

The grant is not a client flag and must not be a hard-coded email/name/provider-subject bypass.

Future billing becomes another entitlement source without changing tenant authorization semantics.

The evaluator/grant implementation does not yet exist; PB2 owns it.

## PB0 closure

**PB0 — Live Truth + Sequencing Decision = GOVERNANCE GREEN / COMPLETE.**

Evidence:

- owner sequencing decision formalized in `PORTAL-BETA-EXECUTION.md`;
- focused business/portal/tenancy/SaaS contracts aligned;
- initial-import Queue documentation reconciled;
- PR `#188` exact head `c88ee4b66176873561d6814ace7bba4bd5970be0` passed both applicable secret-free CI workflows;
- integrated as `75afe81880a856bb44493daf8b61e1578cd68451`;
- no privileged Cloudflare canary applies because PB0 changed no executable or production runtime state;
- full proof is retained in `PB0-CLOSURE-2026-09-02.md`.

The next approved slice is **PB1 — Authentication Foundation**.

## Explicitly not confirmed / not Green

Do not claim without later evidence:

- real signup/login/logout in `app.catalogoengine.com`;
- configured production OIDC identity provider;
- normalized pilot entitlement evaluator/grant storage;
- server-side store-creation entitlement enforcement;
- first real merchant tenant created through the portal;
- tenant logo upload/storage pipeline;
- real beta source connected through portal UX;
- first real beta automatic import/CEI/verification completion;
- authenticated private-preview route;
- PB end-to-end browser proof;
- M7D11 completion;
- M7E activation;
- M8 completion;
- M9B/M9C/M9D completion;
- public billing integration;
- broad closed-beta/public-launch readiness.

## Current execution rule

PB0 is integrated and closed. The active bounded execution point is now:

**PB1 — Authentication Foundation.**

Before PB1 changes code, revalidate live `main`, open PRs and current deployment state; preserve provider-neutral OIDC/JWT authentication, no password storage, tenant isolation and the recurring-sync-off boundary.

Recurring tenant sync stays disabled throughout the PB campaign unless the owner separately authorizes M7E.
