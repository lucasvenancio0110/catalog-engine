# M7D3 — Taxonomy Stage Integrity

Status: **Normative implementation detail under `TENANT-SYNC.md`**  
Scope: provider-neutral taxonomy identity normalization before private incremental staging.

## Contract

M7D3 private stage integrity compares expected taxonomy rows with rows actually persistible in `supplier_sync_stage_categories`.

The persistence identity is the normalized, trimmed category source identity represented by `category.id` or compatibility `category.categorySourceId`. Before delta/stage assembly, incremental orchestration must therefore:

- trim the category identity;
- drop categories with no persistible identity;
- collapse repeated observations of the same normalized identity deterministically;
- retain the first normalized category observation for that identity;
- pass the normalized taxonomy to the existing strict stage-count seal.

This normalization is provider-neutral. A provider adapter may already deduplicate its own output, but the central incremental boundary cannot depend on provider-specific uniqueness behavior for D1 integrity.

## Safety invariants

This rule does **not** relax `sync_stage_count_mismatch`.

It does not change:

- product observation counts;
- event counts or NEW/CHANGED/MOVED/RESTORED/MISSING/REMOVED semantics;
- safety/quarantine decisions;
- affected-detail selection;
- canonical LKG authority;
- verification or promotion authority;
- recurring-sync activation.

The stage seal continues to fail closed when persisted observations, events or normalized persistible categories disagree with the expected staged view.

## Production evidence requiring this rule

A retained M7D3 production canary failed safely with `sync_stage_count_mismatch`. Read-only trusted-main diagnosis proved:

- observations expected/stored: `1 / 1`;
- events expected/stored: `1 / 1`;
- foreign-key findings: `0`;
- mismatch dimension: `categories`.

The retained evidence remains diagnostic history; this contract does not authorize cleanup or promotion of that failed run.
