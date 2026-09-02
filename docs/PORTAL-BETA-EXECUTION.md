# Catalog Engine — Portal Beta / First Real Merchant

Status: **Normative bounded execution contract**  
Approved by owner: **2026-09-02**  
Scope: owner-authorized sequencing exception that pulls forward the minimum authenticated customer-portal, entitlement, onboarding, provisioning, branding and private-preview work required to prove the first real merchant tenant.  
Non-goal: declare M9B, M10, M11, M13, M14, M15, M16 or M22 complete; activate recurring Intelligent Sync; activate M7E; implement public billing; or replace the durable product contracts owned by their focused documents.

## Authority and live baseline

This execution contract is subordinate to `AGENTS.md`, `DOCUMENT-GOVERNANCE.md`, focused owner documents and live GitHub. It records a deliberate sequencing decision, not an exemption from security, privacy, tenant isolation, CI or production proof.

Live baseline revalidated before this contract was created:

- repository: `lucasvenancio0110/catalog-engine`;
- branch: `main`;
- baseline SHA: `3221c92945750596a3b52ae29dcb51bfcb687cea`;
- baseline commit: `M9B: make club discovery copy truthful (#187)`;
- open pull requests: none at the revalidation point;
- trusted application deploy `33537313254`: successful on the exact baseline SHA;
- M9B remains **IN PROGRESS** and is paused only by this owner-authorized beta sequencing exception;
- `TENANT_IMPORT_AUTOMATION_ENABLED=1` remains allowed for initial tenant import;
- `TENANT_SYNC_AUTOMATION_ENABLED=0`, empty active cohort and per-tick cap `1` remain mandatory;
- M7E remains **DECISION REQUIRED** and is outside this campaign.

Historical branch names or historical closure documents do not override this baseline.

## Why this exception exists

The platform already contains substantial production-proven multi-tenant infrastructure, but the merchant-facing chain is not yet connected end to end. The owner is the first real beta merchant and wants to prove the product path now rather than wait for every later customer-facing milestone to complete in roadmap order.

The beta must prove a real chain:

```text
new person
-> authenticated principal
-> trusted entitlement
-> owner membership
-> new tenant
-> private source
-> isolated data plane/runtime
-> initial import
-> CEI classification
-> verification
-> private preview
-> persistent merchant portal
```

This is not a visual prototype. Every completed beta step must use durable server-side authority.

## Sequencing decision

The approved temporary order is:

```text
PB0 -> PB1 -> PB2 -> PB3 -> PB4 -> PB5 -> PB6 -> PB7 -> PB8 -> PB9 -> PB10 -> PB11 -> PB12
```

After PB12, execution returns by default to the exact pre-exception point, **M9B — Product Discovery and Merchandising**, unless the owner makes a later explicit sequencing decision.

This exception does not close or reorder the internal ledger of M9. M9C and M9D remain planned behind M9B. The later normal roadmap remains unchanged except for being temporarily paused.

## Campaign invariants

Every PB slice must preserve all of the following:

1. GitHub live truth wins over this document when state changes.
2. Each implementation slice uses a bounded branch/PR and exact tested head.
3. Authentication remains provider-neutral OIDC/JWT; Catalog Engine stores no customer password.
4. Authentication and authorization fail closed.
5. Tenant-scoped reads require active membership; sensitive mutations require `owner` or `admin` unless a narrower rule is explicitly documented.
6. A client-supplied tenant ID is never sufficient authorization.
7. Store creation is entitlement-gated server-side.
8. The beta entitlement is not a hard-coded identity/email bypass.
9. The default production tenant is never reused as the beta tenant.
10. A beta store receives its own opaque tenant identity, profile, source, provisioning state and isolated tenant data plane.
11. Supplier URLs, raw provider IDs, runtime locators, D1 UUIDs, Worker names, Cloudflare IDs, secrets, tokens and private CEI evidence remain private.
12. Initial import may use the already-activated `TENANT_IMPORT_AUTOMATION_ENABLED=1` path.
13. Recurring Intelligent Sync stays disabled for the entire campaign unless a separate M7E owner decision later authorizes activation.
14. No fake percentage progress. Merchant progress is projected only from durable backend checkpoints/counters whose semantics are safe.
15. Branding is validated configuration; arbitrary merchant HTML/JavaScript is forbidden.
16. Private preview must resolve the authorized tenant server-side and must not become an accidental permanent public merchant URL.
17. Public custom-domain publication is outside the minimum first-beta proof unless a later PB slice explicitly needs a non-destructive readiness check.
18. Customer-facing errors expose bounded merchant-safe codes/messages only.
19. Mobile-first customer work must cover touch, keyboard/focus, loading, empty, error, retry and reduced-motion behavior.
20. Production Green requires exact integrated evidence appropriate to the changed boundary; skipped privileged jobs and secret-free PR validation are not production proof.

## Beta entitlement decision

The public commercial default remains payment-before-store provisioning. PB2 introduces a **bounded pilot entitlement grant**, not a public free trial and not a billing substitute.

The beta entitlement contract is:

```text
explicit auditable pilot grant
-> authenticated principal/account authority
-> maxStores = 1 for the initial beta policy
-> allowed source provider includes Yupoo
-> private preview permitted
-> public billing state remains unimplemented/unclaimed
```

Rules:

- grant creation/administration is trusted server-side/operator-controlled, not a browser self-assertion;
- the grant is represented as normalized entitlement authority consumed by product code;
- it must be auditable and revocable/expirable without deleting tenant data;
- it must never key authorization to a hard-coded email, name or raw identity-provider subject;
- repeated store creation is bounded by both idempotency and the evaluated allowance;
- the portal receives only the safe evaluated entitlement summary it needs (`canCreateStore`, allowance/use and safe reason state);
- billing integration later becomes another entitlement source without changing tenant/store authorization semantics.

This beta grant is a sales-assisted/pilot exception allowed by `SALES-SUBSCRIPTIONS.md` and `BILLING-PAYMENTS.md`; PB0 updates the other focused owner documents that previously described billing as the only current store-creation source.

## Live implementation gaps found at PB0

The baseline contains useful foundations and also real gaps that must not be papered over:

- `worker/admin-auth.js` already validates RS256 OIDC/JWT issuer, audience, subject, expiry/time claims and JWKS and derives an opaque principal ID;
- `src/app/main.js` already expects a provider-neutral `window.__CATALOG_ENGINE_AUTH__.getAccessToken()` adapter, but real login/signup/logout/session refresh is not connected and the login control is disabled;
- `GET /api/admin/session` and `GET /api/admin/stores` already return membership-scoped stores;
- `POST /api/admin/stores` already constructs and persists the real tenant/profile/catalog instance/owner membership/provisioning run, but at the PB0 baseline it does **not** evaluate entitlement before provisioning;
- `src/app/portal-model.js` already expects `session.entitlements`, but the PB0 baseline session response does not return an entitlement projection;
- `POST /api/admin/stores/:tenantId/source` already verifies active membership with mutation role, validates the private provider source and prevents destructive source replacement after imported state exists;
- onboarding state is already durable and merchant-safe enough to form the base of PB7, but progress mapping must be audited against real step semantics before UI claims are added;
- initial Queue import is production-activated while recurring tenant sync remains disabled;
- `TENANT-IMPORT-SCAN.md` and `TENANT-IMPORT-DETAILS.md` contain stale pre-M5 activation wording and must be reconciled during PB0.

These are implementation facts, not permission to skip the slices that close the gaps.

## Approved PB ledger

| Slice | Status at PB0 planning | Bounded customer/technical outcome |
| --- | --- | --- |
| PB0 — Live Truth + Sequencing Decision | **IN PROGRESS** | Revalidate production truth, reconcile stale normative statements, register this sequencing exception and approve the PB1–PB12 ledger. |
| PB1 — Authentication Foundation | **PLANNED** | Real signup/login/logout/session/expiry path through external OIDC identity and the existing JWT boundary, without storing customer passwords. |
| PB2 — Account + Beta Entitlement | **PLANNED** | Server-evaluated auditable pilot grant, safe session entitlement projection and store-creation enforcement. |
| PB3 — Create Store | **PLANNED** | Mobile-first UI calls the existing real `POST /api/admin/stores` path with idempotent one-store beta behavior. |
| PB4 — Branding | **PLANNED** | Validated merchant profile/theme/colors/contacts and safe logo asset ownership/storage, with no arbitrary code. |
| PB5 — Source Connection | **PLANNED** | Merchant validates and connects a private Yupoo source through the existing authenticated source boundary. |
| PB6 — Source Scope / Import Decision | **PLANNED** | Use provider-safe scope discovery only if the current contract can expose a safe merchant abstraction; otherwise explicitly choose full-catalog import for beta. |
| PB7 — Provisioning Progress | **PLANNED** | Resume-safe merchant progress projected from durable onboarding/import state, bounded polling and truthful retry/error UX. |
| PB8 — Real Tenant Import | **PLANNED** | Prove a newly created beta tenant traverses isolated data-plane provisioning, schema v8, initial Queue import, CEI and verification with recurring sync still off. |
| PB9 — Private Preview | **PLANNED** | Authorized preview serves only the beta tenant's effective catalog/brand/media through server-resolved tenant authority. |
| PB10 — Merchant Home | **PLANNED** | Persisted store appears after re-entry with action-oriented real status and a path to preview/onboarding continuation. |
| PB11 — Beta E2E | **PLANNED** | Repeatable signup-to-preview/logout-login journey with mobile/desktop/input/error/session coverage. |
| PB12 — Production Proof | **PLANNED** | Consolidated exact-SHA trusted-main proof of auth, entitlement, creation, isolation, real import, preview and supplier privacy; only then label the first beta **BETA GREEN**. |

PB1–PB12 names/order become approved only when PB0's planning change is merged according to `DEVELOPMENT-CONTINUITY.md`.

# Slice definitions

## PB0 — Live Truth + Sequencing Decision

Customer/business outcome:

- development can pivot to the first real merchant beta without losing the previous roadmap point or silently weakening product contracts.

Technical outcome:

- record live baseline and owner exception;
- reconcile the current execution point in `CURRENT-STATE.md` and `DEVELOPMENT-ROADMAP.md`;
- map this contract in `DOCUMENT-MAP.md`;
- update focused product/architecture documents for the bounded pilot-entitlement exception;
- correct stale initial-import activation wording.

Non-goals:

- no auth implementation;
- no migration;
- no production entitlement grant;
- no customer data mutation;
- no M9B UI fix;
- no recurring-sync activation.

Owner documents/components:

- documentation only: governance/state/roadmap, business/portal/tenancy/SaaS architecture and initial-import contracts.

Migration/compatibility:

- none.

Proof:

- documentation consistency review;
- ordinary repository quality gates applicable to the PR;
- exact merged SHA and GitHub status evidence;
- no privileged runtime mutation is required solely for a documentation-only decision.

Rollback:

- revert the planning/documentation commit; execution returns to the pre-exception M9B point.

Definition of Done:

- live truth is reconciled;
- PB1–PB12 are formally approved and ordered;
- M9B remains explicitly incomplete/paused;
- pilot entitlement is a documented server-side grant concept, not a bypass;
- sync/M7E boundaries remain unchanged.

Dependencies/decisions:

- owner authorization is already supplied by the 2026-09-02 handoff.

## PB1 — Authentication Foundation

Customer/business outcome:

- a real beta merchant can create/sign into an identity and return to the portal securely.

Technical outcome:

- select/configure a minimal external OIDC identity provider while preserving provider-neutral Worker validation;
- wire authorization-code + PKCE or an equivalently secure standards-based SPA flow appropriate to the chosen provider;
- real login/signup entry, logout, session restoration, token expiry/refresh behavior and 401 recovery;
- keep access tokens out of committed code and avoid customer-password storage;
- maintain `ADMIN_AUTH_ISSUER`, `ADMIN_AUTH_JWKS_URL` and `ADMIN_AUTH_AUDIENCE` as server validation authority.

Non-goals:

- no tenant creation or beta grant yet;
- no proprietary password database;
- no broad role-management UI.

Owner docs/components:

- `SAAS-ARCHITECTURE.md`, `CUSTOMER-PORTAL.md`, `DESIGN-SYSTEM.md`, `JAVASCRIPT_LIBRARIES.md`;
- `worker/admin-auth.js`, portal auth adapter/UI and auth tests/configuration.

Migration/compatibility:

- prefer no D1 migration unless identity/account normalization objectively requires it; opaque principal derivation compatibility must be preserved.

Proof:

- invalid signature/issuer/audience/expired tokens fail closed;
- valid provider token reaches `/api/admin/session`;
- logout and expiry remove usable session access;
- no secret/customer password in browser bundle/repository;
- responsive/focus/reduced-motion auth UI tests as applicable;
- trusted-main deploy and live auth smoke require the configured external provider.

Rollback:

- disable/remove portal auth runtime configuration so admin auth fails closed; do not add an unauthenticated fallback.

Definition of Done:

- signup/login/logout/re-entry work against the configured beta identity provider and backend validation on the exact deployed SHA.

Dependencies/decisions:

- external identity provider configuration may require owner-supplied client/tenant values after all repository work that can be completed without them is finished.

## PB2 — Account + Beta Entitlement

Customer/business outcome:

- the authorized beta account can create at most the permitted number of stores while arbitrary authenticated accounts cannot provision infrastructure.

Technical outcome:

- introduce normalized server-side entitlement evaluation;
- represent explicit auditable pilot grants;
- initial policy `maxStores=1` for a granted beta account;
- return a safe entitlement projection in `/api/admin/session`;
- enforce allowance inside `POST /api/admin/stores` before resource/provisioning persistence;
- preserve/create idempotency handling for retries/double taps;
- include bounded abuse/rate considerations at the mutation boundary.

Non-goals:

- no recurring payment provider;
- no public free trial;
- no hard-coded email/principal allowlist;
- no destructive removal when grant expires.

Owner docs/components:

- `BUSINESS-MODEL.md`, `BILLING-PAYMENTS.md`, `SALES-SUBSCRIPTIONS.md`, `TENANCY.md`, `SAAS-ARCHITECTURE.md`, `CUSTOMER-PORTAL.md`;
- control-plane migration/evaluator/admin API/tests.

Migration/compatibility:

- additive control-plane schema only; billing can later become another normalized entitlement source.

Proof:

- anonymous request denied by auth;
- authenticated without grant cannot create store;
- active grant can create one store;
- second store denied at max 1;
- cross-principal/tenant manipulation fails;
- retry does not create duplicate resources;
- audit record contains no secret/provider-private source data.

Rollback:

- revoke/expire grant or disable pilot-grant eligibility; existing tenant data remains intact.

Definition of Done:

- server, not UI, is the store-creation authority and `/session` truth matches it.

Dependencies/decisions:

- requires PB1 principal identity.

## PB3 — Create Store

Customer/business outcome:

- the beta merchant can tap `Criar minha primeira loja`, enter the minimum store identity and receive a real tenant.

Technical outcome:

- mobile-first store-name flow;
- call the existing authenticated `POST /api/admin/stores` path;
- use supported currency/theme defaults or explicit bounded inputs;
- submit idempotency identity safely;
- transition directly into the returned/onboarding state rather than fabricating a client object.

Non-goals:

- no manual SQL tenant creation;
- no default-tenant reuse;
- no source connection or import in the same giant request;
- no domain requirement.

Owner docs/components:

- `CUSTOMER-PORTAL.md`, `TENANCY.md`, `SAAS-ARCHITECTURE.md`, `DESIGN-SYSTEM.md`;
- portal UI/model, admin control plane and tests.

Migration/compatibility:

- none unless PB2 idempotency requires an additive key/ledger extension.

Proof:

- real opaque `t_<20 hex>` tenant distinct from default;
- authenticated principal becomes active owner;
- profile/catalog instance/provisioning run exist once;
- reload session returns the store;
- responsive/loading/error/double-submit behavior is covered.

Rollback:

- disable create CTA through entitlement/config while preserving already-created tenant; no destructive auto-cleanup.

Definition of Done:

- a beta user creates a durable real tenant exclusively through the production control-plane mutation.

Dependencies/decisions:

- PB1 and PB2.

## PB4 — Branding

Customer/business outcome:

- the merchant can configure the identity customers will see before preview.

Technical outcome:

- update profile for validated store name, supported theme preset, primary/secondary semantic colors and optional WhatsApp/Instagram;
- add a safe logo upload pipeline after auditing current tenant-asset storage;
- prefer PNG/JPEG/WebP for beta; SVG remains disabled unless an explicit sanitization/security contract is added;
- validate MIME, byte size, decoded image, dimensions and tenant ownership;
- use Sharp when image decoding/normalization is needed;
- store only safe tenant-owned public asset identity/path in profile data.

Non-goals:

- no arbitrary HTML/JS/CSS;
- no full M10 theme engine claim;
- no base64 image blobs in D1;
- no supplier-hosted merchant logo dependency.

Owner docs/components:

- `CUSTOMER-PORTAL.md`, `DESIGN-SYSTEM.md`, `TENANCY.md`, `BUSINESS-MODEL.md`, runtime/store profile contracts;
- storage choice and asset API/tests must be documented in the same PR that activates them.

Migration/compatibility:

- additive only if asset registry/provider state is needed; existing nullable `logo_path` remains compatible.

Proof:

- tenant A cannot read/write tenant B logo;
- unsupported/oversized/active content fails closed;
- previewable profile configuration contains no executable content;
- accessible color validation/fallback is deterministic.

Rollback:

- preserve previous valid branding asset/config and stop accepting uploads; storefront falls back to safe theme/logo behavior.

Definition of Done:

- beta tenant branding persists and can be rendered by PB9 without private storage leakage.

Dependencies/decisions:

- PB3; storage provider decision is implementation-level unless it changes product/risk/cost materially.

## PB5 — Source Connection

Customer/business outcome:

- merchant enters a Yupoo catalog URL and receives a truthful safe validation result before import.

Technical outcome:

- connect portal to `POST /api/admin/stores/:tenantId/source`;
- retain Yupoo as the only enabled beta provider;
- server validates/canonicalizes source privately through Provider Engine;
- expose only merchant-safe provider/source health information;
- keep existing destructive source-change guard after imported state exists.

Non-goals:

- no supplier URL in public/static response state beyond the merchant's own immediate controlled form needs;
- no raw provider IDs;
- no second provider;
- no automatic recurring-sync enrollment.

Owner docs/components:

- `PROVIDER-ENGINE.md`, `TENANT-IMPORT-PIPELINE.md`, `TENANCY.md`, `CUSTOMER-PORTAL.md`;
- portal form/control-plane source route/tests.

Migration/compatibility:

- none expected.

Proof:

- invalid/unsupported source rejected safely;
- valid source stores private canonical locator;
- membership/role enforcement survives tenant-ID tampering;
- no source URL appears in public storefront/build/log assertions;
- source replacement after import returns bounded reset-required state.

Rollback:

- disable connection UI/new source mutations; existing private source persists.

Definition of Done:

- beta merchant can connect one real private Yupoo source without bypassing Provider Engine.

Dependencies/decisions:

- PB3; branding ordering in UI may overlap navigation only, not backend authority.

## PB6 — Source Scope / Import Decision

Customer/business outcome:

- merchant understands what will be imported without being shown provider-private identifiers.

Technical outcome:

- audit Provider Engine discovery/scoping authority;
- when safe merchant-level scope discovery exists, project stable public-safe choices;
- otherwise explicitly use `Importar catálogo completo` for the first beta and defer selector UI;
- persist only a contract-backed choice that the initial import actually honors.

Non-goals:

- no fake category selector from raw supplier IDs;
- no client-only filtering that still imports a different hidden scope;
- no widening provider contract merely for visual polish.

Owner docs/components:

- `PROVIDER-ENGINE.md`, source onboarding/import contracts and portal UX.

Migration/compatibility:

- only if a new provider-neutral durable scope choice is required and proven safe.

Proof:

- selected/imported scope semantics agree end to end;
- no raw supplier category ID/URL leaks through admin/public UI.

Rollback:

- fall back to full connected source when that is the existing safe contract.

Definition of Done:

- the beta has one truthful import decision path, even if that path is intentionally full-catalog only.

Dependencies/decisions:

- PB5.

## PB7 — Provisioning Progress

Customer/business outcome:

- merchant can leave/return and understand what Catalog Engine is actually doing.

Technical outcome:

- map `GET /api/admin/stores/:tenantId/onboarding` and safe import/provisioning counters to merchant stages;
- bounded polling/backoff and visibility-aware refresh;
- preserve last useful state during transient refresh failures where safe;
- expose retry/action only when the durable backend supports it;
- no fake percentages.

Non-goals:

- no infrastructure terminology;
- no raw provisioning errors;
- no invented completion time.

Owner docs/components:

- `CUSTOMER-PORTAL.md`, `DESIGN-SYSTEM.md`, `TENANT-IMPORT-PIPELINE.md`, data-plane/classify/verify contracts.

Migration/compatibility:

- none unless a genuinely missing safe counter/checkpoint is required.

Proof:

- each UI stage maps to named durable state/counters;
- refresh/re-entry restores truth;
- terminal failure and retry semantics do not duplicate tenant/import work;
- polling is bounded.

Rollback:

- fall back to coarser durable statuses; never replace real status with animation/fake percentage.

Definition of Done:

- progress is resumable, truthful and merchant-readable.

Dependencies/decisions:

- PB3/PB5 and existing provisioning state.

## PB8 — Real Tenant Import

Customer/business outcome:

- the first real beta store receives an independently imported and organized catalog.

Technical outcome/proof campaign:

```text
new tenant
-> connected private source
-> physical isolated data plane/runtime
-> schema v8
-> automatic initial scan/details/finalize
-> CEI classify
-> verify
-> preview-ready authority
```

Non-goals:

- no default tenant reuse;
- no manual Queue injection as the normal proof;
- no recurring-sync activation;
- no public custom-domain requirement.

Owner docs/components:

- tenant provisioning/data-plane/import/CEI/verify/deployment contracts.

Migration/compatibility:

- use current schema v8 path; no beta-only schema shortcut.

Proof:

- scheduler/Queue-owned initial import with no supplier leak;
- tenant data plane and product counts are isolated;
- CEI/classifier/intelligence state complete under current contracts;
- verification findings zero for structural blockers;
- default tenant remains unchanged;
- Queue/DLQ health returns to understood state.

Rollback:

- disable new initial-import discovery with its existing gate if infrastructure is unhealthy; preserve tenant/job evidence.

Definition of Done:

- a real newly created tenant, not a test clone of the default tenant, reaches verified catalog readiness.

Dependencies/decisions:

- PB1–PB7.

## PB9 — Private Preview

Customer/business outcome:

- merchant can view the beta store before owning/configuring a custom domain.

Technical outcome:

- introduce authenticated preview entry that resolves membership and server-owned tenant runtime/data-plane authority;
- render the same effective tenant catalog/brand behavior intended for publication;
- prevent preview URL/headers from becoming an indexable permanent public merchant address;
- preserve tenant media isolation and opaque identifiers.

Non-goals:

- no custom-domain publication;
- no client-supplied Worker/runtime locator;
- no default-tenant fallback;
- no claim that M10/M9 are complete.

Owner docs/components:

- `CUSTOMER-PORTAL.md`, `TENANCY.md`, `TENANT-RUNTIME-DISPATCH.md`, `TENANT-PUBLISH.md`, `DESIGN-SYSTEM.md`.

Migration/compatibility:

- prefer routing/auth changes over catalog duplication; additive preview authorization state only if required.

Proof:

- owner can preview own ready tenant;
- anonymous/cross-tenant preview fails closed;
- beta product/brand/media appear;
- default/demo product sentinel cannot be read through beta preview and vice versa;
- no supplier/private runtime state in HTML/JS/API.

Rollback:

- disable preview route while preserving verified tenant state.

Definition of Done:

- authorized merchant sees the real beta tenant and no other tenant before custom-domain publication.

Dependencies/decisions:

- PB4 and PB8.

## PB10 — Merchant Home

Customer/business outcome:

- after onboarding, re-entering the app shows the beta store and its real actionable health.

Technical outcome:

- `Minhas lojas -> Abrir loja -> Visão geral` path;
- safe product/source/import/preview summaries from server authority;
- continue-onboarding action when not ready;
- logout/re-login preserves state because data is server-owned.

Non-goals:

- no decorative analytics dashboard;
- no full M11 information architecture closure;
- no M7D11 feed claim unless that backend slice is later completed normally.

Owner docs/components:

- `CUSTOMER-PORTAL.md`, `DESIGN-SYSTEM.md`, tenancy/admin API/portal UI.

Migration/compatibility:

- only safe aggregate/query additions when necessary.

Proof:

- store list and overview are membership-scoped;
- displayed states correspond to durable backend facts;
- mobile and keyboard paths are functional;
- reload/logout/login preserve the same store authority.

Rollback:

- return to store list/onboarding without deleting tenant state.

Definition of Done:

- beta merchant can manage/understand the created store after the initial wizard is gone.

Dependencies/decisions:

- PB3–PB9.

## PB11 — Beta E2E

Customer/business outcome:

- the first merchant journey is repeatable instead of relying on manual confidence.

Technical outcome:

- establish/activate browser E2E infrastructure if not already present and cover the critical portal beta path;
- representative 320/360/390/430 phone behavior plus tablet/desktop where materially different;
- keyboard/focus/touch/reduced-motion, refresh, back/forward, slow/error/retry and session expiry coverage;
- browser coverage aligned with the launch-quality testing decision, with WebKit-equivalent behavior prioritized for iPhone risk.

Non-goals:

- no supplier scraping through E2E browser automation;
- no claim that the full M20 launch gate is complete.

Owner docs/components:

- `DESIGN-SYSTEM.md`, `JAVASCRIPT_LIBRARIES.md`, portal/admin/auth code and CI.

Migration/compatibility:

- none expected.

Proof:

- automated test evidence for signup/login -> create -> brand -> source -> progress -> preview -> logout/login;
- negative authorization paths;
- captured failures retain no secrets/source URL evidence.

Rollback:

- test infrastructure can be removed without changing production behavior; production code fixes remain independently gated.

Definition of Done:

- critical beta journey has repeatable browser evidence on the exact code under test.

Dependencies/decisions:

- PB1–PB10; browser-test package adoption must follow dependency policy.

## PB12 — Production Proof

Customer/business outcome:

- the owner can use the first real beta store as evidence that Catalog Engine is functioning as a SaaS, not only as infrastructure.

Technical outcome:

- consolidate exact-SHA production evidence without widening product scope.

Required proof set:

- PR CI/gates and exact tested heads for every behavior-changing PB slice;
- exact merged/trusted-main SHA deployed;
- auth provider/JWT validation proof;
- beta entitlement enforcement proof;
- new tenant creation + owner membership proof;
- isolated data-plane/runtime/schema proof;
- real initial import + CEI + verification proof;
- private-preview own/cross/default isolation proof;
- supplier/source privacy proof;
- logout/login persistence proof;
- current flags prove recurring sync still disabled;
- no hidden beta-only bypass remains.

Non-goals:

- no public launch;
- no M22 closed-beta cohort claim beyond this first merchant;
- no M7E activation;
- no billing/domain requirements unless separately proven.

Rollback:

- use the bounded rollback lever owned by the failing subsystem; preserve the beta tenant/evidence whenever safe instead of deleting it to make proof green.

Definition of Done:

Only when the exact production chain proves all required boundaries may `CURRENT-STATE.md` and the roadmap label the campaign:

**PORTAL BETA / FIRST REAL MERCHANT — BETA GREEN**

## First merchant acceptance test

The campaign success test is:

1. open `app.catalogoengine.com`;
2. create/sign into an identity;
3. receive only a trusted beta entitlement;
4. create the first real store through the portal;
5. persist merchant branding/logo;
6. validate/connect one private Yupoo source;
7. start/allow the normal initial import;
8. watch real durable progress;
9. reach CEI/classification/verification readiness;
10. open private preview;
11. see only the new tenant catalog and branding;
12. see no default/demo tenant data;
13. logout;
14. login again;
15. the same authorized store remains present.

Failure of any security/isolation/privacy authority means the beta is not Green even if the screen appears to work.

## Final execution rule

For this campaign, speed means reusing the platform's proven authorities, not bypassing them.

Before each PB slice asks:

> Which existing production authority should this customer action invoke, and what missing server-side contract must be closed before exposing it?

If the answer is a frontend-only simulation, a hard-coded beta identity or a cross-tenant shortcut, the implementation is invalid.
