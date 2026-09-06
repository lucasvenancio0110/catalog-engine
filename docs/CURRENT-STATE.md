# Catalog Engine — Current State

Status: **Living implementation/proof truth**  
Snapshot refreshed: **2026-09-06**  
Repository: `lucasvenancio0110/catalog-engine`

This document is intentionally compact. It records current execution truth; focused normative documents own durable contracts and closure documents retain detailed historical evidence.

## Live baseline

- Current `main`: `be99786c54c2cd6a7be8df77f35da91dbd49d3dc` — `docs: add autonomous development runbook (#245)`.
- PB8 closure commit on main: `232b57450f57aa69a494a2724d2691d69f666b3e` — `PB8: close real tenant import Production Green (#243)`.
- Application Production SHA: `ccd69520607329acf764d3d5d29ddaaf29d0aa98`.
- The later PB8 closure/runbook commits do not imply a newer deployed application runtime.
- Active branch/PR: `pb9-private-preview` / PR #244.
- PB9 implementation/proof-workflow baseline before this state update: `0b6d2e14dd31b7a52c01352e285ad81c5908e88b`; always re-read the live PR head before continuing.
- `HUMAN_GATE_LOCK: INACTIVE`.

## Production activation boundary

```text
TENANT_IMPORT_AUTOMATION_ENABLED=1
TENANT_SYNC_AUTOMATION_ENABLED=0
TENANT_SYNC_ACTIVE_COHORT=""
TENANT_SYNC_MAX_JOBS_PER_TICK=1
```

Automatic **initial tenant import is enabled**. Recurring tenant Intelligent Sync remains **disabled**. M7E remains separately decision-gated.

## Proven first-merchant state

PB0 through PB8 of the owner-authorized first-real-merchant campaign are closed within their bounded contracts.

PB8 — Real Tenant Import is **PRODUCTION GREEN**. Detailed proof is owned by `PB8-CLOSURE-2026-09-06.md`.

The real CROCCODILOS isolated tenant proof established:

- 6,104 discovered and 6,104 terminal details;
- 6,097 persisted products and 15,396 media links;
- CEI/classification success for 6,097 products: 5,869 automatic, 228 review, 0 unknown;
- verification success for 6,097 products with 0 findings;
- scan Queue = 0 and detail Queue = 0;
- scan DLQ = 0 and detail DLQ = 0;
- no private identifiers exposed by the proof;
- recurring Intelligent Sync remained OFF.

The historical default tenant remains an explicit compatibility tenant and must never be used as an implicit fallback for CROCCODILOS or any new merchant.

## Active execution point

PB9 — Private Preview is **PR / INTEGRATION IN PROGRESS**, not Production Green.

PB9 customer outcome:

> An authenticated merchant can preview the real verified tenant before custom-domain publication.

Implemented on PR #244:

- server-side preview readiness resolves active principal membership to the exact tenant runtime and current successful zero-finding catalog verification;
- preview never accepts a browser-supplied Worker, D1 or runtime locator;
- short-lived random preview capability uses a host-only `__Host-` `HttpOnly` / `Secure` / `SameSite=Strict` cookie; only its SHA-256 hash plus opaque tenant/principal ownership and expiry is stored in control-plane D1;
- migration `0024_tenant_private_preview_sessions.sql` owns that ephemeral session state;
- authenticated portal endpoints expose only availability, fixed `/preview` navigation and expiry; logout revokes preview sessions;
- `/preview` serves the real shared storefront shell and root catalog/media traffic is dispatched to the server-resolved isolated runtime only while the session remains valid;
- membership/runtime/verification authority is revalidated on every preview catalog/media request;
- preview dispatch is read-only and allowlisted; admin/health/internal runtime commands are excluded;
- private preview responses are `private, no-store`, non-indexable and no-referrer;
- internal preview dispatch/cache identity is tenant-scoped, preventing cross-tenant media cache collisions;
- the portal exposes `Visualizar loja` only after verified preview readiness; otherwise it keeps the truthful preparation/retry flow;
- storefront preview clearly labels itself as private, not published, with responsive/focus/reduced-motion behavior;
- normative runtime/publish docs explicitly keep private preview separate from public publication authority;
- trusted-main production proof workflow is implemented to test the real beta merchant, anonymous rejection, cross-tenant/default sentinel isolation, real product/media rendering, private-identifier non-disclosure and recurring-sync-OFF, with disposable proof sessions cleaned in `finally`.

PR evidence already observed on the implementation baseline:

- standard PR validation and Cloudflare preview build had passed before the production-proof workflow addition;
- `Cloudflare PB9 private preview proof` PR validation completed successfully on `0b6d2e14dd31b7a52c01352e285ad81c5908e88b`;
- its privileged `prove` job is intentionally not executed on pull requests;
- other exact-head PR workflows must finish green again after this state commit before merge.

Not yet proven:

- integrated merge into `main`;
- D1 migration 0024 applied in production;
- trusted application deploy of the PB9 runtime;
- real production PB9 canary/status on that exact trusted-main SHA;
- final PB9 closure document / Production Green state.

PB9 must continue to fail closed for anonymous, invalid, expired, revoked, unready and cross-tenant access; it must never fall back to the default tenant. Preview HTML/JS/API must not expose supplier URLs, raw provider IDs, tenant/principal control identifiers, D1/Worker/Cloudflare locators or private CEI evidence, and preview must not become a permanent public merchant address.

PB9 owner contracts remain `PORTAL-BETA-EXECUTION.md`, `CUSTOMER-PORTAL.md`, `TENANCY.md`, `SAAS-ARCHITECTURE.md`, `TENANT-RUNTIME-DISPATCH.md`, `TENANT-PUBLISH.md` and `DESIGN-SYSTEM.md`.

## Exact continuation action

1. re-read live PR #244 head and exact-head checks;
2. fix the first real CI failure if any and rerun until the required PR gates are green;
3. revalidate `main` before merge and integrate any new delta if necessary;
4. mark PR #244 ready and merge when governance/checks permit;
5. require trusted deploy to apply migration 0024 and deploy the exact merged application;
6. require `Cloudflare PB9 private preview proof` to pass on the exact trusted-main/deployed SHA;
7. only then write PB9 closure, update this state to Production Green and discover the next approved slice.

## Broader roadmap boundary

- M7A through M7D10: **PRODUCTION GREEN** within their bounded contracts.
- M7D11: future/planned unless live GitHub later proves otherwise.
- M7E: decision-gated; recurring sync remains OFF.
- M9A: **PRODUCTION GREEN**.
- M9B: paused by the owner-authorized PB0–PB12 sequencing exception.
- After PB12, return to the roadmap-defined paused point unless a later explicit sequencing decision changes it.

## Continuity rule

Before every continuation, revalidate live `main`, open PRs, active branch, CI, deploy/proof and this document. If live evidence advances beyond this snapshot, update this document to the level actually proven rather than repeating completed work.

Do not claim PB9 or later slices Green without their required integrated and production evidence.