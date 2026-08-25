# M7D7 — Promotion Authority Architecture Decision — 2026-08-25

Status: **Accepted architecture decision — implementation not yet Production Green**  
Roadmap owner: **M7D7 — Promotion Authority Primitive**  
Normative owner: `docs/TENANT-SYNC.md`  
Evidence baseline SHA: `581d73f27aa457be0b71685a38500bc3ff70615f`

## Decision

Catalog Engine V1 will use **one bounded set-based D1 transaction as the serving-authority switch** for M7D7.

The alternative **versioned/generation catalog with an atomic active-generation pointer** is explicitly rejected for V1 at the measured launch envelope.

The authority model is therefore:

```text
verified private candidate
→ verify promotion admission envelope + stale-base preconditions
→ one D1 batch transaction
   verified -> promoting
   + all canonical set-based mutations
   + promoting -> promoted
→ transaction commit = atomic serving-authority switch
```

No canonical catalog mutation may be split across independent batches and then exposed as serving truth. If the complete authority switch cannot fit in the admitted single transaction, promotion fails closed and the prior Last Known Good remains authoritative.

## Why this decision was required

M7D3–M7D6 intentionally assemble and verify a private candidate while canonical Last Known Good remains live. M7D7 must now establish the exact point where shoppers move from the old complete catalog to the new complete catalog without ever observing a mixed old/new view.

The roadmap required measured real-D1 evidence before selecting between:

1. one bounded set-based transaction; or
2. a generation/version model with one atomic active-generation pointer.

The decision was not made from local SQLite behavior alone.

## Real Cloudflare D1 evidence

Two trusted-main probes executed against uniquely named ephemeral Cloudflare D1 databases. They did not use a real tenant data plane, did not mutate the production/default catalog, produced no Queue messages, kept recurring Intelligent Sync disabled and deleted the probe database after completion.

### Evidence run 1

- integrated SHA: `49fb1550b0d922bc9ad4a60a22be235afb02c545`;
- workflow run: `32872632343`;
- job: `97883057258`;
- conclusion: **SUCCESS**;
- status: `catalog-engine/m7d7-d1-architecture-evidence=success`;
- quality: 108 test files / 535 tests + ESLint + dependency policy passed.

### Corrected independent evidence run 2

- integrated SHA: `581d73f27aa457be0b71685a38500bc3ff70615f`;
- workflow run: `32873067956`;
- job: `97884460496`;
- conclusion: **SUCCESS**;
- status: `catalog-engine/m7d7-d1-architecture-evidence-v2=success`;
- quality: 108 test files / 535 tests + ESLint + dependency policy passed;
- ephemeral D1 cleanup: **confirmed**.

The second run is the authoritative numeric record because it corrected a descriptive row-write estimate from the first run without changing the measured transaction behavior.

## Measured launch-envelope stress case

The probe intentionally modeled a full-catalog-scale authority switch rather than an ordinary small incremental delta:

```text
products = 20,000
media relationships = 40,000
product canonical upserts = 20,000
classification canonical upserts = 20,000
intelligence canonical upserts = 20,000
media deletes = 40,000
media inserts = 40,000
approximate modeled canonical row changes = 140,000
```

This is deliberately heavier than the normal M7 affected-only path. It is a measured V1 admission envelope, not a permanent commercial entitlement and not a claim that every future schema has exactly this row shape.

## Set-based transaction result

Corrected run 2 measured:

```text
set-based promotion wall time = 1,374.0 ms
D1 internal SQL duration = 436.537 ms
complete = true
rollback test = true
concurrent reader states valid = true
final revision = 2
products at new revision = 20,000
media at new revision = 40,000
classifications at new revision = 20,000
intelligence at new revision = 20,000
```

Five concurrent read attempts issued while the promotion was executing completed in approximately 1.245–1.346 seconds and each observed only the complete new revision. None observed a partially promoted canonical view.

The observed behavior is consistent with D1's per-database serialized execution boundary: readers may wait behind the write transaction, but the benchmark did not expose a mixed state.

## Transaction rollback result

A deliberately failing D1 batch performed:

```text
write value=2
→ invalid SQL statement
→ write value=3
```

The batch failed and the persisted value remained `1`. This proves the tested batch rolled back as one transaction rather than retaining the earlier successful statement.

## Generation/pointer comparison

The alternative model was also measured with a pre-materialized second generation.

Corrected run 2 measured:

```text
generation materialization wall time = 904.8 ms
generation materialization internal SQL = 319.756 ms
active-generation pointer flip wall time = 296.7 ms
active-generation pointer flip internal SQL = 0.235 ms
```

The pointer itself is extremely cheap inside D1. However, adopting it would require generation-scoped canonical storage, materialization of the complete next serving generation, storefront/query changes to resolve active generation, additional storage/write amplification, new migration/fleet complexity and a different cleanup/recovery model.

At the measured V1 envelope, that complexity does not buy enough product value to justify replacing the current private-stage → canonical-table architecture. The set-based transaction already completed far below the platform request/query time boundary while preserving old-or-new reader consistency in the real-D1 probe.

## Platform constraints incorporated into the decision

The implementation must preserve the current repository transport limits and Cloudflare D1 limits. In particular:

- one promotion batch must remain within the repository's maximum of 100 statements;
- no SQL statement may exceed 100 KB;
- no query may exceed 100 bound parameters;
- promotion SQL must therefore be set-based and must not send one bound parameter per catalog row;
- the complete transaction must remain safely below the D1 request/query execution ceiling;
- D1 is treated as single-threaded per database for concurrency planning, so a promotion may temporarily queue storefront reads rather than expose partial state.

## V1 promotion admission envelope

M7D7 implementation must fail closed before canonical mutation when the candidate exceeds the measured envelope:

```text
composed products <= 20,000
candidate/public media relationships <= 40,000
batch statements <= 100
statement SQL <= 100 KB
bound params/query <= 100
```

The 20k/40k limits are an **architecture safety envelope v1**, not a pricing/plan limit. A tenant above the envelope remains on its prior LKG and surfaces a stable private operational code such as `sync_promotion_envelope_exceeded` until the envelope is deliberately re-measured/versioned or a new architecture decision is accepted.

The implementation must also estimate/guard relationship work introduced by the real schema. If production-shaped promotion materially exceeds the benchmarked relation workload, M7D7 cannot be marked Production Green until the expanded shape is measured successfully.

## Exact authority semantics

### Verified-only entry

Promotion is eligible only when all of these are true for the exact tenant/source/run:

- incremental candidate stage is `verified`;
- verification code is `sync_candidate_verified_v1`;
- `verified_at` exists;
- safety outcome is `proceed`;
- zero blocking findings remain;
- candidate detail/CEI/merchandising relationships are closed and immutable for the verified run;
- tenant data-plane schema/capability supports the M7D7 primitive;
- the canonical source/LKG base still matches the authority state from which the candidate was planned.

A verified candidate built from a stale canonical base must fail closed. If the current schema cannot encode the stale-base CAS safely, M7D7 implementation may introduce only the minimal additive authority token/marker needed for that precondition; any such migration must be fleet-proven while inert. This decision does **not** authorize generation tables.

### One transaction

The complete canonical switch must occur in one D1 batch transaction:

1. compare-and-set the exact stage from `verified` to `promoting`;
2. apply every canonical product/taxonomy/membership/media/CEI/merchandising/source-index mutation required for the composed verified view using set-based SQL;
3. update the canonical sync/run ledger required by the same authority boundary;
4. compare-and-set that exact stage from `promoting` to `promoted`;
5. commit.

Every canonical statement must be gated by the same exact tenant/source/run identity and successful `promoting` ownership inside that transaction.

### Competing runs and idempotency

- the same promoted run replay is a no-op success/read-back, not a second authority switch;
- two verified candidates derived from the same old authority cannot both win;
- a candidate whose base authority changed loses the CAS and remains non-authoritative;
- cross-tenant/source/run mismatch fails closed;
- no browser/client-selected tenant or run identity may select promotion authority.

## Crash semantics

### Before D1 batch invocation

No canonical mutation occurred. Stage remains `verified`; prior LKG remains authoritative.

### During D1 batch or any statement failure

D1 transaction rollback restores the pre-batch state. Canonical LKG remains old and the stage does not become partially promoted. Retry may re-attempt the same verified run after the error is recorded safely.

### After D1 commit but before the caller receives/records success

The tenant data plane is already authoritative on the new canonical state and the stage is already `promoted`. Retry must detect the promoted run and must not replay the canonical switch.

This crash boundary is intentionally handed to M7D8: M7D8 will commit control-plane cursor/schedule/job metadata **after** it observes the durable promoted authority and will make that post-promotion metadata commit idempotent.

## Previous-LKG recovery boundary

M7D7 must not immediately delete verified/promoted candidate evidence or the audit information needed to identify the prior authority. A successful business-data promotion is not undone by merely rolling back application code.

Automatic recovery/replay closure belongs to M7D10. Until then:

- promoted stage evidence is retained through M7D8's cursor/schedule commit and the later recovery retention policy;
- failed promotion evidence is retained;
- global Queue purge is never a rollback mechanism;
- restoring a prior LKG requires an explicit audited recovery path, not ad-hoc reverse SQL.

## Rejected architecture for V1 — generation pointer

Generation/pointer is rejected now, not forbidden forever.

Revisit it only if measured evidence shows one or more of these conditions:

- catalog/product/media envelope materially exceeds 20k/40k;
- production-shaped set-based promotion approaches D1 execution/request limits or loses adequate safety margin;
- reader queueing during the atomic transaction materially violates storefront SLOs;
- full historical serving generations become a product/recovery requirement independent of sync;
- schema complexity makes one bounded transaction no longer auditable.

Any revisit requires a new versioned architecture decision and real-D1 measurement. It may never be introduced silently by chunking canonical writes.

## M7D7 implementation Definition of Done

The next implementation PR must prove, at minimum:

- one production-shaped promotion primitive only; no scheduler/cursor integration from M7D8;
- verified-only admission and stale-base CAS;
- the complete serving-authority mutation is one D1 transaction;
- unverified candidate is rejected;
- over-envelope candidate is rejected before canonical mutation;
- duplicate same-run replay is idempotent;
- competing verified runs produce exactly one authority winner;
- forced failure in the middle of the promotion rolls back every canonical mutation;
- readers observe old complete state or new complete state, never mixed;
- cross-tenant/source/run mismatch fails closed;
- private supplier URLs/raw provider IDs/evidence never enter public canonical projection;
- merchant override truth remains preserved;
- no cursor/schedule commit, removal activation or recurring-sync activation occurs;
- exact trusted-main production-shaped canary passes on an isolated tenant data plane.

M7D7 is not Production Green merely because this architecture decision is accepted.

## M7D8 handoff contract

M7D8 may call the M7D7 primitive only for an exact verified run. It owns:

```text
verified
→ M7D7 atomic canonical authority transaction
→ promoted
→ commit cursor/schedule/control metadata exactly once
```

Cursor and schedule authority must never advance before the D1 authority transaction commits. If the process crashes after promotion but before control-plane metadata commit, replay must recognize the durable `promoted` stage and complete only the remaining metadata work.

## Decision verdict

**Selected for Catalog Engine V1: bounded set-based D1 transaction.**

**Rejected for V1 at the measured envelope: generation/version + active pointer.**

**M7D7 architecture gate: COMPLETE.**

**M7D7 implementation/Production Green: PENDING.**
