# Tenant detail import and finalize barrier

Status: **Normative implementation contract**  
Scope: initial tenant detail Queue processing, finalize barrier and progression into CEI/classification.

The initial tenant import has two queue stages after the complete listing scan.

## Detail stage

The scan Worker writes the supplier listing index and raw source taxonomy only to the isolated tenant D1, then emits opaque detail messages to the private detail queue. A detail message contains only `importId`, `tenantId`, `sourceKey`, and the private v1 source-item field `albumSourceId`.

The detail consumer resolves the private item URL, provider and tenant data-plane runtime through server-owned state at runtime. It then resolves the registered ingestion provider and validates the normalized detail evidence before catalog persistence. Merchant browsers never receive the source locator, D1 UUID or tenant Worker locator.

Each source item is claimed in `supplier_album_detail_state` with a short lease and an opaque claim token. Duplicate deliveries are safe: terminal items are skipped and an active claim cannot be stolen until its lease expires.

Provider-specific network and parsing rules live behind the Provider Engine adapter. The Yupoo launch adapter currently enforces manual redirects restricted to the original Yupoo host and accepts product images only from the allowed provider media boundary. Public names/descriptions are sanitized before normalization. Source image URLs and item URLs are written only to private media/source tables; public catalog rows contain opaque product/category/media identifiers.

Transient failures remain retryable. After the bounded detail attempt limit, an incomplete item becomes `deferred` for this initial import instead of blocking an entire merchant catalog. Its source detail fingerprint remains incomplete so a later safe synchronization/recovery path can retry it under its own authority.

If a detail delivery dies after acquiring a claim, the lease protects that work until expiry. Once an initial-import claim is both expired and already at or above the bounded detail attempt limit, the periodic finalize delivery terminalizes that exact tenant/source/import claim as `deferred` before evaluating the barrier. This recovery is idempotent, never steals an active lease and prevents Queue retry exhaustion or a DLQ transition from stranding onboarding in `details` forever.

## Provider-neutral persistence

Central detail orchestration must not hard-code provider names in media persistence or identity generation.

The provider adapter owns:

- provider key;
- detail fetch/parser;
- media identity derivation;
- provider-stable category identity derivation;
- provider source leak signatures.

The core owns catalog/CEI normalization and tenant-safe persistence.

Existing Yupoo category/media IDs are preserved exactly by the Yupoo adapter so provider-neutral refactors do not rotate already-published opaque identifiers.

## Finalize stage

The platform cron periodically emits an opaque finalize message after the listing fan-out cursor reaches the discovered item count. Finalization is a barrier, not a timer: it succeeds only when every discovered item is terminal (`success`, `skipped`, or `deferred`).

Before counting terminal rows, the finalize delivery performs the bounded expired-claim recovery described above. It may only terminalize initial-import rows owned by the same `tenantId`/`sourceKey`/`importId`, with `state='processing'`, an expired non-null lease and an already-exhausted detail attempt budget. Pending work, active leases and retryable claims are left untouched.

Finalization recomputes category, league, team and facet counts from the isolated tenant D1, removes unreferenced private media, writes public catalog metadata and runs a white-label check over public product text.

The white-label check is provider-neutral: generic URL leakage is rejected and provider-specific source signatures are supplied by the active provider adapter. The finalizer does not make the supplier hostname part of the public contract.

Control-plane import counters are then written as absolute aggregates rather than incremented per queue message.

A successful initial import completes only the `import` provisioning checkpoint and advances onboarding to `classify`. It does not publish the tenant, activate a custom domain, or authorize recurring Intelligent Sync.

## Production activation boundary

The scan/detail Queue topology is **production-activated and production-proven** under M5. The repository and production environment contain the dedicated scan/detail Worker entrypoints, Queue bindings, DLQs, provider-neutral consumers and Yupoo launch adapter, with automatic initial-import discovery controlled by `TENANT_IMPORT_AUTOMATION_ENABLED` and currently enabled in the production configuration.

Initial-import activation does not activate recurring tenant Intelligent Sync. `TENANT_SYNC_AUTOMATION_ENABLED=0`, the empty active cohort and the bounded per-tick sync cap remain separate M7 safety authorities.

Current Queue topology/retry/rollback proof belongs to `TENANT-IMPORT-QUEUES.md`, `TENANT-IMPORT-PIPELINE.md`, `CURRENT-STATE.md` and the focused M5 closure evidence.

Dedicated `CLOUDFLARE_PLATFORM_*` runtime credentials remain server/trusted-CI secrets and fail closed when absent. Ordinary customer import work must use the isolated tenant dispatch/data-plane boundaries and must not expose those credentials or provider locators to the portal.
