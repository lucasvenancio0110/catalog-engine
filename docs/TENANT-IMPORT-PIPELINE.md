# Isolated tenant import pipeline

## Decision

Customer supplier imports must not run through public GitHub Actions. A customer source URL is private tenant configuration and could leak through public workflow logs, error output or command traces.

The target ingestion runtime is Cloudflare Workers + Queues, writing directly into the tenant's already-provisioned isolated D1.

The control plane stores only low-volume orchestration counters/status. Per-album URLs, source IDs, fingerprints, media origins and detailed sync state remain inside the tenant data plane and private queue processing.

## Initial import lifecycle

After `data_plane` and `migrations` succeed, onboarding reaches `import`.

The platform cron discovers eligible tenants and creates a deterministic initial `tenant_import_jobs` row. If the private queue producer binding exists, it sends one small `scan` message containing only:

- queue contract version;
- opaque import ID;
- opaque tenant ID;
- source key.

The raw supplier URL, tenant D1 UUID, Workers for Platforms script name, credentials and provider tokens are never copied into the queue message.

The future queue consumer will resolve those values privately from the control plane when it handles the message.

Target stages:

1. `scan` — read the connected supplier root/category listing pages, persist private listing fingerprints in the tenant D1 and enqueue detail work;
2. `details` — process album detail messages in bounded queue batches, classify products, persist media source mappings and normalized product state;
3. `finalize` — verify counts/taxonomy/media/white-label invariants, publish normalized catalog metadata and mark the import successful;
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

Do not add one control-plane row per supplier album. High-cardinality source state belongs in `supplier_album_index` inside the tenant D1.

## Queue contract

Queue messages are intentionally small and private-state-minimal:

- `scan`: import ID + tenant ID + source key;
- `detail`: the same IDs plus the raw supplier album ID needed by the private consumer;
- `finalize`: import ID + tenant ID + source key.

Raw album IDs are allowed in the private detail queue because they are required to retrieve the corresponding private tenant-D1 row. They must never be returned by a public/admin API or written to public catalog artifacts.

## Backpressure and scale

The ingestion pipeline will rely on queue batches for album details instead of making the platform HTTP/admin request wait for thousands of supplier requests. The scanner only discovers and schedules work; detail consumers perform bounded per-album parsing and persistence.

This also isolates retries: one broken album can be retried/deferred without restarting a 17k-product import.

## Current activation boundary

The repository now contains the durable import job model, safe queue message contract and queue-dispatch scheduler. It does not yet configure a production Queue binding and therefore remains inert.

`runDueTenantImportDispatches()` exits before reading control-plane D1 when `TENANT_IMPORT_QUEUE` is not bound. This makes the code safe to merge before Cloudflare Queue resources are deliberately created.

Next implementation milestone: port the Yupoo listing scanner into a Worker-safe queue consumer, resolve tenant source/D1 context privately, persist the discovered listing index to the isolated D1, and enqueue bounded detail messages.
