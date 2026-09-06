# Catalog Engine — Current State

Status: **Living implementation/proof truth**  
Snapshot refreshed: **2026-09-06**  
Repository: `lucasvenancio0110/catalog-engine`

This document is intentionally compact. It records current execution truth; focused normative documents own durable contracts and closure documents retain detailed historical evidence.

## Live baseline

- `main` at PB8 closure: `232b57450f57aa69a494a2724d2691d69f666b3e` — `PB8: close real tenant import Production Green (#243)`.
- Application Production SHA: `ccd69520607329acf764d3d5d29ddaaf29d0aa98`.
- Later main commits through PB8 closure are proof/automation/documentation changes and do not imply a newer application runtime.
- No open PR existed at the PB9 startup revalidation.
- PB9 working branch: `pb9-private-preview`.

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

PB9 — Private Preview is **IMPLEMENTATION IN PROGRESS**.

PB9 customer outcome:

> An authenticated merchant can preview the real verified tenant before custom-domain publication.

Required authority path:

```text
authenticated principal
-> active tenant membership
-> server-resolved tenant runtime/data plane
-> effective tenant catalog + brand + media
-> private merchant preview
```

PB9 must fail closed for anonymous, invalid, unready and cross-tenant access; it must never accept a client-supplied Worker/runtime locator or fall back to the default tenant. Preview responses must not expose supplier URLs, raw provider IDs, D1/Worker/Cloudflare locators or private CEI evidence, and must not become an indexable permanent public merchant address.

PB9 owner contracts remain `PORTAL-BETA-EXECUTION.md`, `CUSTOMER-PORTAL.md`, `TENANCY.md`, `SAAS-ARCHITECTURE.md`, `TENANT-RUNTIME-DISPATCH.md`, `TENANT-PUBLISH.md` and `DESIGN-SYSTEM.md`.

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