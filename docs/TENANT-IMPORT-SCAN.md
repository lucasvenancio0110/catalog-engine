# Tenant import listing scan

## Runtime separation

Initial merchant imports use separate queue roles:

- the platform Worker only discovers eligible imports and sends a small `scan` message to the scan queue;
- a dedicated ingestion Worker runs the expensive Yupoo listing/taxonomy crawl;
- that scan Worker writes private listing state directly into the tenant's isolated D1;
- it fans out one `detail` message per album to a separate detail queue;
- the future detail Worker can scale independently from the low-concurrency scan Worker.

The scan Worker is intentionally a separate entrypoint (`worker/import-scan-entry.js`) so Cheerio/PQueue crawling code does not inflate or complicate the storefront/control-plane Worker bundle.

## Complete initial scan

The initial scan is deletion-safe because it is authoritative for an empty/new tenant data plane. It supports:

- full `/albums/` catalog roots, including provider category evidence;
- a single connected `/categories/<id>` source without crawling unrelated supplier categories;
- bounded page limits;
- bounded category concurrency;
- bounded retry for transient 429/5xx/timeouts;
- same-host redirect enforcement so supplier redirects cannot escape the configured Yupoo host;
- a maximum HTML response size.

The scanner reads only listing/category pages. It never opens product album detail pages during this stage.

For every discovered album it derives:

- raw album ID and album URL (private tenant D1 only);
- stable public product ID;
- title, cover/listing evidence and image-count hint;
- deepest deterministic source-category evidence/path;
- listing fingerprint.

The source category remains private evidence, not the public store taxonomy.

## Isolated D1 persistence

The scan consumer resolves the tenant's private source and D1 UUID from the control plane only after receiving the opaque scan message. It then writes `supplier_album_index` through the Cloudflare D1 Query API in bounded batches.

A new initial scan clears only that tenant/source index before writing the complete authoritative listing. It never touches another tenant D1.

## Resume-safe detail fan-out

A large supplier can produce many thousands of detail messages. The scan consumer therefore persists a deterministic `detail_enqueue_cursor` in `tenant_import_jobs`.

Flow:

1. complete and persist the listing scan;
2. mark `scan_completed_at` and switch job phase to `details`;
3. read the isolated index in stable `album_source_id` order, 100 at a time;
4. send that chunk to the dedicated detail queue;
5. atomically advance the control-plane cursor only after the queue accepts the batch;
6. renew the scan lease;
7. continue from the stored cursor after interruption;
8. mark status `details` only after the cursor equals the discovered count.

This avoids either silently skipping a batch or needing to rerun the supplier listing scan after every queue interruption.

The scan lease prevents two duplicate queue deliveries from performing the same large fan-out concurrently. A busy duplicate is retried later instead of clearing another execution's lease.

## Queue activation boundary

This code does **not** configure a production scan consumer or detail queue yet.

The scan handler fails before reading tenant/control-plane state unless a `TENANT_IMPORT_DETAIL_QUEUE` producer binding is present. The dedicated scan Worker must not be deployed until both scan and detail queue resources exist.

Recommended activation sequence:

1. implement and test the idempotent detail consumer;
2. create separate scan and detail queues;
3. bind the platform producer to the scan queue;
4. bind the dedicated scan consumer and its detail producer;
5. bind the detail consumer with higher concurrency;
6. run one isolated test tenant before enabling automatic import discovery.
