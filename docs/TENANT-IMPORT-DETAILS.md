# Tenant detail import and finalize barrier

The initial tenant import has two queue stages after the complete listing scan.

## Detail stage

The scan Worker writes the supplier listing index and raw source taxonomy only to the isolated tenant D1, then emits opaque detail messages to the private detail queue. A detail message contains only `importId`, `tenantId`, `sourceKey`, and the private v1 source-item field `albumSourceId`.

The detail consumer resolves the private item URL, provider and tenant D1 through control-plane state at runtime. It then resolves the registered ingestion provider and validates the normalized detail evidence before public catalog persistence.

Each source item is claimed in `supplier_album_detail_state` with a short lease and an opaque claim token. Duplicate deliveries are safe: terminal items are skipped and an active claim cannot be stolen until its lease expires.

Provider-specific network and parsing rules live behind the Provider Engine adapter. The Yupoo launch adapter currently enforces manual redirects restricted to the original Yupoo host and accepts product images only from `photo.yupoo.com`. Public names/descriptions are sanitized before normalization. Source image URLs and item URLs are written only to private media/source tables; public catalog rows contain opaque product/category/media identifiers.

Transient failures remain retryable. After the bounded detail attempt limit, an incomplete item becomes `deferred` for this initial import instead of blocking an entire merchant catalog. Its source detail fingerprint remains incomplete so a later intelligent sync can retry it.

## Provider-neutral persistence

Central detail orchestration must not hard-code provider names in media persistence or identity generation.

The provider adapter owns:

- provider key;
- detail fetch/parser;
- media identity derivation;
- provider-stable category identity derivation;
- provider source leak signatures.

The core owns catalog/CEI normalization and tenant-safe persistence.

Existing Yupoo category/media IDs are preserved exactly by the Yupoo adapter so M4 does not rotate an already-published catalog's opaque identifiers.

## Finalize stage

The platform cron periodically emits an opaque finalize message after the listing fan-out cursor reaches the discovered item count. Finalization is a barrier, not a timer: it succeeds only when every discovered item is terminal (`success`, `skipped`, or `deferred`).

Finalization recomputes category, league, team and facet counts from the isolated tenant D1, removes unreferenced private media, writes public catalog metadata and runs a white-label check over public product text.

The white-label check is provider-neutral: generic URL leakage is rejected and provider-specific source signatures are supplied by the active provider adapter. The finalizer does not contain Yupoo host literals.

Control-plane import counters are then written as absolute aggregates rather than incremented per queue message.

A successful initial import completes only the `import` provisioning checkpoint and advances onboarding to `classify`. It does not publish the tenant, activate a custom domain, or enable dynamic Workers for Platforms dispatch.

## Activation boundary

The repository contains separate scan/detail Worker entrypoints, provider-neutral central consumers and Yupoo as the first provider adapter, but production Queue bindings remain intentionally disabled until the ingestion runtime is activated deliberately in M5.

Dedicated `CLOUDFLARE_PLATFORM_*` runtime credentials remain required and fail closed when absent. M5 must prove the full two-tenant end-to-end queue/D1 separation before automatic imports are enabled.
