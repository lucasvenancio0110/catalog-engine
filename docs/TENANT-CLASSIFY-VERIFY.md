# Tenant classify and verify checkpoints

After an isolated tenant import completes, Catalog Engine does not publish immediately. The onboarding state moves through two explicit post-import gates: `classify` and `verify`.

## Versioned classification

`src/domain/catalog-classifier.js` is the public classification contract. Each ruleset has a numeric version and stable key. Version 1 wraps the existing professional sports normalization and records the applied version for every published product in `catalog_product_classification_state`.

Classification runs entirely from evidence already stored in the tenant D1: source-safe product fields, private source category paths, and controlled dictionaries. It does not refetch supplier album pages. This is important for future classifier upgrades: a new ruleset can reclassify tens of thousands of stored products without another full supplier crawl.

Manual classification overrides live separately in `catalog_product_classification_overrides`. The automatic classifier always runs first; validated manual fields are applied last and therefore survive classifier reruns. Invalid dictionary references or public labels containing supplier/web URLs fail the classification job rather than silently leaking into the storefront.

## Verification gate

The verify runner is a hard publication gate. It checks the isolated tenant D1 for:

- non-empty catalog;
- one current classification-state row per product;
- classifier version/key completeness;
- manual override/state consistency;
- no supplier URLs in public product/search/category text;
- valid product category references;
- active primary media when a product has images;
- product/media count consistency and no orphan associations;
- category/team/league/facet aggregate count consistency.

Only stable finding codes are persisted in the control plane. Raw provider errors, URLs, credentials, album IDs, and source HTML are never stored in verification findings.

A successful verification advances onboarding only from `verify` to `domain`. It does not mark the store published and does not enable Workers for Platforms dispatch. Domain readiness and final publish remain separate checkpoints.

## Schema version 3

Tenant data-plane schema v3 adds classification state and durable manual override tables. New tenant imports require schema v3 before ingestion starts. The control plane also keeps resumable `tenant_classification_jobs` and `tenant_verification_jobs` so interrupted post-import work can be retried safely.

The current classifier key is `professional-v1`. It is intentionally not presented as the final extreme sports taxonomy. That future classifier should be introduced as a new version after its rules are reconstructed, persisted, and tested; the stored supplier evidence and manual overrides allow that upgrade without a full supplier detail reread.
