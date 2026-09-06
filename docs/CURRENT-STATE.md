# Catalog Engine — Current State

Status: **Living implementation/proof truth**  
Snapshot refreshed: **2026-09-06**  
Repository: `lucasvenancio0110/catalog-engine`

This document is intentionally compact. It records current execution truth; focused normative documents own durable contracts and closure documents retain detailed historical evidence.

## Live baseline

- Exact application-code `main` / Production SHA proven before this documentation-only closure refresh: `2e73cefc912d51fe8c10e693f48cb690ff36190e` — `PB9: redeploy latest main with serialized staging guard (#269)`.
- Trusted application deploy `34067792639`: **SUCCESS** on that exact SHA.
- PB9 trusted production proof `34067838547` / job `101579641324`: **SUCCESS** on that exact SHA.
- PB9 production status: `catalog-engine/pb9-production-proof = success` — authenticated real-tenant preview + isolation proven.
- No open implementation PR existed immediately before the PB9 documentation-closure branch was created.
- `HUMAN_GATE_LOCK: INACTIVE` in the durable operational state at this snapshot.

## Production activation boundary

```text
TENANT_IMPORT_AUTOMATION_ENABLED=1
TENANT_SYNC_AUTOMATION_ENABLED=0
TENANT_SYNC_ACTIVE_COHORT=""
TENANT_SYNC_MAX_JOBS_PER_TICK=1
```

Automatic **initial tenant import is enabled**. Recurring tenant Intelligent Sync remains **disabled**. M7E remains separately decision-gated.

## Proven first-merchant state

PB0 through PB9 of the owner-authorized first-real-merchant campaign are closed within their bounded contracts.

- PB0 — Live Truth + Sequencing Decision: complete/governance green.
- PB1 — Authentication Foundation: **PRODUCTION GREEN**.
- PB2 — Account + Beta Entitlement: **PRODUCTION GREEN**.
- PB3 — Create Store: **PRODUCTION GREEN**.
- PB4 — Branding: **PRODUCTION GREEN**.
- PB5 — Source Connection: **PRODUCTION GREEN**.
- PB6 — Source Scope / Import Decision: **PRODUCTION GREEN**.
- PB7 — Provisioning Progress: **PRODUCTION GREEN**.
- PB8 — Real Tenant Import: **PRODUCTION GREEN**; detailed proof in `PB8-CLOSURE-2026-09-06.md`.
- PB9 — Private Preview: **PRODUCTION GREEN**; detailed proof in `PB9-CLOSURE-2026-09-06.md`.

The real CROCCODILOS isolated tenant has:

- 6,104 discovered and 6,104 terminal details from the initial import;
- 6,097 persisted products and 15,396 media links;
- CEI/classification success for 6,097 products: 5,869 automatic, 228 review, 0 unknown;
- verification success for 6,097 products with 0 findings;
- full catalog runtime `verified`, runtime version `1`;
- PB9 private preview feed, own-product detail and own-media access proven in production;
- anonymous, cross-tenant and default-tenant access proven fail-closed;
- no private provider/runtime identifiers exposed by the PB9 proof;
- recurring Intelligent Sync still OFF.

The historical default tenant remains an explicit compatibility tenant and must never be used as an implicit fallback for CROCCODILOS or any new merchant.

## PB9 Production Green evidence

PB9 customer outcome:

> An authenticated merchant can preview the real verified tenant before custom-domain publication.

The exact production proof returned:

```text
pb9ProductionProof=passed
merchant=CROCCODILOS
merchantCatalogProducts=6097
previewProductsReturned=15
runtimeStatus=verified
runtimeVersion=1
runtimeLastErrorCode=none
jobStatus=success
jobLastErrorCode=none
privateIdentifiersExposed=false
recurringIntelligentSyncEnabled=false
```

The proof also established all required booleans as true:

- unique merchant;
- isolated merchant;
- active owner;
- runtime ready;
- verification ready;
- tenant catalog present;
- shell private;
- metadata matches tenant;
- product feed works;
- own product works;
- own media works;
- anonymous fails closed;
- cross-tenant fails closed;
- default tenant cannot read merchant;
- private identifiers hidden;
- recurring sync still off.

The trusted physical runtime-staging path was separately proven by run `34067139582` / job `101579132175`: one eligible tenant selected, one staged, zero failed, with safe aggregate product count `6097`.

PB9 also corrected the runtime-administration boundary: trusted GitHub CI owns Workers-for-Platforms tenant runtime upload; the application Worker performs only durable discovery plus server-owned dispatch smoke/verification. The two production mutation paths no longer compete on the same push for the single pending `catalog-engine-production-d1` concurrency slot.

## Active execution point

PB10 — Merchant Home is **PLANNED — NEXT APPROVED SLICE**.

PB10 bounded customer outcome:

> A persisted merchant store reappears after portal re-entry with action-oriented real status and a truthful path either to private preview or to the remaining onboarding continuation.

PB10 must preserve these boundaries:

- store/session state comes from durable authenticated server authority, never a fabricated client object;
- merchant-visible status must map to real backend state and avoid fake percentages/timers;
- a preview action is available only when PB9 readiness remains valid;
- unfinished onboarding exposes a truthful continuation path;
- tenant authority remains membership-scoped and server-resolved;
- private source/runtime/provider identifiers remain hidden;
- public custom-domain publication remains outside PB10 unless its focused contract explicitly requires a non-destructive readiness projection;
- recurring Intelligent Sync remains OFF.

PB10 is not implemented merely because the current store card can already display progress/readiness. Its full approved Definition of Done must be re-read from `PORTAL-BETA-EXECUTION.md` and live code must be audited before branch creation.

## Exact continuation action

1. merge the PB9 documentation closure only after its ordinary CI is green;
2. revalidate the new documentation-only `main` and confirm the application Production SHA remains `2e73cefc912d51fe8c10e693f48cb690ff36190e` unless a later application deploy proves otherwise;
3. re-read the live PB10 definition and customer-portal owner contracts;
4. audit current `/api/admin/stores` / session projections and portal store-card/home behavior against PB10's exact DoD;
5. implement only the first bounded PB10 claim on a fresh branch/PR;
6. require appropriate trusted-main production proof before calling PB10 Green.

## Broader roadmap boundary

- M7A through M7D10: **PRODUCTION GREEN** within their bounded contracts.
- M7D11: **PLANNED** unless later live evidence proves otherwise.
- M7E: **DECISION REQUIRED**; recurring sync remains OFF.
- M9A: **PRODUCTION GREEN**.
- M9B: **IN PROGRESS — PAUSED** by the owner-authorized PB0–PB12 sequencing exception.
- M9C/M9D: **PLANNED**.
- PB10 is the next approved campaign slice; PB11/PB12 remain planned.
- After PB12, return to the roadmap-defined paused point unless a later explicit owner decision changes sequencing.

## Continuity rule

Before every continuation, revalidate live `main`, open PRs, active branch, CI, deploy/proof and this document. If live evidence advances beyond this snapshot, update this document to the level actually proven rather than repeating completed work.

Do not claim PB10 or later slices Green without their required integrated and production evidence.
