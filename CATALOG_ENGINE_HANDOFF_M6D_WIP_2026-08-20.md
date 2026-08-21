# CATALOG ENGINE — M6D WIP HANDOFF

**Snapshot:** 2026-08-20 23:51 BRT  
**Canonical handoff:** `CATALOG_ENGINE_HANDOFF_2026-08-20.md`  
**Active feature branch:** `m6d/cei-persistence-verification-v1`  
**Latest feature head in this checkpoint:** `aaf075e37f0be7b8a19169cdca31cac8dd432afe`

> Read the canonical handoff first, then this file. This WIP checkpoint exists because M6D is actively being implemented and is not yet merged into `main`. When M6D closes, consolidate this state back into the canonical handoff.

## Current milestone state

- M5 automatic tenant Queue import: COMPLETE / production-proven.
- M6A Normalized Evidence v1: COMPLETE.
- M6B CEI-native runtime + Sports Knowledge Pack v1: COMPLETE / production-green.
- M6C field confidence + semantic conflicts + reliable season: COMPLETE / production-green.
- M6D detailed CEI persistence + verification + merchandising: **IN PROGRESS**.

M6C production evidence remains:

- application deploy run `32431795992` = SUCCESS;
- automatic tenant import canary run `32431848821` = SUCCESS;
- canary job `96624897449` = SUCCESS.

## Important product clarification

`docs/CEI.md` already contains the normative broad CEI architecture. Do not create a competing CEI definition.

The CEI Core must remain domain-neutral.

Sports is one launch Knowledge Pack, not the CEI itself.

Future domains must be pluggable without changing CEI Core persistence, for example:

- automotive/wheels: productType, diameter, boltPattern, offset;
- dental: componentType, family, connection, platform;
- fashion: productType, material, color, size;
- electronics: deviceType, brand, model, capacity.

## CEI epistemic states now being implemented

The active branch formalizes:

- `VERIFIED`
- `KNOWN`
- `UNCERTAIN`
- `UNKNOWN`
- `CONFLICT`
- `STALE`

These states complement numeric confidence. CEI must not rely on one misleading global confidence score.

Central provisional thresholds currently live in:

`src/catalog-intelligence/core/intelligence-state.js`

They are intentionally centralized for later calibration with real data.

## Automatic inference vs effective state

A critical M6D rule is now implemented in the branch:

```text
AUTOMATIC CEI INFERENCE
+
MERCHANT OVERRIDE
=
EFFECTIVE VIEW
```

Merchant correction must never erase what CEI originally inferred.

`src/domain/catalog-classifier.js` now preserves `automaticState` before applying merchant overrides and marks overridden fields.

## Domain-neutral intelligence state

Active file:

`src/catalog-intelligence/core/intelligence-state.js`

The Core persistence contract no longer models Sports as fixed fields.

Instead it uses generic bounded claims:

```text
claims[field] = {
  value,
  confidence,
  knowledgeState,
  evidenceSources,
  source: inference | merchant_override
}
```

This lets the same state model represent Sports, Automotive, Dental or another future domain.

The state also persists:

- evidence schema version;
- classifier key/version;
- Knowledge Pack key/version;
- domain + confidence + knowledge state;
- automatic view;
- effective view;
- conflicts;
- reviewRequired;
- overrideApplied;
- research.required + reason codes.

`research.required` is only a durable signal in M6D. Autonomous web research execution is NOT implemented by this slice.

## Non-Sports regression proof

New test:

`tests/cei-intelligence-state.test.mjs`

Includes an Automotive/Wheels-style classification with claims:

- `productType=wheel`
- `diameter=18`
- `boltPattern=5x112`
- `offset=35`

The test verifies the CEI Core accepts these fields without adding Automotive-specific Core schema columns.

This is the current architecture proof that CEI is not a football classifier renamed as intelligence.

## Tenant data-plane schema v4

New file:

`worker/tenant-data-plane-schema-v4.js`

Current target:

`TENANT_DATA_PLANE_SCHEMA_VERSION = 4`

New generic table:

`catalog_product_intelligence_state`

Indexed summary columns include:

- contract/evidence/classifier versions;
- Knowledge Pack identity;
- domain id/confidence/knowledge state;
- effective knowledge state;
- override_applied;
- review_required;
- research_required;
- conflict_count;
- canonical `state_json` guarded by `json_valid()`.

Important: v4 intentionally does NOT create fixed columns such as:

- team_confidence;
- league_confidence;
- season_confidence;
- bolt_pattern;
- vehicle_make;
- dental_platform.

Domain-specific intelligence belongs inside validated claims / Knowledge Packs, not the CEI Core schema.

New schema regression:

`tests/tenant-data-plane-schema-v4.test.mjs`

## Migration runner

`worker/data-plane-migration-runner.js` on the feature branch now targets schema v4.

Migration remains intended to be:

- isolated per tenant;
- idempotent;
- backward-safe from v3;
- verified through data_plane_identity and migration ledger.

## Durable CEI persistence adapter

New file:

`worker/cei-intelligence-persistence.js`

It converts validated CEI state into one bounded D1 UPSERT for `catalog_product_intelligence_state`.

Invalid CEI state fails closed as:

`cei_intelligence_state_invalid`

The tenant classification runner maps this to a safe operational error code.

## Tenant classification runner

`worker/tenant-classification-runner.js` on the active branch now:

- requires current schema v4;
- keeps the legacy/public classification state for compatibility;
- persists generic CEI intelligence state for every classified product;
- preserves merchant overrides;
- keeps current storefront/public fields unchanged.

No public API contract has been changed.

## Verification integration

`worker/tenant-verification-runner.js` on the active branch now verifies:

- every catalog product has current legacy classification state;
- every product has current CEI intelligence state;
- CEI contract/classifier version is current;
- `state_json` is valid JSON;
- intelligence override state matches durable merchant override presence.

New blocking finding codes:

- `intelligence_state_incomplete`
- `intelligence_override_state_mismatch`

But these are intentionally NON-blocking as whole-store defects:

- products that need review;
- products that need future research;
- semantic conflicts.

They are counted as operational metrics instead:

- `reviewRequired`
- `researchRequired`
- `conflicts`

This preserves the product principle:

`AUTOPILOT + EXCEPTIONS`

A handful of ambiguous products must not automatically prevent an otherwise healthy tenant from publishing.

Updated test:

`tests/tenant-verification.test.mjs`

It explicitly proves that review/research/conflict counts do not become verification findings when persistence integrity is healthy.

## Current feature commits in this slice

Key commits already made on `m6d/cei-persistence-verification-v1` include:

- initial Intelligence State contract: `934aa1a25d142d7518c551526c0a2d45a22dc8ba`
- knowledge-aware/domain-neutral state: `80fde22d138ccb8dc6c0f3073c152a61234f752e`
- classifier automatic/effective preservation: `98b0ac4c6c462ef33861722fc3dd3ac1ac5a53ab`
- intelligence state regression: `b7568c90fc90a9b03dcdc904a28ed22840e174a1`
- schema v4: `3dcc9659baf8d7ba0f6b98bbc0cab4dede4910c3`
- schema v4 regression: `6c575b23c5ab5ed1e2a9e532abf05d2a9a5b0b56`
- migration runner v4: `dc2180745c70cfde517e2553632b41aa19ef1ab3`
- CEI persistence adapter: `39a5d21f1b5ef0d56703aab3abdbebdfae44e3ec`
- classification persistence wiring: `2b32f5ad28a36e415e838dc4756cdd58bded8132`
- verification integration: `c81c2f66ca0afc2db2b0359d84e4204aec1341f9`
- verification regression: `aaf075e37f0be7b8a19169cdca31cac8dd432afe`

## PR state

An attempt to open the M6D draft PR through the connector was blocked by the tool safety layer before PR creation. This was a tooling event, not a repository failure.

No M6D PR should be assumed to exist until revalidated.

Do not merge the feature branch directly without CI.

## Next exact actions

1. revalidate feature branch head;
2. inspect all remaining references that assume schema v3 is current;
3. update only the references that must move to v4; preserve historical v3 tests where they intentionally test v3;
4. add direct persistence statement regression tests;
5. run/open secret-free PR validation;
6. fix any quality/provisioning/ingestion/control-plane regressions;
7. mark PR ready only after all relevant gates pass;
8. merge with expected head SHA;
9. monitor trusted-main application deploy;
10. monitor automatic tenant import canary;
11. only after production-green, consolidate this WIP checkpoint into `CATALOG_ENGINE_HANDOFF_2026-08-20.md` and remove/archive this WIP document;
12. evaluate remaining merchandising/review-feed work before declaring M6 complete.

## Do not do yet

- do not start M7;
- do not implement a second real provider just to prove CEI;
- do not expose private CEI provenance/conflicts directly in the public storefront;
- do not implement universal autonomous web research inside this persistence slice;
- do not make Sports-specific columns part of CEI Core;
- do not make `needs_review` block an entire healthy store by default.
