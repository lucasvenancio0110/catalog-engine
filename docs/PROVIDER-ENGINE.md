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

- scan a connected source and return a normalized listing index;
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

A successful provider scan returns a complete scan record containing:

- `complete: true`;
- `taxonomy: []` provider source-category evidence;
- `items: []` normalized listing records.

Each listing item must provide at least:

- private provider item/source ID;
- stable opaque public product ID;
- private source URL;
- listing fingerprint.

Current Yupoo listing evidence also includes source title, category path, cover URL and image-count hint.

A provider may enrich the evidence later, but CEI/sync code must not require Yupoo DOM concepts.

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

Malformed provider output fails the provider evidence contract before it is persisted as a complete scan/detail result.

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

Production Queue resources/bindings are still not activated by this milestone. Queue activation and two-tenant end-to-end ingestion are M5.

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

It must not require edits to CEI classification semantics, central scan/detail/finalize orchestration or storefront code merely to understand the source format.
