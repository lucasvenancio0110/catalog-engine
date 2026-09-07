# Catalog Engine — Provider Engine

Status: **Normative source/provider contract**  
Scope: source recognition, provider-specific ingestion and the boundary between supplier behavior and Catalog Engine evidence.

## Decision

Yupoo is the first Catalog Engine provider adapter. It is not the architecture boundary.

Provider-specific URL rules, crawling/parsing behavior, upstream media rules and provider identity seeds must live behind a provider adapter. Tenant orchestration, CEI, synchronization and public storefront logic consume Catalog Engine contracts rather than importing a Yupoo parser directly.

Launch scope remains intentionally narrow: only the Yupoo adapter is production-targeted for v1. A second provider is an architectural compatibility test, not a launch requirement.

## Layers

The provider engine has three responsibilities.

### Source provider

Owns low-cost source connection behavior:

- recognize whether a source belongs to the provider family;
- canonicalize/validate source locators;
- describe source scope such as whole catalog vs one category;
- support provider-specific network verification through a private adapter.

The tenant source connection domain stores the normalized provider key and private canonical locator. It does not contain provider host/path parsing rules.

### Ingestion provider

Owns supplier-specific import behavior:

- scan a connected source and return a normalized listing index/observation;
- fetch one detail item and return normalized detail evidence;
- derive provider-stable public category/media identities;
- expose provider-specific public-text leak signatures;
- enforce provider-specific upstream transport/redirect/media rules inside its parser/fetcher.

The central scan/detail/finalize consumers resolve the provider from tenant-private source state. They must not directly import provider parser modules.

### Catalog Engine core

Owns provider-independent behavior after evidence exists:

- tenant isolation and queue/job state;
- persistence boundaries;
- retries/leases/finalize barrier;
- normalized catalog processing;
- CEI classification and merchandising;
- merchant overrides/effective view;
- publication/runtime.

Supplier folder/category structure remains evidence. It never becomes public taxonomy truth merely because a provider emitted it.

## Provider contract v1

Shared registry contract version: `1`.

A source adapter exposes:

- `key`;
- `canHandleSource(sourceUrl)`;
- `normalizeSource(sourceUrl)`.

An ingestion adapter additionally exposes:

- `scanListingIndex(sourceUrl, options)`;
- `fetchDetail({ itemUrl, sourceUrl }, options)`;
- `publicCategoryId(sourceCategoryId)`;
- `mediaId(sourceMediaUrl)`;
- `publicTextLeakPatterns()`.

Provider-specific helper APIs may exist under the adapter implementation, but the central ingestion consumers should depend only on this contract.

## Normalized listing evidence

The shared provider boundary distinguishes a **validated scan observation** from an **authoritative complete scan result**.

A normalized scan observation contains:

- `complete: boolean`;
- `taxonomy: []` provider source-category evidence;
- `items: []` normalized listing records.

Each listing item must provide at least:

- private provider item/source ID;
- stable opaque public product ID;
- private source URL;
- listing fingerprint.

Current Yupoo listing evidence also includes source title, category path, cover URL and image-count hint.

Source category remains private evidence, not the public store taxonomy.

### IC3 bounded listing-page fan-out

IC3 may accelerate a provider listing scan only when it can preserve the same complete-scan authority.

For the Yupoo adapter:

- all listing/category/page network work shares one bounded `PQueue` request budget; nesting categories and pages must not multiply upstream concurrency;
- page-level fan-out is allowed only when page 1 contains explicit trustworthy evidence of the terminal page, such as an in-host last-page locator or bounded total-page metadata;
- a discovered terminal page above the configured hard page limit fails closed before fan-out;
- if an explicitly declared page is missing, empty or otherwise inconsistent with the declared pagination range, the authoritative scan fails rather than silently returning `complete:true`;
- when no trustworthy terminal-page evidence exists, the adapter falls back to the existing sequential natural-end scan instead of guessing the end of the catalog;
- category-route discovery may reuse the already-fetched first page; it must not fetch page 1 again merely because scan orchestration begins;
- an optional page-batch callback may receive provider-private normalized page evidence as `complete:false` for internal progressive ingestion work only;
- page-batch evidence is not a browser/public contract and may contain private provider locators; it must not be logged or exposed as customer evidence;
- no page batch, subset or partially completed fan-out may infer missing/removal, replace the authoritative source index or authorize publication;
- public product identity/fingerprint compatibility remains unchanged regardless of request order or concurrency.

The concurrency ceiling is a supplier-safety boundary, not a performance target. IC4 owns adaptive detail-flow control; IC3 must not introduce unbounded or adaptive supplier pressure under the listing scanner.

### Complete initial-import result

Initial import requires an authoritative complete scan. `assertCatalogProviderScanResult()` therefore accepts only `complete: true` after validating the normalized observation.

The current Yupoo launch adapter returns `complete: true` when its bounded scan finishes successfully and throws when it cannot complete the scan. Initial import must never persist a partial listing as its authoritative baseline.

### Incomplete synchronization observation

Recurring intelligent sync may consume a normalized `complete: false` observation through `assertCatalogProviderScanObservation()` when a provider/runtime can explicitly return bounded partial evidence.

That does **not** make the observation authoritative. M7 sync safety owns the consequences:

- no missing inference;
- no removal progression;
- no destructive source-index replacement;
- no last-known-good cursor promotion;
- no affected-detail publication merely to make a partial run look successful.

A malformed partial observation still fails the same provider evidence validation. `complete: false` is a safety signal, not permission to accept malformed provider data.

This distinction lets future providers express a partial observation without weakening the complete-scan requirement of initial import.

## Normalized detail evidence

A successful provider detail fetch returns at least:

- sanitized `name`;
- sanitized `description`;
- `images[]` with private source media locators;
- provider-level entity classification needed to reject obvious non-products;
- stable detail fingerprint.

This provider-level entity check is not CEI merchandising classification. CEI remains the owner of commercial/domain understanding after provider normalization.

## Identity compatibility

Existing Yupoo public IDs are a compatibility contract.

M4 must not rotate IDs for an already-imported Yupoo catalog. Yupoo category/media identity seeds therefore preserve their existing namespaces and literal provider key.

A future provider owns its own stable identity strategy under the provider contract. Changing an existing provider identity namespace requires an explicit migration, never a silent refactor.

## Privacy and trust boundary

Provider source URLs, raw provider IDs, media origins and locator references remain private tenant/data-plane evidence.

Public/admin summaries must not expose private source locators.

Queue messages remain minimal and opaque as defined by the tenant import contracts. Registering a provider must not cause credentials/source URLs to be copied into queue messages.

## Error behavior

Unknown/unsupported provider keys fail closed.

Malformed provider output fails the provider evidence contract before it is persisted as a complete scan/detail result or accepted as a bounded incomplete sync observation.

Safe orchestration errors may expose stable machine codes such as provider-not-supported or provider-contract-invalid. Raw upstream HTML/URLs/credentials must not become public error payloads.

## Current implementation boundary

The repository contains:

- a shared provider registry/contract;
- a source registry with Yupoo as the first adapter;
- provider-neutral tenant source connection orchestration;
- provider-neutral scan/detail/finalize consumers;
- a Yupoo ingestion adapter wrapping the existing hardened listing/detail implementations;
- compatibility tests that preserve existing Yupoo identity seeds.

The underlying Yupoo parsers remain intentionally provider-specific.

Production Queue resources/bindings are active and production-proven through M5. M7 recurring synchronization reuses this provider/Queue boundary under its own safety and activation gates; adding sync behavior must not weaken the initial-import contract.

## Adding a second provider

A second provider should be possible by:

1. implement source recognition/normalization;
2. implement provider-specific private verification;
3. implement normalized listing scan;
4. implement normalized detail fetch/media extraction;
5. define stable identity strategy and leak signatures;
6. register the adapter;
7. add provider fixtures/security tests;
8. prove tenant isolation and normalized evidence compatibility.

It must not require edits to CEI classification semantics, central scan/detail/finalize orchestration or storefront code merely to understand that source format.
