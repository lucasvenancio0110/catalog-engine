# M7D4 — Staged Affected Detail

Status: **Normative implementation detail under `TENANT-SYNC.md`**  
Production state: **PRODUCTION GREEN — 2026-08-25**  
Scope: affected-detail fan-out, private candidate detail/media persistence and bounded retry before CEI candidate processing.

## Bounded outcome

M7D4 extends a healthy M7D3 run from:

```text
private listing stage = details_pending
```

to:

```text
needs_detail events
→ existing detail Queue
→ Provider Engine fetchDetail
→ run-scoped candidate detail/media writes
→ details_complete when every expected detail is complete
```

Only stage events with `needs_detail=1` are eligible. Pure MOVED, MISSING and REMOVED events do not receive detail fetches merely because the run is incremental.

## Queue and provider reuse

M7D4 does not introduce a second detail queue, provider parser or supplier-specific central consumer.

The scan consumer reuses `TENANT_IMPORT_DETAIL_QUEUE` and the existing public-safe detail message contract. Messages contain only opaque tenant/import/source/item identities; source URLs remain in the isolated tenant data plane.

The detail entrypoint deterministically preserves the initial-import route and sends non-initial detail work through the incremental candidate consumer. The incremental consumer resolves the provider from tenant-private source state and calls the shared Provider Engine `fetchDetail` contract.

## Tenant-dispatch identity boundary

All incremental data-plane access remains server-resolved. The trusted control-plane context supplies the exact `tenant_id`; Queue payloads and browser input never select a D1 database or Workers for Platforms script.

Some M7D4 queries are intentionally run-scoped and therefore may contain only opaque `run_id`/product identities in their SQL parameters. The shared data-plane query adapter may accept an explicit tenant identity only from the already resolved server context for these batches. If an explicit identity conflicts with any tenant identity present in the batch parameters, the request fails closed before dispatch.

M7D4 must not fall back to direct D1 REST merely because a run-scoped batch does not contain a tenant-shaped parameter. Production tenant data-plane access continues through `TENANT_DISPATCH`.

## Resumable affected-detail fan-out

The control-plane import job uses the existing:

- `discovered_count`;
- `detail_enqueue_cursor`;
- `queued_detail_count`;
- scan lease.

For incremental work, `discovered_count` is the number of staged events requiring detail, not the total listing size.

Fan-out reads only `supplier_sync_stage_events` where `needs_detail=1`, ordered deterministically by private album identity. The read is constrained by the exact run/tenant/source identity. The cursor advances only after `sendBatch` succeeds.

If Queue send succeeds but the cursor update is interrupted, retry may produce a duplicate message. Duplicate delivery is safe because candidate detail claiming/writing is run-scoped and idempotent.

If fan-out fails before completion, the control job is returned to retryable scan-phase ownership while retaining the private stage and cursor. A later dispatcher retry detects the existing `details_pending` stage and resumes from the saved cursor without re-running the provider listing scan.

## Candidate claim and retry contract

Affected detail rows live in `supplier_sync_stage_product_details` and are owned by the exact `run_id`.

A candidate detail claim:

- requires the matching staged observation and staged event;
- requires `needs_detail=1`;
- requires a healthy `details_pending` run with safety outcome `proceed`;
- uses an opaque claim token and bounded lease;
- increments `attempt_count` only when the claim is acquired;
- permits reclaim after lease expiry;
- permits replay from `pending` or retryable `failed` state;
- stops after four attempts.

Persistent provider/detail failure leaves durable private failed evidence. Retry exhaustion is acknowledged by the Queue as deferred rather than creating an infinite retry loop. The unresolved incremental job remains failed and therefore continues to block later sync for that tenant/source until a later recovery slice owns replay semantics.

A deterministic provider result identifying the item as a non-product is terminal for this candidate run; M7D4 does not convert that observation into deletion or canonical mutation.

## Private candidate writes

A successful affected detail fetch may write only run-scoped candidate structures needed to represent the pre-CEI product detail:

- `supplier_sync_stage_catalog_categories`;
- `supplier_sync_stage_media_sources`;
- `supplier_sync_stage_product_details`;
- `supplier_sync_stage_product_media`;
- `supplier_sync_stage_product_categories`.

The normalized provider evidence document is private, JSON-valid and bounded to the schema-v6 candidate evidence limit.

M7D4 deliberately leaves candidate team/league/facet classification, CEI classification state, CEI intelligence state and merchandising metadata to M7D5 and later slices.

## Completion boundary

The stage may transition from `details_pending` to `details_complete` only when:

```text
COUNT(candidate detail rows where detail_state='complete')
=
expected_detail_count
```

Retryable or exhausted failures do not satisfy this gate.

`details_complete` is still private candidate state. It is not verification and not publication authority.

## Non-goals and invariants

M7D4 must not:

- mutate `supplier_album_index`;
- mutate canonical `catalog_products`, `media_sources` or public merchandising tables;
- update canonical detail fingerprints;
- run affected-only CEI;
- write candidate CEI classification/intelligence state;
- mark the candidate verified;
- promote candidate rows into canonical LKG;
- advance the recurring sync cursor/schedule;
- activate repeated-miss deletion;
- enable `TENANT_SYNC_AUTOMATION_ENABLED`.

Canonical LKG and storefront readers remain authoritative and unchanged throughout M7D4.

## Production proof required

M7D4 is not Production Green merely because code/tests merge.

The trusted-main proof must demonstrate, on the exact deployed/activated SHA:

1. scheduler/dispatcher-owned incremental scan reaches `details_pending` without manual Queue injection;
2. only the affected detail event is queued;
3. the real detail consumer fetches through Provider Engine and creates a complete candidate detail/media tree;
4. stage reaches `details_complete`;
5. candidate counts/media relationships are internally consistent;
6. canonical LKG/storefront remain unchanged;
7. Queue/DLQ backlogs return clean;
8. recurring Intelligent Sync remains disabled.

Only after that evidence may the roadmap/current state call M7D4 **PRODUCTION GREEN** and advance M7D5.

## Production closure — 2026-08-25

The required proof is complete on final trusted-main SHA:

`95d3f3ba76adf5638576b212ccd5c94113e0eaa5`

Evidence:

- Queue consumer activation run `32839467856` = **SUCCESS**;
- application deploy run `32839467904` = **SUCCESS**;
- scheduler/dispatcher-owned affected-detail canary run `32839544016`, job `97775777786` = **SUCCESS**;
- canary reached `details_complete` with one complete candidate detail/evidence record and two candidate media relationships;
- foreign-key findings were `0`;
- no manual Queue message was produced;
- canonical LKG and storefront remained unchanged;
- Queue/DLQ backlogs returned clean;
- recurring Intelligent Sync remained disabled.

The retained failure, root cause and exact closure evidence are recorded in `M7D4-CLOSURE-2026-08-25.md`.

**M7D4 is PRODUCTION GREEN. M7D5 is the next approved slice.**
