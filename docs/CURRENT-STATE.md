# Catalog Engine — Current State

Status: **Living implementation/proof truth**  
Snapshot refreshed: **2026-09-06**  
Repository: `lucasvenancio0110/catalog-engine`

This document is intentionally compact. It records current execution truth; focused normative documents own durable contracts and closure documents retain detailed historical evidence.

## Live baseline

- Exact live `main`: `afdbea2de486ea71f56ee3ca02582ea796225138` — `Storefront: honor persisted merchant theme (#271)`.
- Exact application Production SHA: `afdbea2de486ea71f56ee3ca02582ea796225138`.
- Trusted application deploy `34069153583`: **SUCCESS** on that exact SHA.
- PB9 trusted production proof `34069206479` / job `101583322432`: **SUCCESS** on that exact SHA.
- PB9 production status: `catalog-engine/pb9-production-proof = success` — authenticated real-tenant preview + isolation proven after the merchant-theme hotfix.
- Open pull requests at IC0 branch creation: none.
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

## Latest PB9 regression evidence

After PR #271 corrected storefront branding consumption, the exact production proof returned:

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

The proof also established all required PB9 isolation/readiness booleans as true on `afdbea2de486ea71f56ee3ca02582ea796225138`.

## Instant Catalog owner decision

On 2026-09-06 the owner explicitly decided that first catalog value must be dramatically faster and that store creation should include a premium, branded, truthful loading experience.

The bounded architecture/execution contract is `docs/INSTANT-CATALOG.md`.

The decision introduces the temporary sequence:

```text
PB9
-> IC0 -> IC1 -> IC2 -> IC3 -> IC4 -> IC5 -> IC6
-> PB10 -> PB11 -> PB12
```

This does **not** reopen PB9. The existing PB9 verified preview is the Last Known Good authority while the earlier construction-preview path is developed.

### IC0 — Governance + performance contract

Status: **IN PROGRESS** on branch `plan/instant-catalog-governance` until the planning PR is merged.

IC0 defines:

- TTFI/TTFC/TTFA/TTFH/TTFV timing contracts;
- L0 INDEXED / L1 HYDRATED / L2 VERIFIED readiness levels;
- authenticated construction preview distinct from PB9 verified preview;
- branded full-screen creation/loading UX with real stages/counts and no fake percentage/ETA;
- instant provider seed path;
- provider-safe page fan-out;
- adaptive detail concurrency/backpressure;
- bounded warm tenant cell pool with default-OFF activation;
- second fresh beta account/tenant speed proof before PB10 resumes.

No IC implementation behavior is production-authorized merely because this planning branch exists. IC1 starts only after IC0 planning is merged.

## Performance root cause confirmed in code

The current initial import architecture is safe but deliberately conservative:

- scan Queue consumer max concurrency `1`;
- detail Queue max batch size `4`, max batch timeout `5s`, max concurrency `2`;
- the detail consumer processes messages in its delivered batch sequentially;
- the Yupoo listing scanner uses bounded category concurrency but walks pages inside an individual listing sequentially;
- first verified preview waits for the authoritative import -> CEI -> verification -> trusted runtime staging/dispatch chain;
- physical tenant runtime/data-plane preparation still includes trusted CI work outside the merchant request path.

These are not justification for unsafe unbounded concurrency. IC1–IC5 will replace fixed latency with measured progressive delivery, provider-aware flow control and pre-created isolated capacity while preserving current correctness boundaries.

## Active execution point

**IC0 — Governance + performance contract: IN PROGRESS.**

PB10 — Merchant Home remains approved but is temporarily paused by the explicit owner-authorized Instant Catalog insertion. PB10 resumes only after IC6's fresh-tenant speed/isolation proof reaches its required Green state.

Permanent boundaries during IC0–IC6:

- store/session/preview authority remains server-resolved and membership-scoped;
- no raw supplier/provider/runtime identifiers in browser/public evidence;
- no fake progress or invented remaining time;
- no construction-preview state may become publication authority;
- current verified PB9 path remains rollback/LKG;
- initial import may remain enabled;
- recurring Intelligent Sync remains OFF;
- M7E remains decision-gated;
- public custom-domain publication is not activated merely to prove speed.

## Exact continuation action

1. merge IC0 only after documentation/governance consistency is confirmed;
2. revalidate the merged `main` and current Production SHA;
3. start **IC1 — Real latency baseline + branded creation UX** on a fresh branch;
4. instrument server-side timing boundaries before changing concurrency;
5. implement the full-screen merchant-branded creation/loading surface using only real backend stages/counts;
6. deploy and record the current production latency baseline;
7. only then start IC2's instant seed/construction-preview behavior.

## Broader roadmap boundary

- M7A through M7D10: **PRODUCTION GREEN** within their bounded contracts.
- M7D11: **PLANNED** unless later live evidence proves otherwise.
- M7E: **DECISION REQUIRED**; recurring sync remains OFF.
- M9A: **PRODUCTION GREEN**.
- M9B: **IN PROGRESS — PAUSED** by the owner-authorized PB campaign.
- M9C/M9D: **PLANNED**.
- IC0–IC6 are the current bounded insertion after PB9 and before PB10.
- PB10/PB11/PB12 remain approved campaign slices behind IC6.
- After PB12, return to the roadmap-defined paused point unless a later explicit owner decision changes sequencing.

## Continuity rule

Before every continuation, revalidate live `main`, open PRs, active branch, CI, deploy/proof and this document. If live evidence advances beyond this snapshot, update this document to the level actually proven rather than repeating completed work.

Do not claim an IC slice, PB10 or later slice Green without its required integrated and production evidence.
