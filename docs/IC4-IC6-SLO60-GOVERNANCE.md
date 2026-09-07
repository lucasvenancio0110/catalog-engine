# Catalog Engine — IC4–IC6 SLO60 Performance Governance

Status: **Normative execution and performance-governance contract**  
Owner decision: **2026-09-07**  
Scope: IC4, IC5 and IC6 execution needed to pursue a healthy-source ~6,000-product catalog from accepted source decision to fully verified private preview in approximately 60 seconds, without weakening Catalog Engine security, isolation, Last Known Good authority, provider safety or recovery semantics.  
Depends on: `AGENTS.md`, `DOCUMENT-GOVERNANCE.md`, `DEVELOPMENT-CONTINUITY.md`, `INSTANT-CATALOG.md`, `PROVIDER-ENGINE.md`, tenant import/Queue/data-plane/classify-verify contracts and live `CURRENT-STATE.md` evidence.

## 1. Decision

Catalog Engine will treat **6K/60** as an internal engineering performance program for IC4–IC6.

The target is not a customer-facing ETA and must never be rendered as a countdown or guaranteed completion promise. It is a production engineering objective for a supported, healthy provider/source and a correctly provisioned tenant.

The program must optimize the complete pipeline, not merely one benchmark:

```text
accepted source decision
-> listing discovery
-> detail hydration
-> normalized persistence
-> CEI classification
-> verification
-> verified private-preview authority
```

The governing priority order is permanent:

```text
security / privacy
> tenant isolation
> correctness / complete-scan authority
> Last Known Good preservation
> provider safety
> recovery / idempotency
> observability
> latency / throughput
```

If speed conflicts with any higher item, **speed loses**.

## 2. What 6K/60 means

The reference class is a CROCCODILOS-sized source of approximately 6,000 products.

The arithmetic requirement is approximately:

```text
6,000 products / 60 seconds = 100 terminal products per second
```

This does **not** imply one Worker must process 100 products/s. The intended strategy is horizontal flow through bounded independent Workers, queues and write aggregation.

The program distinguishes:

- **TTFI** — first indexed product;
- **TTFC** — useful construction catalog ready;
- **TTFA** — full authoritative listing available;
- **TTFH** — every discovered detail terminal under the existing success/skipped/deferred contract;
- **TTFV** — verified PB9-compatible private-preview authority ready.

### SLO60 engineering targets

These are targets, not UI promises:

```text
TTFI        p50 <= 2s, p95 <= 5s
TTFC        p50 <= 5s, p95 <= 10s
TTFA        target <= 15s, hard IC6 evidence budget <= 30s
50% L1      target <= 25s
100% L1     target <= 45s
TTFV        target <= 60s
```

The existing Instant Catalog objectives remain valid. This document tightens the execution program but does not authorize fake ETAs or weaken any existing safety gate.

## 3. Cold path vs warm path

Every performance proof must state whether it is **cold** or **warm**.

### Cold source path

The provider/source has no reusable Catalog Engine snapshot beyond normal operational caches. The supplier remains in the critical path.

Cold-path speed is bounded by actual provider latency and safe provider concurrency.

### Warm source path

Catalog Engine already possesses a current private, provider-authorized reusable snapshot or equivalent internal evidence for the source.

A future Provider Snapshot Engine may make sub-60-second performance more repeatable, but it is **not silently part of IC4–IC6** unless separately approved and documented. IC4–IC6 must first prove the best safe architecture using the existing provider and tenant boundaries.

No contributor may use proxy rotation, IP rotation, account multiplication, hidden mirrors or any mechanism intended to evade provider throttling or access controls.

## 4. Permanent security and correctness invariants

No SLO60 implementation may change these rules without an explicit higher-authority product/security decision.

### Tenant isolation

- One tenant remains bound to its isolated tenant data plane.
- Browser/client input never selects an arbitrary tenant D1 or Worker locator.
- A queue/result/write message must resolve tenant/source authority server-side.
- Cross-tenant dispatch, stale tenant ownership and default-tenant fallback fail closed.
- Warm infrastructure may be unassigned, but after claim it belongs to exactly one tenant and cannot be normally reassigned.

### Provider privacy

Never expose in browser/public evidence:

- supplier URL/hostname;
- raw provider IDs;
- raw media origins;
- D1 UUID;
- Worker script locator;
- dispatch namespace locator;
- secrets/tokens;
- raw provider HTML/evidence.

Minimal private queue messages remain opaque and server-resolved.

### Listing authority

- Partial listing batches are `complete:false` construction/staging evidence only.
- Partial observation never infers missing/removal.
- Every required page must succeed before authoritative complete-scan replacement.
- Suspicious/catastrophic observations remain quarantined by existing safety rules.

### Detail and LKG authority

- Incomplete detail work cannot overwrite a previously healthy authoritative product unless an existing safe contract explicitly permits it.
- Duplicate delivery remains idempotent.
- Claim/lease ownership remains exact and recoverable.
- Existing verified PB9/L2 authority remains Last Known Good until the normal verified handoff succeeds.

### CEI and verification

- Classification can be moved earlier in time, but its semantic contract cannot be weakened.
- Merchant overrides remain durable business truth.
- Review/research exceptions remain distinct from blocking integrity failures.
- Final verification remains a hard structural/publication progression gate.
- No product is described as verified merely because it reached L0/L1 quickly.

### Recurring sync

Throughout IC4–IC6:

```text
TENANT_SYNC_AUTOMATION_ENABLED=0
TENANT_SYNC_ACTIVE_COHORT=""
TENANT_SYNC_MAX_JOBS_PER_TICK=1
```

Recurring Intelligent Sync and M7E are not performance levers for this program.

## 5. Architecture target

The target pipeline is a bounded staged swarm:

```text
LISTING DISCOVERY
      |
      v
opaque detail work queue
      |
      +--> detail worker 001 --+
      +--> detail worker 002 --+
      +--> detail worker ... --+--> normalized result queue
      +--> detail worker N   --+             |
                                             v
                                     tenant write combiner
                                             |
                                             v
                                        isolated D1
                                             |
                      +----------------------+------------------+
                      v                                         v
              streaming CEI work                         progress state
                      |
                      v
              final verification barrier
                      |
                      v
                  PB9/L2 ready
```

The design deliberately separates:

1. supplier/network concurrency;
2. Worker invocation concurrency;
3. tenant D1 persistence concurrency;
4. CEI compute concurrency;
5. final verification authority.

Increasing one must not accidentally multiply the others.

## 6. Provider-pressure governance

IC4 owns a provider/source-host adaptive governor.

The governor must coordinate across Worker invocations through an isolated server-side coordination primitive. Process-local counters are insufficient because many Workers may execute independently.

### Required behavior

Use bounded AIMD-style flow control:

- start conservatively;
- add capacity only after healthy windows;
- multiplicatively reduce concurrency on 429, meaningful 5xx, timeout or elevated error rate;
- use cooldown and jitter;
- preserve a hard floor and a hard ceiling;
- use EWMA-style latency/error signals or an equivalently documented bounded algorithm;
- keep source hostname/private locator out of public logs/evidence;
- never interpret a higher configured Cloudflare limit as permission to pressure a provider beyond measured health.

### Required stop signals

Automatic slowdown is mandatory when any configured threshold detects:

- upstream 429;
- sustained 5xx;
- timeout growth;
- p95 latency degradation;
- Queue retry growth;
- tenant D1 write latency/lock growth;
- provider-specific safe circuit-breaker signal.

A performance proof that wins only while provider errors materially increase is a **failure**.

## 7. D1 backpressure and write combining

The current isolated D1 remains the tenant authority. SLO60 does not authorize moving many tenants into one shared catalog D1 merely for throughput.

Horizontal detail fetch may scale much higher than D1 persistence. Therefore persistence requires its own bounded governor.

### Target write model

Do not require every detail Worker to execute a large independent SQL write batch directly against the same tenant D1 at high concurrency.

Prefer:

```text
many detail fetch/normalize workers
-> opaque normalized result queue
-> bounded tenant-scoped write combiner
-> set-based / batched D1 mutations
```

The write combiner should reduce query/transaction overhead by grouping compatible rows while preserving exact tenant/import/product ownership.

Where safe and simpler, JSON input plus `json_each`/set-based SQL may convert many repeated row mutations into bounded bulk operations.

### Write-combiner invariants

- Result payload is schema validated before persistence.
- One tenant cannot be combined with another tenant in an authority transaction.
- Duplicate/result replay remains idempotent.
- Out-of-order detail completion cannot regress newer/valid state.
- Claim token/import identity remains verified before terminal detail state is committed.
- A combiner crash cannot acknowledge work that was not durably committed.
- D1 error/backpressure slows persistence/fetch admission; it never drops authoritative work.

## 8. Streaming CEI and verification preparation

To reach 60 seconds, CEI cannot wait unnecessarily for a completed 6,000-product hydration phase before beginning all classification work.

Allowed model:

```text
L1 product committed
-> CEI classification for that exact normalized product may begin
-> versioned classification/intelligence state persisted
```

The final tenant verification remains a barrier over the complete terminal catalog.

This creates overlap, not weaker authority.

Forbidden shortcuts:

- classifying from unvalidated provider HTML;
- publishing classification before required persistence ownership is established;
- skipping merchant override application;
- treating incomplete aggregate counts as verified final aggregates;
- running final verification before the complete terminal-count barrier is satisfied.

## 9. IC4 approved decomposition — Adaptive Detail Swarm

IC4 is decomposed into the following ordered slices. After this planning contract merges, these names/order are approved and future contributors must not silently rename/reorder them.

### IC4A — Detail throughput baseline and safe telemetry

Outcome:

- measure current detail fetch, Queue wait, D1 write and per-product normalization latency separately;
- measure actual requests/s, terminal products/s, Queue age, retry rate and D1 latency;
- record only safe counters/timings.

DoD:

- exact trusted-main production evidence exists;
- no private provider/tenant locator leaks;
- baseline separates network time from persistence time;
- no concurrency change yet.

### IC4B — Queue micro-delivery and horizontal consumer fan-out

Outcome:

- remove the fixed two-consumer throughput bottleneck;
- evaluate batch size 1–2 vs existing batch 4 from production evidence;
- permit many independent Worker invocations under explicit hard ceiling.

DoD:

- duplicate/retry/DLQ behavior unchanged in meaning;
- per-message ownership remains exact;
- two-tenant isolation proof green;
- increased Worker concurrency alone does not increase provider concurrency above governor authority.

### IC4C — Adaptive upstream governor

Outcome:

- provider/source-host coordinated AIMD governor controls supplier fetch admission;
- automatically scale up while healthy and down on throttling/errors/latency.

DoD:

- 429/5xx/timeout tests prove slowdown;
- healthy-window tests prove bounded scale-up;
- hard ceiling cannot be bypassed by nested Worker invocations;
- governor state is private and source-safe;
- no proxy/rate-limit evasion.

### IC4D — Tenant D1 write-pressure governor

Outcome:

- measure and bound per-tenant persistence concurrency separately from fetch concurrency;
- prevent horizontal fetch swarm from turning into D1 lock/latency collapse.

DoD:

- artificial slow-D1 proof triggers slowdown without loss;
- retry/replay remains idempotent;
- another tenant is not blocked by one tenant's D1 backpressure.

### IC4E — Production detail-swarm proof

Outcome:

- production proof on a real large catalog with exact-SHA Queue deployment;
- prove materially improved TTFH while preserving safety/error rate.

DoD:

- identity/count matches authoritative listing;
- error/retry/DLQ rate remains within documented safe budget;
- PB9/LKG, IC2/IC3 regressions and tenant isolation remain green;
- recurring sync remains OFF.

## 10. IC5 approved decomposition — Warm Start + Batched Persistence

### IC5A — Warm tenant cell pool foundation

Outcome:

- trusted CI maintains a small bounded reserve of verified unassigned tenant cells;
- default OFF activation flag until dedicated proof.

Required properties:

- no merchant data in an unassigned cell;
- not publicly routable as a merchant;
- atomic single-tenant claim;
- exact immutable ownership established before import writes;
- no ordinary reuse after claim;
- empty pool uses the current safe provisioner fallback.

### IC5B — Warm-cell race/isolation proof

DoD:

- double claim race fails safely;
- stale claim fails closed;
- cross-tenant dispatch fails closed;
- identity mismatch fails closed;
- fallback works without shared tenant state;
- rollback disables new warm claims without deleting an existing tenant.

### IC5C — Normalized result queue + tenant write combiner

Outcome:

- detail fetch/normalization is decoupled from high-frequency per-product D1 writes;
- normalized results are schema validated and batched per tenant/import.

DoD:

- no cross-tenant batching;
- duplicate/out-of-order/crash tests green;
- commit-before-ack proven;
- D1 batch/transaction bounds are explicit;
- existing per-product direct-write path remains a rollback option until production proof is green.

### IC5D — Streaming CEI pipeline

Outcome:

- newly committed L1 products become eligible for versioned CEI classification immediately;
- classification runs overlap remaining detail hydration;
- final verify barrier remains unchanged.

DoD:

- automatic/effective/override separation preserved;
- classification version/evidence contracts preserved;
- a CEI failure cannot corrupt detail authority;
- final verification still requires complete terminal catalog state.

### IC5E — Immediate full-pipeline start proof

Outcome:

- fresh tenant claims/creates a safe data plane and starts listing/detail work without historical scheduler/CI provisioning delay on the normal warm path.

DoD:

- warm pool ON only for controlled canary;
- exhausted-pool fallback proven;
- complete import/recovery remains functional with warm pool OFF;
- no production Green claim from a precreated fixture that skips real tenant ownership proof.

## 11. IC6 approved decomposition — Fresh 6K/60 Proof

IC6 owns proof, integration tuning and truthful outcome. It must not hide a miss by weakening thresholds.

### IC6A — Production-safe 6K proof harness

The proof must capture server-side safe timestamps/counters for:

- accepted source decision;
- first L0 product;
- TTFC readiness threshold;
- authoritative listing complete;
- detail discovered/claimed/terminal counts;
- CEI classified counts;
- final verification complete;
- Queue age/backlog/retry/DLQ;
- adaptive concurrency values/changes;
- D1 persistence latency/backpressure;
- construction -> verified handoff.

No provider URL/raw ID/D1 UUID/Worker locator/token may appear in evidence.

### IC6B — Fresh cold-path proof

Use a fresh tenant and real supported source.

Required:

- no pre-populated merchant catalog;
- no fake completion state;
- full listing/detail/classify/verify path executes;
- construction state remains separate from L2;
- PB9 verified authority wins only after verification.

### IC6C — Failure/chaos proof

At minimum test:

- upstream 429;
- upstream 5xx;
- upstream timeout/slow response;
- Worker crash after claim;
- Queue duplicate delivery;
- Queue retry/DLQ transition;
- out-of-order result delivery;
- slow/failed D1 write;
- write-combiner crash before and after commit;
- warm-pool double claim/stale claim;
- cross-tenant dispatch attempt;
- partial listing page failure;
- CEI worker failure;
- verification failure;
- kill-switch activation during load.

Expected result is degradation/recovery, never silent corruption or cross-tenant state.

### IC6D — SLO60 acceptance proof

For a healthy supported ~6k source, capture:

```text
product count
TTFI
TTFC
TTFA
TTFH
TTFV
peak detail concurrency
provider throttle/error counts
D1 write latency
Queue retry/DLQ counts
verification findings
```

Performance target:

```text
TTFV <= 60,000 ms
```

The proof is valid only if all security/correctness gates are green.

A run faster than 60 seconds with an increased error/leak/isolation risk is **RED**.

A run slower than 60 seconds with all safety green is honest evidence that the SLO60 target was not achieved. Do not relabel it success.

### IC6E — Decision on residual bottleneck

If safe cold-path TTFV remains above 60 seconds after IC4/IC5 tuning, identify the measured dominant bottleneck.

Allowed outcomes:

1. continue bounded IC6 optimization if the bottleneck is inside Catalog Engine;
2. if upstream/provider latency is the dominant hard limit, create a separate owner-approved architecture decision for Provider Snapshot Engine or another provider-compliant reuse layer;
3. never bypass provider limits to force a benchmark.

PB10 sequencing remains governed by `INSTANT-CATALOG.md` and the live roadmap; a contributor must not silently reinterpret an SLO miss as approval to skip IC6 closure requirements.

## 12. Feature flags and kill switches

Every major acceleration primitive must have an explicit rollback boundary before production activation.

Expected flags or equivalent explicit authorities:

```text
IC4_DETAIL_SWARM_ENABLED=0
IC4_ADAPTIVE_GOVERNOR_ENABLED=0
IC5_WRITE_COMBINER_ENABLED=0
TENANT_WARM_POOL_ENABLED=0
IC5_STREAMING_CEI_ENABLED=0
```

Names may be refined in the implementation PR, but default-OFF behavior before dedicated production proof is mandatory.

Rollback order:

1. disable new high-concurrency detail admission;
2. restore conservative detail Queue settings;
3. disable adaptive acceleration/governor scale-up while retaining conservative floor;
4. disable write combiner and use proven direct persistence path;
5. disable streaming CEI and return to post-import classify scheduling;
6. disable warm-cell claims and use existing provisioner;
7. preserve IC2 construction preview and PB9 verified LKG;
8. recurring sync remains OFF throughout.

Rollback must not delete verified merchant data.

## 13. CI and privileged proof requirements

Every behavior slice requires the normal repository quality gate plus focused tests.

Minimum classes:

- unit contract tests;
- Queue delivery/retry/DLQ/idempotency tests;
- Provider Engine normalized-evidence tests;
- tenant isolation tests;
- concurrency hard-ceiling tests;
- adaptive governor tests;
- D1 backpressure tests;
- duplicate/out-of-order write tests;
- CEI/override/verify regressions where applicable;
- secret/private-evidence leak scan;
- exact-SHA trusted-main deployment;
- exact-SHA Queue consumer activation where Queue configuration/runtime changed;
- dedicated production canary on real tenant/source evidence.

Secret-free PR CI is never production proof.

## 14. Performance evidence discipline

A speed claim must include enough safe evidence to reproduce the conclusion.

Allowed:

- opaque run ID;
- product count;
- stage timestamps/durations;
- request count;
- bounded concurrency value;
- Queue backlog/age;
- safe error codes/counts;
- D1 latency/write batch counts;
- CEI/verification counts;
- cold/warm label.

Forbidden:

- source URL/hostname;
- raw provider item/category/media ID;
- raw provider HTML;
- D1 UUID;
- Worker locator;
- tokens/secrets;
- customer credentials.

Every benchmark must state:

- exact main SHA;
- exact production SHA;
- cold vs warm;
- product count;
- whether media bytes were downloaded or only media evidence normalized;
- Queue/provider/D1 concurrency ceilings;
- provider error/throttle counts;
- whether all security regressions passed.

## 15. Cost and fairness governance

SLO60 cannot consume unlimited platform resources or starve other tenants.

Required:

- per-provider/source pressure control;
- per-tenant D1 pressure control;
- bounded global Worker/Queue concurrency;
- fair admission so one 6k tenant cannot indefinitely starve another tenant;
- operational cost metrics captured separately from customer-visible latency;
- no hidden manual owner intervention in the normal path.

Performance tuning must prefer horizontal isolated work over a single oversized critical section.

## 16. Execution protocol

For every approved IC4–IC6 sub-slice:

1. revalidate live GitHub, main HEAD, open PRs, `HUMAN_GATE_LOCK`, exact production evidence and current flags;
2. read this document plus every mapped owner document;
3. measure before changing a limit;
4. create one small branch from exact main;
5. implement one bounded performance claim;
6. add failure/isolation/idempotency tests in the same PR;
7. keep new acceleration default OFF until its activation/proof slice;
8. run CI and inspect the first real failure without weakening the contract;
9. merge only the exact tested SHA;
10. prove trusted-main deployment and applicable Queue/runtime activation;
11. run the dedicated production proof;
12. record performance and safety evidence separately;
13. update `CURRENT-STATE.md`/roadmap only to the level actually proven;
14. advance only after the current slice is honestly closed.

## 17. Mandatory stop conditions

Stop acceleration and preserve the safest current behavior if any of these occurs:

- tenant isolation uncertainty;
- private source/runtime evidence leak;
- identity mismatch;
- partial scan treated as complete;
- LKG/verification regression;
- merchant override loss;
- unbounded or unexpectedly multiplied concurrency;
- sustained provider throttling/error increase;
- D1 lock/write-pressure growth that risks correctness;
- retry/DLQ growth without understood recovery;
- warm-cell ownership ambiguity;
- undocumented activation flag change;
- recurring Intelligent Sync activation;
- benchmark evidence that cannot distinguish cold/warm path or exact SHA.

## 18. Definition of success

The program succeeds only when Catalog Engine demonstrates that a fresh supported ~6k tenant can progress rapidly through the real pipeline while preserving every existing security and authority invariant.

The ideal final proof is:

```text
~6,000 real products
fresh tenant
TTFI <= 5s p95 objective
TTFC <= 10s p95 objective
TTFA <= 30s hard evidence budget
TTFV <= 60s target
identity stable
complete scan true
provider health acceptable
Queue/DLQ healthy
D1 integrity green
CEI/merchant overrides green
verification green
anonymous/cross/default fail closed
no private identifiers exposed
PB9/LKG preserved until verified handoff
recurring sync OFF
```

The final rule is simple:

> Catalog Engine may become slower to stay safe. It may never become less safe to look fast.
