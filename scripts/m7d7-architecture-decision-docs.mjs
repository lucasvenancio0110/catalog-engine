import { readFile, writeFile, unlink } from 'node:fs/promises';

function replaceExact(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`m7d7_docs_missing_${label}`);
  if (source.split(before).length !== 2) throw new Error(`m7d7_docs_ambiguous_${label}`);
  return source.replace(before, after);
}

function replaceSection(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`m7d7_docs_section_${label}_missing`);
  return `${source.slice(0, start)}${replacement.trimEnd()}\n\n${source.slice(end)}`;
}

const adr = `# M7D7 — Promotion Authority Architecture Decision — 2026-08-25

Status: **Accepted architecture decision — implementation not yet Production Green**  
Roadmap owner: **M7D7 — Promotion Authority Primitive**  
Normative owner: \`docs/TENANT-SYNC.md\`  
Evidence baseline SHA: \`581d73f27aa457be0b71685a38500bc3ff70615f\`

## Decision

Catalog Engine V1 will use **one bounded set-based D1 transaction as the serving-authority switch** for M7D7.

The alternative **versioned/generation catalog with an atomic active-generation pointer** is explicitly rejected for V1 at the measured launch envelope.

The authority model is therefore:

\`\`\`text
verified private candidate
→ verify promotion admission envelope + stale-base preconditions
→ one D1 batch transaction
   verified -> promoting
   + all canonical set-based mutations
   + promoting -> promoted
→ transaction commit = atomic serving-authority switch
\`\`\`

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

- integrated SHA: \`49fb1550b0d922bc9ad4a60a22be235afb02c545\`;
- workflow run: \`32872632343\`;
- job: \`97883057258\`;
- conclusion: **SUCCESS**;
- status: \`catalog-engine/m7d7-d1-architecture-evidence=success\`;
- quality: 108 test files / 535 tests + ESLint + dependency policy passed.

### Corrected independent evidence run 2

- integrated SHA: \`581d73f27aa457be0b71685a38500bc3ff70615f\`;
- workflow run: \`32873067956\`;
- job: \`97884460496\`;
- conclusion: **SUCCESS**;
- status: \`catalog-engine/m7d7-d1-architecture-evidence-v2=success\`;
- quality: 108 test files / 535 tests + ESLint + dependency policy passed;
- ephemeral D1 cleanup: **confirmed**.

The second run is the authoritative numeric record because it corrected a descriptive row-write estimate from the first run without changing the measured transaction behavior.

## Measured launch-envelope stress case

The probe intentionally modeled a full-catalog-scale authority switch rather than an ordinary small incremental delta:

\`\`\`text
products = 20,000
media relationships = 40,000
product canonical upserts = 20,000
classification canonical upserts = 20,000
intelligence canonical upserts = 20,000
media deletes = 40,000
media inserts = 40,000
approximate modeled canonical row changes = 140,000
\`\`\`

This is deliberately heavier than the normal M7 affected-only path. It is a measured V1 admission envelope, not a permanent commercial entitlement and not a claim that every future schema has exactly this row shape.

## Set-based transaction result

Corrected run 2 measured:

\`\`\`text
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
\`\`\`

Five concurrent read attempts issued while the promotion was executing completed in approximately 1.245–1.346 seconds and each observed only the complete new revision. None observed a partially promoted canonical view.

The observed behavior is consistent with D1's per-database serialized execution boundary: readers may wait behind the write transaction, but the benchmark did not expose a mixed state.

## Transaction rollback result

A deliberately failing D1 batch performed:

\`\`\`text
write value=2
→ invalid SQL statement
→ write value=3
\`\`\`

The batch failed and the persisted value remained \`1\`. This proves the tested batch rolled back as one transaction rather than retaining the earlier successful statement.

## Generation/pointer comparison

The alternative model was also measured with a pre-materialized second generation.

Corrected run 2 measured:

\`\`\`text
generation materialization wall time = 904.8 ms
generation materialization internal SQL = 319.756 ms
active-generation pointer flip wall time = 296.7 ms
active-generation pointer flip internal SQL = 0.235 ms
\`\`\`

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

\`\`\`text
composed products <= 20,000
candidate/public media relationships <= 40,000
batch statements <= 100
statement SQL <= 100 KB
bound params/query <= 100
\`\`\`

The 20k/40k limits are an **architecture safety envelope v1**, not a pricing/plan limit. A tenant above the envelope remains on its prior LKG and surfaces a stable private operational code such as \`sync_promotion_envelope_exceeded\` until the envelope is deliberately re-measured/versioned or a new architecture decision is accepted.

The implementation must also estimate/guard relationship work introduced by the real schema. If production-shaped promotion materially exceeds the benchmarked relation workload, M7D7 cannot be marked Production Green until the expanded shape is measured successfully.

## Exact authority semantics

### Verified-only entry

Promotion is eligible only when all of these are true for the exact tenant/source/run:

- incremental candidate stage is \`verified\`;
- verification code is \`sync_candidate_verified_v1\`;
- \`verified_at\` exists;
- safety outcome is \`proceed\`;
- zero blocking findings remain;
- candidate detail/CEI/merchandising relationships are closed and immutable for the verified run;
- tenant data-plane schema/capability supports the M7D7 primitive;
- the canonical source/LKG base still matches the authority state from which the candidate was planned.

A verified candidate built from a stale canonical base must fail closed. If the current schema cannot encode the stale-base CAS safely, M7D7 implementation may introduce only the minimal additive authority token/marker needed for that precondition; any such migration must be fleet-proven while inert. This decision does **not** authorize generation tables.

### One transaction

The complete canonical switch must occur in one D1 batch transaction:

1. compare-and-set the exact stage from \`verified\` to \`promoting\`;
2. apply every canonical product/taxonomy/membership/media/CEI/merchandising/source-index mutation required for the composed verified view using set-based SQL;
3. update the canonical sync/run ledger required by the same authority boundary;
4. compare-and-set that exact stage from \`promoting\` to \`promoted\`;
5. commit.

Every canonical statement must be gated by the same exact tenant/source/run identity and successful \`promoting\` ownership inside that transaction.

### Competing runs and idempotency

- the same promoted run replay is a no-op success/read-back, not a second authority switch;
- two verified candidates derived from the same old authority cannot both win;
- a candidate whose base authority changed loses the CAS and remains non-authoritative;
- cross-tenant/source/run mismatch fails closed;
- no browser/client-selected tenant or run identity may select promotion authority.

## Crash semantics

### Before D1 batch invocation

No canonical mutation occurred. Stage remains \`verified\`; prior LKG remains authoritative.

### During D1 batch or any statement failure

D1 transaction rollback restores the pre-batch state. Canonical LKG remains old and the stage does not become partially promoted. Retry may re-attempt the same verified run after the error is recorded safely.

### After D1 commit but before the caller receives/records success

The tenant data plane is already authoritative on the new canonical state and the stage is already \`promoted\`. Retry must detect the promoted run and must not replay the canonical switch.

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

\`\`\`text
verified
→ M7D7 atomic canonical authority transaction
→ promoted
→ commit cursor/schedule/control metadata exactly once
\`\`\`

Cursor and schedule authority must never advance before the D1 authority transaction commits. If the process crashes after promotion but before control-plane metadata commit, replay must recognize the durable \`promoted\` stage and complete only the remaining metadata work.

## Decision verdict

**Selected for Catalog Engine V1: bounded set-based D1 transaction.**

**Rejected for V1 at the measured envelope: generation/version + active pointer.**

**M7D7 architecture gate: COMPLETE.**

**M7D7 implementation/Production Green: PENDING.**
`;

await writeFile('docs/M7D7-PROMOTION-AUTHORITY-DECISION-2026-08-25.md', adr);

let tenantSync = await readFile('docs/TENANT-SYNC.md', 'utf8');
const tenantSyncReplacement = `### M7D7 — Promotion Authority Primitive

Commercial outcome: shoppers see the old verified catalog or the new verified catalog, never a half-updated mixture.

Architecture decision: **ACCEPTED — bounded set-based D1 transaction**. Real Cloudflare D1 evidence and the complete decision record live in \`M7D7-PROMOTION-AUTHORITY-DECISION-2026-08-25.md\`. The generation/version + active-pointer alternative is rejected for V1 at the measured launch envelope.

The serving-authority switch is the commit of one D1 batch transaction:

\`\`\`text
verified private candidate
→ promotion-envelope + stale-base admission
→ one D1 transaction
   verified -> promoting
   + all canonical set-based mutations
   + promoting -> promoted
→ transaction commit = authority switch
\`\`\`

Required contract:

- only an exact candidate in \`verified\` with \`sync_candidate_verified_v1\`, \`verified_at\`, safety \`proceed\` and zero blocking findings may enter;
- candidate verification must be immutable for the promotion attempt;
- the canonical LKG/source authority must still match the base from which the candidate was planned; a stale verified candidate fails closed;
- the first statement CASes that exact stage \`verified -> promoting\` and every canonical mutation is SQL-gated by the same exact tenant/source/run ownership;
- **all** canonical product, taxonomy, membership, media, CEI/intelligence, merchandising, source-index and same-boundary run-ledger mutations required for serving consistency occur in that same D1 transaction;
- the final in-transaction stage transition is \`promoting -> promoted\`;
- no independent canonical chunk may become serving truth before commit;
- any statement error rolls the whole transaction back so the prior LKG remains authoritative;
- replay after a successful commit recognizes the same run as already \`promoted\` and does not repeat the switch;
- competing verified candidates cannot both promote from the same base authority;
- cross-tenant/source/run mismatch fails closed;
- no browser/client-selected identity can choose promotion authority.

Measured V1 admission envelope:

\`\`\`text
composed products <= 20,000
candidate/public media relationships <= 40,000
batch statements <= 100
SQL statement <= 100 KB
bound params/query <= 100
\`\`\`

This is an architecture safety envelope, not a commercial-plan limit. Above-envelope work fails closed before canonical mutation with a stable private operational code and remains on prior LKG until the envelope is deliberately re-measured/versioned. The implementation must use set-based joins rather than per-product bound parameters and must prove the real production-shaped relationship workload stays safely inside the measured D1 boundary.

Trusted-main D1 evidence run \`32873067956\` / job \`97884460496\` on SHA \`581d73f27aa457be0b71685a38500bc3ff70615f\` modeled 20,000 products, 40,000 media relationships and about 140,000 canonical row changes. The single transaction completed in 1,374.0 ms wall / 436.537 ms internal SQL, rolled back completely under a forced middle-statement failure, and five concurrent readers observed only the complete post-commit revision after queueing behind the write. The ephemeral probe D1 was deleted and production catalog mutation remained false.

The generation-pointer alternative measured a 0.235 ms internal pointer update, but requires full generation materialization, generation-scoped serving queries, storage/write amplification and a larger fleet/schema migration. It is therefore not selected for V1. Reconsideration requires a new versioned decision if the measured catalog envelope grows materially, the set-based transaction approaches D1 limits, reader queueing violates storefront SLOs or historical generations become an independent requirement.

Crash contract:

- before batch invocation: stage remains verified, old LKG serves;
- during batch or statement failure: transaction rollback, old LKG serves, no partial promotion;
- after commit but before caller acknowledgement: stage is durably promoted and new canonical state serves; replay recognizes the promoted run;
- cursor/schedule/control-plane commit remains **M7D8**, strictly after durable promotion;
- promoted/failed evidence is retained for recovery; automatic recovery/replay closure remains **M7D10**.

M7D7 implementation remains a separate claim. The accepted architecture does not itself make M7D7 Production Green. The implementation must add production-shaped regression/canary proof for verified-only entry, stale-base/competing-run CAS, rollback, old-or-new reader consistency, over-envelope rejection, idempotent replay, tenant isolation, privacy and unchanged cursor/removal/activation state.
`;
tenantSync = replaceSection(
  tenantSync,
  '### M7D7 — Promotion Authority Primitive',
  '### M7D8 — Verified Promotion and Cursor Commit',
  tenantSyncReplacement,
  'tenant_sync_m7d7'
);
await writeFile('docs/TENANT-SYNC.md', tenantSync);

let currentState = await readFile('docs/CURRENT-STATE.md', 'utf8');
currentState = replaceExact(
  currentState,
  'Snapshot: **2026-08-25 after M7D6 production closure**',
  'Snapshot: **2026-08-25 after M7D7 promotion-authority architecture decision**',
  'current_state_snapshot'
);
const decisionSection = `### M7D7 promotion-authority architecture decision — accepted / implementation pending

The mandatory pre-implementation M7D7 architecture gate is complete. Catalog Engine V1 selects **one bounded set-based D1 transaction** as the canonical serving-authority primitive and rejects generation/version + active-pointer storage for V1 at the measured launch envelope.

Real Cloudflare D1 evidence was produced only on isolated ephemeral databases:

- evidence PR \`#147\`, integrated SHA \`49fb1550b0d922bc9ad4a60a22be235afb02c545\`, trusted run \`32872632343\` / job \`97883057258\` = **SUCCESS**;
- corrected evidence PR \`#148\`, integrated SHA \`581d73f27aa457be0b71685a38500bc3ff70615f\`, trusted run \`32873067956\` / job \`97884460496\` = **SUCCESS**;
- 108 test files / 535 tests, ESLint and dependency policy passed;
- probe target: 20,000 products + 40,000 media relationships;
- modeled canonical row changes: approximately 140,000;
- set-based authority transaction: \`1,374.0 ms\` wall / \`436.537 ms\` internal SQL;
- forced middle-statement failure rolled the D1 batch back completely;
- five concurrent readers observed only the complete new revision after queueing behind the write; no mixed state was observed;
- generation pointer comparison: \`0.235 ms\` internal SQL for the pointer update after pre-materialization;
- no real tenant/default catalog mutation, no Queue message, recurring sync remained disabled and ephemeral D1 cleanup succeeded.

The selected authority flow is:

\`\`\`text
verified candidate
→ fail-closed envelope + stale-base admission
→ ONE D1 batch transaction
   verified -> promoting
   + all canonical serving mutations
   + promoting -> promoted
→ commit is the authority switch
\`\`\`

The measured V1 admission envelope is 20,000 composed products / 40,000 media relationships plus existing transport limits (100 batch statements, 100 KB SQL statement, 100 params/query). Above-envelope promotion must fail before canonical mutation; it may never fall back to chunked canonical writes.

This decision does **not** mean M7D7 is implemented or Production Green. The next approved work is the bounded M7D7 primitive itself, with production-shaped proof of stale-base CAS, competing-run exclusion, transaction rollback, idempotent replay, old-or-new readers, over-envelope failure, privacy/isolation and no cursor/removal/activation changes. Full rationale and revisit conditions are in \`M7D7-PROMOTION-AUTHORITY-DECISION-2026-08-25.md\`.

`;
currentState = replaceExact(
  currentState,
  'Still not active/proven in production:\n',
  `${decisionSection}Still not active/proven in production:\n`,
  'current_state_decision_insert'
);
const oldNext = `Immediate next execution boundary:\n\n**M7D7 — Promotion Authority Primitive architecture decision**\n\nM7D7 implementation must not begin until measured D1 evidence and an explicit architecture decision select one atomic authority boundary: either a proven bounded set-based transaction or versioned/generation state with one atomic active-authority pointer switch. Chunked canonical writes without an authority flip are prohibited. The decision must cover verified-only entry, competing leases, crashes before/after the authority switch, concurrent-reader consistency, previous-LKG recovery, large-catalog limits and tenant/source isolation.\n\nThe complete approved M7 slice ledger lives in \`DEVELOPMENT-ROADMAP.md\`, with detailed contracts in \`TENANT-SYNC.md\`. M7D6 is **PRODUCTION GREEN**; M7D7 is **PLANNED — architecture decision required before implementation**; M7D8–M7D11 remain planned in order; M7E remains an explicit activation decision. Recurring Intelligent Sync stays disabled.`;
const newNext = `Immediate next execution boundary:\n\n**M7D7 — Promotion Authority Primitive implementation**\n\nThe architecture decision is complete: V1 uses one bounded set-based D1 transaction whose commit is the serving-authority switch. M7D7 implementation must now encode verified-only/stale-base CAS, the complete production-shaped canonical mutation in one batch, idempotent promoted replay, over-envelope fail-closed admission and exact rollback/reader-isolation proof. It must not commit cursor/schedule authority, activate removal or enable recurring Intelligent Sync.\n\nThe complete approved M7 slice ledger lives in \`DEVELOPMENT-ROADMAP.md\`, with detailed contracts in \`TENANT-SYNC.md\`. M7D6 is **PRODUCTION GREEN**; M7D7 is **PLANNED — architecture decision complete / implementation next**; M7D8–M7D11 remain planned in order; M7E remains an explicit activation decision. Recurring Intelligent Sync stays disabled.`;
currentState = replaceExact(currentState, oldNext, newNext, 'current_state_next');
await writeFile('docs/CURRENT-STATE.md', currentState);

let roadmap = await readFile('docs/DEVELOPMENT-ROADMAP.md', 'utf8');
roadmap = replaceExact(
  roadmap,
  '| M7D7 — Promotion Authority Primitive                   | **PLANNED — architecture decision required before implementation** | Prove one atomic authority boundary so readers never see a mixed old/new catalog.                     |',
  '| M7D7 — Promotion Authority Primitive                   | **PLANNED — architecture decision complete / implementation next** | Implement the measured bounded set-based D1 transaction so readers see only old or new complete state. |',
  'roadmap_ledger'
);
const roadmapEvidence = `M7D7 architecture decision is recorded in \`M7D7-PROMOTION-AUTHORITY-DECISION-2026-08-25.md\`. Real Cloudflare D1 run \`32873067956\` / job \`97884460496\` on SHA \`581d73f27aa457be0b71685a38500bc3ff70615f\` proved a 20,000-product / 40,000-media stress transaction with approximately 140,000 modeled canonical row changes in 1,374.0 ms wall / 436.537 ms internal SQL, complete rollback on forced batch failure and old-or-new-only concurrent reader observations. V1 therefore selects one bounded set-based D1 transaction as the authority switch; generation/pointer is rejected at this measured envelope. M7D7 implementation is still pending and must fail closed above the measured envelope rather than chunk canonical serving writes.\n\n`;
roadmap = replaceExact(
  roadmap,
  'M7D2 through M7D11 must remain separate implementation claims unless a later documentation decision proves a safer decomposition.',
  `${roadmapEvidence}M7D2 through M7D11 must remain separate implementation claims unless a later documentation decision proves a safer decomposition.`,
  'roadmap_evidence_insert'
);
roadmap = replaceExact(
  roadmap,
  '1. Resolve the M7D7 promotion-authority architecture decision with measured D1 evidence before implementation. M7D6 is Production Green.\n2. After the decision is recorded, execute M7D7 and then M7D8 without allowing chunked canonical writes to become serving authority before an atomic authority switch.',
  '1. Execute M7D7 using the accepted bounded set-based D1 transaction architecture. M7D6 is Production Green and the M7D7 architecture gate is complete.\n2. After M7D7 itself is Production Green, execute M7D8 so cursor/schedule/control metadata commits only after durable promoted authority.',
  'roadmap_execution_order'
);
await writeFile('docs/DEVELOPMENT-ROADMAP.md', roadmap);

for (const path of [
  '.github/workflows/cloudflare-m7d7-d1-architecture-probe.yml',
  '.github/workflows/cloudflare-m7d7-d1-architecture-probe-v2.yml',
  'scripts/cloudflare-m7d7-d1-architecture-probe.mjs',
  'scripts/cloudflare-m7d7-d1-architecture-probe-v2.mjs',
  '.github/workflows/m7d7-decision-docs.yml',
  'scripts/m7d7-architecture-decision-docs.mjs'
]) {
  await unlink(path);
}
