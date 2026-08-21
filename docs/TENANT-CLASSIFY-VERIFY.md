# Tenant classify and verify checkpoints

Status: **Normative implementation contract**  
Scope: post-import CEI classification persistence, merchant override semantics and verification before preview/domain progression.

After an isolated tenant import completes, Catalog Engine does not publish immediately. The onboarding state moves through explicit post-import gates: `classify` and `verify`.

## Versioned classification

`src/domain/catalog-classifier.js` owns the currently active launch classifier contract.

Current classifier identity:

```text
CATALOG_CLASSIFIER_VERSION = 2
CATALOG_CLASSIFIER_KEY = professional-v2
```

Classifier v2 consumes normalized CEI Evidence rather than provider-specific product objects. The current production-targeted Knowledge Pack is Sports v1, but persisted CEI intelligence state must remain retail-domain-neutral so future Automotive, Dental, Fashion or other Knowledge Packs do not require a new core persistence model merely because their fields differ.

Classification runs from evidence already stored in the isolated tenant D1: source-safe product fields, private source category paths, structured evidence and controlled Knowledge Pack data. It does not refetch supplier detail pages simply to reclassify an existing stored catalog.

This is important for classifier upgrades: a future classifier can reprocess stored normalized evidence without another full supplier crawl.

## Automatic inference vs effective view

Catalog Engine preserves two different concepts:

```text
automatic CEI inference
+
merchant override
=
effective view
```

The automatic result is retained separately from the merchant-corrected result.

Manual classification overrides remain in `catalog_product_classification_overrides` and are durable tenant business data. The automatic classifier runs first; validated overrides apply last.

A classifier rerun must not silently erase a merchant decision.

Invalid dictionary/entity references or public labels containing supplier/web URLs fail closed instead of being persisted as public storefront data.

## Domain-neutral CEI intelligence state

Tenant data-plane schema v4 adds `catalog_product_intelligence_state`.

This table stores one bounded, schema-validated CEI state per product, including operational indexes for:

- CEI intelligence-state contract version;
- evidence schema version;
- classifier version/key;
- Knowledge Pack key/version;
- detected domain and confidence;
- domain knowledge state;
- effective knowledge state;
- merchant override applied;
- review required;
- research/escalation required;
- conflict count;
- validated `state_json`;
- timestamps.

The canonical JSON contract is owned by:

`src/catalog-intelligence/core/intelligence-state.js`

The Core represents product understanding as generic field claims rather than fixed Sports columns.

Examples:

### Sports claim fields

```text
team
league
facets
season
```

### Future Automotive claim fields

```text
productType
make
model
engine
boltPattern
offset
fitment
```

### Future Dental claim fields

```text
componentType
family
connection
platform
diameter
```

Adding a new retail domain must not require teaching the CEI Core what those field names mean. Domain/Knowledge Pack code produces the claims; the Core validates and persists them.

## Knowledge state

CEI state distinguishes operational knowledge states:

- `VERIFIED` — strongly supported knowledge;
- `KNOWN` — sufficiently supported for normal automation;
- `UNCERTAIN` — plausible but below the normal automatic-decision threshold;
- `UNKNOWN` — insufficient knowledge;
- `CONFLICT` — meaningful evidence disagrees;
- `STALE` — previously known evidence requires revalidation.

Confidence remains field-level where fields carry independent uncertainty.

The exact thresholds are versioned/calibrated implementation decisions and must be regression-tested rather than scattered as unrelated magic constants.

## Research/escalation signal

Schema v4 may record `research_required`/reason codes as CEI operational state.

This is an escalation signal, not a claim that universal autonomous research is already production-complete.

M6 launch scope still follows `CEI.md` and `DEVELOPMENT-ROADMAP.md`: deterministic Sports v1 quality is the current requirement; universal autonomous research remains future/experimental scope until deliberately activated.

## Verification gate

The verify runner is a hard publication/progression integrity gate.

It checks the isolated tenant D1 for:

- non-empty catalog;
- one current classification-state row per product;
- classifier version/key completeness;
- manual override/classification-state consistency;
- one current CEI intelligence-state row per product;
- CEI contract/evidence/classifier version completeness;
- CEI override-state consistency;
- valid bounded JSON state persisted through the v4 schema contract;
- no supplier URLs in public product/search/category text;
- valid product category references;
- active primary media when a product has images;
- product/media count consistency and no orphan associations;
- category/team/league/facet aggregate count consistency for the current Sports launch model.

Only stable safe finding codes are persisted in the control plane. Raw provider errors, URLs, credentials, source IDs, HTML and private CEI evidence are not stored in verification findings.

## Exceptions are not tenant corruption

`review_required`, `research_required` and semantic conflicts are important operational metrics, but they do not automatically mean the entire tenant catalog is structurally invalid.

Therefore verification distinguishes:

### Blocking integrity defects

Examples:

- missing/stale classifier state;
- missing/stale CEI intelligence state;
- override-state mismatch;
- public supplier leak;
- orphaned category/media relationships;
- invalid aggregate integrity.

These fail verification.

### Non-blocking CEI exception metrics

Examples:

- products requiring merchant review;
- products marked for future research/escalation;
- unresolved semantic conflicts already represented safely as review/unknown.

These are surfaced as counts for downstream operational/review experiences instead of making one ambiguous product block an otherwise healthy catalog.

This preserves the Catalog Engine operating principle:

> automate normal paths; surface exceptions.

## Progression boundary

A successful verification advances onboarding only from `verify` to the next readiness/domain checkpoint.

It does not by itself:

- publish the store;
- make an unverified custom domain active;
- bypass runtime/domain smoke;
- expose raw CEI reasoning in the storefront.

Domain readiness and final publication remain separate checkpoints.

## Schema version 4

Tenant data-plane schema v4 extends v3 rather than destructively replacing existing classification/override structures.

V3 remains the compatibility base containing:

- `catalog_product_classification_state`;
- `catalog_product_classification_overrides`.

V4 adds detailed CEI intelligence persistence while preserving existing effective public fields and merchant overrides.

New classification/verification work that depends on detailed CEI state requires schema v4.

Migration generation remains idempotent and version-ledgered. Private source URLs are still runtime-bound parameters, never static migration literals.

## Public boundary

Detailed CEI state belongs to the tenant operational/review plane.

The ordinary public storefront must not expose by default:

- provider provenance;
- raw conflict diagnostics;
- private source evidence;
- internal field-confidence breakdowns;
- research internals;
- tenant-private memory.

Customer-facing CEI review must translate uncertainty into simple merchant decisions according to `CUSTOMER-PORTAL.md`, `DESIGN-SYSTEM.md` and the later CEI Review milestone.

## Final decision rule

Before changing classification or verification ask:

> Does this preserve automatic inference separately from merchant truth, keep CEI persistence domain-neutral, fail closed on structural corruption, and surface ordinary uncertainty as an exception rather than pretending to know?

If not, the change is incomplete.
