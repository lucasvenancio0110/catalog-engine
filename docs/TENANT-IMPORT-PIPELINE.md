# Isolated tenant import pipeline

## Decision

Customer supplier imports must not run through public GitHub Actions. A customer source URL is private tenant configuration and could leak through public workflow logs, error output or command traces.

The target ingestion runtime is Cloudflare Workers + Queues, writing directly into the tenant's already-provisioned isolated D1.

The control plane stores only low-volume orchestration counters/status. Per-item URLs, source IDs, fingerprints, media origins and detailed sync state remain inside the tenant data plane and private queue processing.

Provider-specific parsing/fetch behavior is owned by `docs/PROVIDER-ENGINE.md`. The import pipeline resolves the provider from tenant-private source state and consumes normalized listing/detail evidence; central orchestration must not import a supplier-specific parser directly.

## Initial import lifecycle

After `data_plane` and `migrations` succeed, onboarding reaches `import`.

The platform cron discovers eligible tenants and creates a deterministic initial `tenant_import_jobs` row. If the private queue producer binding exists, it sends one small `scan` message containing only:

- queue contract version;
- opaque import ID;
- opaque tenant ID;
- source key.

The raw supplier URL, tenant D1 UUID, Workers for Platforms script name, credentials and provider tokens are never copied into the queue message.

The queue consumer resolves those values privately from the control plane when it handles the message, then resolves the registered provider adapter.

Target stages:

1. `scan` — provider adapter reads the connected supplier listing/source scopes, central orchestration persists private listing evidence/fingerprints in the tenant D1 and enqueues detail work;
2. `details` — provider adapter fetches one source item, central consumers validate normalized evidence, classify products, persist private media/source mappings and normalized product state;
3. `finalize` — verify counts/taxonomy/media/white-label invariants using provider leak signatures, publish normalized catalog metadata and mark the import successful;
4. advance onboarding to `classify`/`verify` only after the isolated tenant D1 passes its own checks.

The existing intelligent-sync semantics remain the model: full product detail fetch happens for the initial import, but later synchronization uses listing fingerprints and only reopens the delta/retry queue.

## Control-plane state

`tenant_import_jobs` records only job-level orchestration:

- import/tenant/source-key identity;
- initial/incremental/recovery mode;
- current phase and status;
- discovered/detail/failure/deferred counts;
- final published/classification counts;
- bounded attempts and safe error code;
- timestamps.

A unique active-job index prevents two simultaneous imports for the same tenant/source.

Do not add one control-plane row per supplier item. High-cardinality source state belongs in the provider-private source index inside the tenant D1. The v1 schema retains `supplier_album_index` naming for compatibility with the Yupoo launch adapter; provider neutrality is an orchestration/evidence contract and does not require a destructive table rename in M4.

## Queue contract

Queue messages are intentionally small and private-state-minimal:

- `scan`: import ID + tenant ID + source key;
- `detail`: the same IDs plus the raw provider item ID needed by the private consumer;
- `finalize`: import ID + tenant ID + source key.

The current queue field is named `albumSourceId` for v1 compatibility with the Yupoo launch adapter. It is private queue state, never a public API contract. A future queue-contract version may generalize that field when a second provider is implemented.

Raw provider IDs are allowed in the private detail queue because they are required to retrieve the corresponding private tenant-D1 row. They must never be returned by a public/admin API or written to public catalog artifacts.

## Backpressure and scale

The ingestion pipeline relies on queue batches for detail work instead of making the platform HTTP/admin request wait for thousands of supplier requests. The scanner only discovers and schedules work; detail consumers perform bounded per-item parsing and persistence.

This also isolates retries: one broken item can be retried/deferred without restarting a ~17k-product import.

## Current activation boundary

The repository contains the durable import job model, safe queue message contract, queue-dispatch scheduler, scan/detail/finalize consumers and the Provider Engine boundary with Yupoo as the first adapter.

Production Queue bindings/resources are still intentionally absent. `runDueTenantImportDispatches()` exits before reading control-plane D1 when `TENANT_IMPORT_QUEUE` is not bound, and dedicated ingestion entrypoints remain inert until their producer/consumer bindings are configured.

M5 activates this already-separated runtime deliberately: create scan/detail queues, bind producer/consumers, configure concurrency/retry/DLQ behavior and prove the complete two-tenant isolated import path before automatic customer ingestion is enabled.
