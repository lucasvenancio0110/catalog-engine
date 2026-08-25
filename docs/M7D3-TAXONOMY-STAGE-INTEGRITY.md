# M7D3 — Taxonomy Stage Integrity

Status: **Normative implementation detail under `TENANT-SYNC.md`**  
Scope: provider-neutral taxonomy identity normalization and D1-safe private-stage count sealing.

## Contract

M7D3 private stage integrity compares expected taxonomy rows with rows actually persistible in `supplier_sync_stage_categories`.

The persistence identity is the normalized, trimmed category source identity represented by `category.id` or compatibility `category.categorySourceId`. Before delta/stage assembly, incremental orchestration therefore:

- trims the category identity;
- drops categories with no persistible identity;
- collapses repeated observations of the same normalized identity deterministically;
- retains the first normalized category observation for that identity;
- passes the normalized taxonomy to the existing strict stage-count seal.

This normalization is provider-neutral. A provider adapter may already deduplicate its own output, but the central incremental boundary cannot depend on provider-specific uniqueness behavior for D1 integrity.

## D1 parameter-affinity requirement

The production `queryD1Batch` boundary serializes non-null query parameters to strings before calling the Cloudflare D1 HTTP API. Count comparisons that use a bound parameter must therefore establish the intended numeric affinity explicitly.

The M7D3 category seal compares SQLite `COUNT(*)` with the expected taxonomy count. That comparison must use:

```sql
COUNT(*) = CAST(? AS INTEGER)
```

rather than relying on a raw bound parameter retaining its JavaScript numeric type.

Observation and event seal checks compare persisted integer columns to `COUNT(*)` and are not affected by this parameter boundary.

## Safety invariants

These rules do **not** relax `sync_stage_count_mismatch`.

They do not change:

- product observation counts;
- event counts or NEW/CHANGED/MOVED/RESTORED/MISSING/REMOVED semantics;
- safety/quarantine decisions;
- affected-detail selection;
- canonical LKG authority;
- verification or promotion authority;
- recurring-sync activation.

The stage seal continues to fail closed when persisted observations, events or normalized persistible categories disagree with the expected staged view.

## Production evidence and root cause

Two retained M7D3 production canaries failed safely with `sync_stage_count_mismatch`. Trusted-main read-only diagnosis of both fixtures proved the same shape:

- observations expected/stored: `1 / 1`;
- events expected/stored: `1 / 1`;
- staged categories: `1`;
- foreign-key findings: `0`;
- safety outcome: `proceed`;
- mismatch dimension isolated to the category comparison.

The first taxonomy-normalization hotfix preserved a useful provider-neutral invariant but did not resolve the live failure. Code-level revalidation then proved the remaining mismatch was caused by the Cloudflare D1 parameter boundary stringifying the expected category count while the seal compared it directly with integer `COUNT(*)`.

A regression test must execute the generated seal query with parameters transformed exactly like production `queryD1Batch` and prove the healthy stage reaches `details_pending` rather than `failed`.

Retained failed-canary evidence remains diagnostic history; this contract does not authorize cleanup or promotion of those failed runs.
