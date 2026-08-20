# Tenant import listing scan

## Runtime separation

Initial merchant imports use separate queue roles:

- the platform Worker only discovers eligible imports and sends a small `scan` message to the scan queue;
- a dedicated ingestion Worker resolves the tenant-private provider and runs that adapter's listing/source crawl;
- the scan Worker writes private listing state directly into the tenant's isolated D1;
- it fans out one `detail` message per discovered source item to a separate detail queue;
- the detail Worker can scale independently from the low-concurrency scan Worker.

The scan Worker is intentionally a separate entrypoint (`worker/import-scan-entry.js`) so Cheerio/PQueue/provider crawling code does not inflate or complicate the storefront/control-plane Worker bundle.

The v1 provider is Yupoo. Its implementation remains under `worker/ingestion/yupoo-listing.js` and is reached only through the Provider Engine registry from central orchestration.

## Complete initial scan

A provider scan must be authoritative/complete before central orchestration treats it as an initial listing index. The Yupoo launch adapter currently supports:

- full `/albums/` catalog roots, including provider category evidence;
- a single connected `/categories/<id>` source without crawling unrelated supplier categories;
- bounded page limits;
- bounded category concurrency;
- bounded retry for transient 429/5xx/timeouts;
- same-host redirect enforcement so supplier redirects cannot escape the configured Yupoo host;
- a maximum HTML response size.

The provider scanner reads only listing/source-scope pages. It does not open product detail pages during this stage.

The normalized scan evidence for every discovered item includes at minimum:

- raw provider item ID and private source URL;
- stable opaque public product ID;
- listing fingerprint.

The Yupoo adapter additionally derives title, cover/listing evidence, image-count hint and deepest deterministic source-category evidence/path.

Source category remains private evidence, not the public store taxonomy.

## Isolated D1 persistence

The scan consumer resolves the tenant's private source, provider and D1 UUID from the control plane only after receiving the opaque scan message. It resolves the registered ingestion provider, validates its normalized scan result and writes the source index through the Cloudflare D1 Query API in bounded batches.

A new initial scan clears only that tenant/source index before writing the complete authoritative listing. It never touches another tenant D1.

The current private table names (`supplier_album_index`, `supplier_category_index`) are retained for schema/ID compatibility during M4 even though orchestration is provider-neutral. A second provider does not justify a destructive rename by itself; schema generalization can happen through a deliberate migration when required.

## Resume-safe detail fan-out

A large supplier can produce many thousands of detail messages. The scan consumer therefore persists a deterministic `detail_enqueue_cursor` in `tenant_import_jobs`.

Flow:

1. complete provider scan and validate normalized evidence;
2. persist the listing index;
3. mark `scan_completed_at` and switch job phase to `details`;
4. read the isolated index in stable source-ID order, 100 at a time;
5. send that chunk to the dedicated detail queue;
6. atomically advance the control-plane cursor only after the queue accepts the batch;
7. renew the scan lease;
8. continue from the stored cursor after interruption;
9. mark status `details` only after the cursor equals the discovered count.

This avoids either silently skipping a batch or needing to rerun the supplier listing scan after every queue interruption.

The scan lease prevents two duplicate queue deliveries from performing the same large fan-out concurrently. A busy duplicate is retried later instead of clearing another execution's lease.

## Provider boundary

Central `scan-consumer.js` must not import `yupoo-listing.js` or any future provider parser directly.

It may depend on:

- the shared provider evidence contract;
- provider registry resolution;
- provider-neutral persistence/fan-out behavior.

Provider-specific transport/DOM parsing/fingerprinting belongs behind the adapter.

## Queue activation boundary

The code does **not** configure a production scan consumer or detail queue yet.

The scan handler fails before reading tenant/control-plane state unless a `TENANT_IMPORT_DETAIL_QUEUE` producer binding is present. The dedicated scan Worker must not be deployed until scan/detail queue resources and recovery behavior are deliberately configured.

M5 activation sequence:

1. create separate scan and detail queues plus DLQ/recovery policy;
2. bind the platform producer to the scan queue;
3. bind the dedicated scan consumer and its detail producer;
4. bind the detail consumer with controlled concurrency/retry;
5. prove one isolated test tenant;
6. prove two simultaneous tenants cannot cross D1/source state;
7. only then enable automatic import discovery.
