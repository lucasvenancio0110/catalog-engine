# Isolated tenant import pipeline

Status: **Normative implementation contract**  
Scope: private tenant source ingestion, Queue orchestration, tenant-D1 persistence and transition into CEI/classification.

## Decision

Customer supplier imports must not run through public GitHub Actions.

A customer source locator is private tenant configuration and could leak through public workflow logs, command traces or error output.

The production tenant-ingestion runtime is Cloudflare Workers + Queues, writing into the tenant's already-provisioned isolated D1.

The control plane stores only low-volume orchestration counters/status. Per-item source locators, raw provider IDs, fingerprints, media origins and detailed sync state remain inside the tenant data plane and private Queue processing.

Provider-specific parsing/fetch behavior is owned by `PROVIDER-ENGINE.md`. Central orchestration resolves a provider contract and consumes normalized listing/detail evidence instead of importing supplier-specific parsers directly.

## Initial import lifecycle

After `data_plane` and `migrations` succeed, onboarding reaches `import`.

With automatic import enabled, the platform cron discovers eligible tenants and creates a deterministic initial `tenant_import_jobs` row. The scan Queue message contains only minimal private orchestration identity:

- queue contract version;
- opaque import ID;
- opaque tenant ID;
- source key.

It does not contain:

- raw supplier URL;
- tenant D1 UUID;
- tenant Worker script name;
- credentials;
- provider tokens.

The Queue consumer resolves private runtime/source state server-side and then resolves the registered provider adapter.

## Stages

### 1. Scan

The provider adapter reads the connected source/scopes and returns normalized listing evidence.

Central ingestion persists private listing/index/fingerprint state in the tenant D1 and schedules detail work.

### 2. Details

The provider adapter fetches one source item.

Central consumers validate normalized provider evidence and persist source-private detail/media state plus normalized catalog data.

Provider-level product checks are not the final CEI merchandising decision.

### 3. Finalize

The finalize barrier confirms terminal detail counts and validates catalog/media/white-label invariants using provider leak signatures.

It publishes safe catalog metadata and marks the import successful.

### 4. CEI / classify

Import success advances onboarding to a separate versioned CEI/classification checkpoint.

The classifier consumes evidence already present in the tenant data plane rather than re-fetching every supplier detail page.

Current M6 behavior then persists versioned classification state, durable merchant overrides and, on schema v4+, detailed domain-neutral CEI intelligence state.

### 5. Verify

Verification is a separate hard integrity gate before preview/domain/publication progression.

Import completion alone is not permission to publish a tenant storefront.

## Control-plane state

`tenant_import_jobs` contains job-level orchestration only, such as:

- import/tenant/source-key identity;
- initial/incremental/recovery mode;
- current phase/status;
- discovered/detail/failure/deferred counts;
- published/classification summary counts;
- bounded attempts and safe error code;
- timestamps.

Do not add one control-plane row per supplier item. High-cardinality source state belongs in the tenant data plane.

The current private schema retains some Yupoo-era names such as `supplier_album_index` for compatibility. Provider neutrality is enforced at the orchestration/evidence boundary and does not require destructive renaming merely for aesthetics.

## Queue contract

Queue messages are intentionally small:

- `scan`: import ID + tenant ID + source key;
- `detail`: same IDs plus the private provider item ID required by the consumer;
- `finalize`: import ID + tenant ID + source key.

The current private detail field `albumSourceId` is a v1 compatibility name. It is not a public API contract.

Raw provider item IDs can exist in private detail Queue messages when required to locate the corresponding private tenant-D1 record. They must not be exposed through public/admin catalog APIs.

## Backpressure and scale

Detail work is Queue-based rather than tying thousands of supplier requests to one HTTP/admin request.

This allows:

- bounded upstream pressure;
- independent item retries;
- deferred broken items;
- recovery without restarting an entire large catalog;
- tenant-level failure containment.

Initial import can fetch full details. Routine synchronization later uses private listing fingerprints and reopens only delta/retry work according to the intelligent-sync contract.

## Production activation state

M5 Queue activation is **complete and production-proven**.

Confirmed production topology includes:

- scan Queue;
- detail Queue;
- scan DLQ;
- detail DLQ;
- dedicated scan consumer;
- dedicated detail/finalize consumer;
- main Worker producer bindings;
- cron discovery every five minutes;
- `TENANT_IMPORT_AUTOMATION_ENABLED="1"` at the M5 closure checkpoint.

The final scheduler-driven canary proved that a fresh isolated tenant can be discovered by cron and complete the Queue import path with **zero manually produced initial Queue messages** while preserving default-catalog state and clean Queue/DLQ backlogs.

`CURRENT-STATE.md` and `M5-CLOSURE-2026-08-20.md` own the current/historical evidence details.

Do not regress the activation model back to one GitHub Action or manual Cloudflare operation per customer.

## Fail-closed behavior

Import orchestration must fail closed when required trust/runtime boundaries are unavailable, including cases such as:

- control-plane D1 missing;
- required Queue producer/runtime bindings missing;
- tenant/source/data-plane state not ready;
- unsupported provider;
- tenant dispatch identity mismatch;
- malformed normalized provider evidence.

Disabling automatic discovery is a reversible operational rollback lever and must not delete tenant data or Queue resources.

## Retry and recovery

One failed item should not restart a large import.

Queue delivery retries and durable application retry/deferred state are separate mechanisms.

DLQ messages are operational evidence and remain minimal. Do not copy source URLs or credentials into DLQs for convenience.

Recovery should preserve durable import state, repair the underlying cause and replay through the controlled path.

Global Queue purges are not a normal smoke/recovery technique.

## Privacy

Supplier URLs, credentials, private provider IDs, media origins and tenant runtime locators remain private.

Public catalog output uses Catalog Engine opaque identities and safe text/media boundaries.

Provider/source taxonomy is evidence for CEI and synchronization. It is not automatic public merchandising truth.

## Relationship to CEI

The import pipeline owns safe evidence acquisition and persistence.

CEI owns commercial/domain understanding after normalized evidence exists.

The boundary is intentionally:

```text
provider source
-> normalized private evidence
-> tenant import persistence
-> CEI/classification
-> verification
-> merchandising/public readiness
```

Adding another provider must not require changing CEI classification semantics merely to understand that provider's DOM/URL format.

## Final decision rule

For every import change ask:

> Does this keep private source details out of public/control-plane high-cardinality state, preserve Queue/backpressure/isolation behavior, and hand CEI normalized evidence instead of provider-specific objects?

If not, the change is incomplete.
