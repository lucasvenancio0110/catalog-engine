# Catalog Engine — Instant Catalog

Status: **Normative bounded architecture/execution contract**  
Owner decision: **2026-09-06**  
Initiative: **IC0 -> IC6 — Instant Catalog**  
Scope: time-to-first-catalog, construction preview, progressive ingestion, upstream-safe parallelism, warm tenant data-plane capacity, truthful creation/loading UX and production speed proof.  
Sequencing: owner-authorized bounded insertion **after PB9 and before PB10**. PB10 remains Merchant Home and resumes after IC6.

## Product decision

Catalog Engine must not make a merchant wait for the entire authoritative import, CEI pass, verification and final tenant runtime before showing useful value.

The target experience is:

```text
create/authenticated store
-> choose identity/theme
-> connect source
-> full-screen branded creation experience
-> first real source products appear progressively
-> authenticated construction preview becomes interactive
-> full listing/detail/CEI/verification continue in background
-> verified PB9 preview authority replaces construction authority
-> later domain/publication gates remain unchanged
```

The customer should feel that the store is being created in front of them, while every displayed progress statement remains backed by real server state.

## Core terminology

Three product-data readiness levels are deliberately distinct:

### L0 — INDEXED

Provider listing evidence has produced a stable opaque product identity plus bounded safe card evidence such as sanitized title and cover evidence.

L0 may appear only in the authenticated **construction preview**. It is not CEI merchandising truth, not verified catalog authority and not publication authority.

### L1 — HYDRATED

The provider detail stage has fetched and validated normalized detail/media evidence for the product.

L1 improves product detail/gallery quality but still does not independently authorize verified preview or publication.

### L2 — VERIFIED

The normal authoritative initial-import, CEI/classification, verification and full runtime rules have succeeded under their existing contracts.

L2 is the existing PB9/private-preview authority. Public publication still requires its separate domain/publish gates.

Critical rule:

> Never wait for L2 to show safe L0 value, and never pretend L0 is L2.

## Latency metrics

All timings are measured server-side where possible and use monotonic/durable event boundaries rather than browser animation duration.

- **TTFI — Time to First Indexed product**: accepted source decision -> first safe L0 product persisted in construction state.
- **TTFC — Time to First Catalog**: accepted source decision -> construction preview has enough real products to be interactively opened.
- **TTFA — Time to Full Listing Availability**: accepted source decision -> authoritative complete listing index discovered/staged for the initial import.
- **TTFH — Time to Full Hydration**: accepted source decision -> every discovered initial detail is terminal under the existing success/skipped/deferred contract.
- **TTFV — Time to Fully Verified preview**: accepted source decision -> existing PB9 runtime/verification authority is ready.

Human typing, email verification and operator-issued beta-grant delay are reported separately from system processing latency. The future public self-service path must not require an operator grant.

## Performance objectives

These are engineering objectives for a healthy supported source, not fabricated completion promises when the upstream supplier is slow or throttling.

### Customer-visible objectives

- TTFI: **p50 <= 2s**, **p95 <= 5s**.
- TTFC: **p50 <= 5s**, **p95 <= 10s**.
- A merchant should not need to wait for full hydration/CEI to open the construction preview.

### Large-catalog engineering objectives

For a CROCCODILOS-class source (~6k products), after measured baseline:

- complete listing discovery/staging target: **<= 30s when the upstream is healthy**;
- full detail hydration initial target: **<= 120s when upstream and tenant D1 remain healthy**, then tighten from production evidence;
- CEI/verification may continue after hydration and must remain independently measured.

No UI may count down to these objectives or display them as guaranteed remaining time.

## Construction preview authority

Construction preview is a new authenticated, read-only, **pre-verification** authority. It is deliberately different from PB9 verified private preview.

It must:

- resolve active merchant membership server-side;
- resolve the tenant server-side;
- expose only bounded safe L0/L1 product projections;
- use opaque Catalog Engine product/media identities;
- keep raw provider item IDs, source URLs, media origins, D1 identifiers and Worker locators private;
- use the merchant's persisted theme/colors/logo;
- be `private, no-store`, non-indexable and no-referrer;
- fail closed on missing/revoked membership or mismatched tenant authority;
- never become public custom-domain authority;
- never mutate the logical publish state;
- never mark the catalog verified/ready merely because L0 products exist;
- clearly communicate that products are still being added/organized when processing is incomplete.

The current PB9 preview path and production proof remain Last Known Good until an explicit handoff slice proves the transition from construction preview to verified preview.

## Construction-state storage decision

The fast path must not put per-item provider locators in the shared SaaS control plane merely for convenience.

IC2 will use a tenant-scoped ephemeral construction-state primitive with isolation equivalent to a per-tenant shard. The preferred implementation to prove first is a **Durable Object instance per tenant**, because it is allocated on first use without waiting for a Cloudflare administrative API call and can retain private provider evidence outside the browser/control plane.

Boundaries:

- one instance key resolves from the server-owned opaque tenant identity;
- private source/item/media locators may exist only inside this tenant-scoped construction state or the normal isolated tenant data plane;
- browser responses contain only safe projections;
- state is bounded by product/media count and byte limits;
- successful L2 handoff makes construction state disposable; cleanup is idempotent;
- a construction-state failure never corrupts the authoritative tenant D1/LKG.

If implementation evidence shows Durable Objects are unsuitable, changing this storage primitive requires a focused architecture update; do not silently fall back to a shared high-cardinality control-plane table.

## Fast source seed

The Provider Engine gains a bounded optional capability for a **preview seed observation**.

The seed contract is not an authoritative initial scan. It returns a normalized `complete:false` observation suitable only for construction preview.

For Yupoo the first implementation should:

- validate the same HTTPS/host/redirect/size boundaries as normal ingestion;
- fetch the minimum useful listing pages first;
- derive the same stable opaque product identity namespace used by the authoritative import;
- return sanitized listing title + private cover evidence + bounded source-category evidence;
- stop at a strict count/time budget;
- never infer missing/removal from the partial observation;
- never replace the authoritative supplier index.

Unknown providers fail closed. Central construction orchestration consumes the Provider Engine capability and must not import the Yupoo parser directly.

## Event-driven fast path

The five-minute cron remains valid for recovery/discovery, but it may not be the normal latency boundary for first value.

After a source decision is durably accepted, Catalog Engine should immediately enqueue the bounded instant-seed job. This job is separate from authoritative import ownership.

Target flow:

```text
source accepted
  |-- immediately -> instant seed Queue -> provider seed -> tenant construction state -> real progress/preview
  |
  `-- normal durable provisioning/import chain continues -> L2 -> PB9 verified preview
```

Queue delivery must remain idempotent and minimal. Do not put the raw source URL in the queue message; resolve it server-side from the tenant/source authority.

## Loading/creation experience

The loading surface is a product feature, not a spinner.

After source confirmation the mobile-first portal enters a full-screen branded creation state using the merchant's chosen theme/colors/logo.

Allowed customer-visible stages must map to real authority, for example:

- `Identidade criada` — persisted store/profile exists;
- `Fonte conectada` — private source decision accepted;
- `Encontrando produtos` — seed/listing acquisition active;
- `<N> produtos encontrados` — real server count only;
- `Preparando sua vitrine` — construction projection has begun;
- `Sua loja já pode ser visualizada` — TTFC readiness threshold is actually satisfied;
- `Continuamos adicionando e organizando o restante` — authoritative pipeline is still incomplete.

Rules:

- no fake percentage;
- no invented ETA;
- no counter animation above the latest server count;
- no artificial minimum loading delay;
- CTA appears as soon as real TTFC readiness exists;
- after CTA readiness, the storefront may reveal behind the success layer without blocking interaction;
- touch/keyboard/focus/slow/error/retry/reduced-motion states are required;
- the user can leave and re-enter without losing truthful durable progress.

Initial TTFC readiness threshold is a contract owned by IC2/IC3 tests, not a timer. The first implementation should target a useful grid (for example at least 12 safe real products) and may tune that threshold only from UX/performance evidence.

## Progressive storefront behavior

Construction preview must be honest about incomplete data.

L0 product cards may show:

- safe cover image through a private opaque proxy boundary;
- sanitized product title;
- merchant branding;
- a neutral availability/loading state for detail fields not hydrated yet.

Construction preview must not present supplier taxonomy as canonical navigation merely to look complete. Until CEI merchandising is ready, use a neutral product/discovery surface and progressively activate canonical navigation when L2 authority is available.

A product selected before hydration may trigger prioritized/on-demand detail work, but the request must remain bounded and cannot bypass provider throttling or tenant isolation.

## Authoritative import acceleration

Instant Catalog also improves the real pipeline instead of only hiding it.

### Listing parallelism

The current Yupoo scanner is allowed bounded category concurrency but walks pages within a listing sequentially. IC3 will introduce bounded page-level fan-out after provider-safe page discovery, with one shared PQueue budget so nested category/page work cannot explode concurrency.

Normalized page batches should become available progressively while final complete-scan authority still requires every required page to succeed.

A partial page stream must never become the authoritative initial index.

### Detail swarm

The current detail Queue values are deliberately conservative (`max_batch_size=4`, timeout `5s`, max concurrency `2`) and the consumer loops batch messages sequentially.

IC4 will replace this fixed bottleneck with measured horizontal detail processing while preserving bounded upstream pressure.

The target is not unbounded `Promise.all`. It is:

- small Queue deliveries optimized for latency;
- many independent Worker invocations;
- explicit provider flow control;
- bounded tenant-D1 write pressure;
- retry/DLQ/idempotency unchanged in meaning.

### Adaptive upstream governor

IC4 will implement a provider/source-host flow governor using an isolated coordination primitive rather than a process-local counter.

The control algorithm should use bounded AIMD-style behavior:

- conservative initial concurrency;
- additive increases after healthy success windows;
- multiplicative decrease on 429/5xx/timeouts;
- cooldown + jitter after throttling;
- floor and hard ceiling;
- EWMA-style latency/error signals;
- no raw source hostname in public logs/evidence.

The governor protects the supplier; it is not a mechanism to evade provider rate limits.

D1 write latency/lock pressure must be measured separately. Fetch concurrency may scale higher than persistence concurrency if evidence requires a per-tenant write governor.

## Warm tenant cell pool

The existing real tenant data-plane/runtime provisioning depends on trusted Cloudflare administrative work and can add minutes of scheduler/CI latency. That must not remain on the critical path for fast full import.

IC5 will prove a bounded **warm tenant cell pool** for new tenants while keeping the existing on-demand provisioner as rollback/fallback.

Concept:

- trusted CI maintains a small reserve of verified, unassigned isolated D1 + Catalog Engine User Worker cells;
- an unassigned cell contains no merchant data and is not publicly routable;
- normal product code atomically claims one cell for exactly one tenant;
- claim initializes/verifies immutable tenant ownership before import writes are admitted;
- a claimed cell is never reassigned to another tenant through an ordinary product path;
- exhausted pool falls back safely instead of cross-assigning;
- trusted CI replenishes the reserve outside the merchant's latency path.

The pool must preserve the strategic invariant `one isolated catalog D1 per tenant`. It changes **when** infrastructure is created, not who owns it after claim.

Required security proof includes double-claim races, stale claim attempts, cross-tenant dispatch, identity mismatch, empty-pool fallback, rollback and no slot reuse without explicit destructive retirement/recreation.

`TENANT_WARM_POOL_ENABLED=0` (or equivalent explicit default-OFF authority) is required until IC5's dedicated production proof is Green.

## Handoff from construction preview to verified preview

When L2 becomes ready:

1. current membership remains valid;
2. existing PB9 runtime + verification gates are revalidated;
3. portal switches preview authority from construction state to verified tenant runtime;
4. URL/client code must not receive a Worker locator;
5. merchant theme remains stable;
6. construction state can be retired asynchronously/idempotently;
7. no visual flash may send the user back to another tenant/default tenant.

The authoritative verified runtime always wins after a valid handoff.

## Observability and evidence

Instant Catalog metrics must be safe and useful.

Allowed evidence includes:

- opaque run identifiers when necessary;
- stage name;
- TTFI/TTFC/TTFA/TTFH/TTFV milliseconds;
- discovered/seeded/hydrated/terminal counts;
- queue age/backlog counts;
- safe retry/throttle codes;
- adaptive concurrency value/changes without provider-private locator;
- construction -> verified handoff result.

Do not log supplier URL, raw provider IDs, raw media URLs, D1 UUID, Worker script name, auth token or construction capability.

## Failure philosophy

Speed may degrade; correctness may not.

- source unavailable: keep existing merchant state, show actionable retry;
- instant seed fails: authoritative import may continue; do not fabricate products;
- construction store fails: PB9/LKG remains unaffected;
- provider throttles: governor slows down;
- Queue retry/DLQ: preserve durable evidence;
- warm pool empty: use safe fallback/current provisioner;
- full import/CEI/verify failure: construction preview can remain a clearly incomplete private view only while its membership/source authority is valid; it never becomes publishable.

## Rollback hierarchy

Rollback is intentionally layered:

1. disable construction preview CTA while preserving current PB9 preview;
2. disable instant-seed dispatch;
3. restore conservative detail Queue concurrency;
4. disable adaptive governor acceleration and fall back to current bounded behavior;
5. disable warm-pool claims and use current trusted provisioning;
6. recurring Intelligent Sync remains OFF throughout and is not a rollback lever for this initiative.

No rollback deletes the merchant's verified catalog.

## Initiative ledger

### IC0 — Governance + performance contract

Status at creation: **IN PROGRESS**.

Outcome:

- approve this architecture, metrics, invariants, sequencing and rollback model;
- update continuity/state/document map so later contributors cannot skip or reinterpret the initiative.

No production behavior change.

Definition of Done:

- owner decision is merged;
- IC1–IC6 names/order are approved;
- PB10 is explicitly paused, not cancelled;
- PB9 remains LKG/Production Green;
- recurring sync/M7E/publication remain unchanged.

### IC1 — Real latency baseline + branded creation UX

Outcome:

- instrument real system timing boundaries;
- add the full-screen branded creation/loading experience using only existing durable progress;
- establish production baseline before changing ingestion concurrency.

Non-goal: claim speed improvement before measured backend changes.

Definition of Done:

- no fake percentage/ETA;
- real counts/stages only;
- mobile/touch/keyboard/reduced-motion/error/re-entry covered;
- safe production timing evidence recorded.

### IC2 — Instant seed + construction preview

Outcome:

- immediate source-triggered seed path;
- tenant-isolated ephemeral construction state;
- safe L0 API/media projection;
- authenticated construction preview opens as soon as the real readiness threshold is met.

Definition of Done:

- TTFI/TTFC measured on real fresh tenant;
- anonymous/cross-tenant/default fail closed;
- no source/runtime identifiers leak;
- PB9 verified preview behavior remains green.

### IC3 — Streaming/parallel listing discovery

Outcome:

- provider-safe bounded page-level fan-out;
- progressive normalized listing batches;
- complete-scan authority unchanged.

Definition of Done:

- partial observation cannot replace authoritative index;
- full-scan identity/count matches baseline fixtures;
- concurrency is bounded by PQueue;
- measured TTFA improves without increased error/leak rate.

### IC4 — Adaptive detail swarm

Outcome:

- remove the current fixed `2`-consumer bottleneck safely;
- introduce provider-aware adaptive flow control and measured D1 backpressure;
- preserve detail lease/retry/deferred/finalize semantics.

Definition of Done:

- 429/5xx/timeout causes automatic slowdown;
- healthy source causes bounded scale-up;
- duplicate/DLQ/recovery tests remain green;
- two-tenant isolation remains green;
- measured TTFH improves materially.

### IC5 — Warm tenant cell pool + immediate full-pipeline start

Outcome:

- move physical Cloudflare resource creation outside the merchant latency path;
- atomically claim a preverified isolated cell and begin normal schema/import work immediately;
- retain the current trusted provisioner as fallback.

Definition of Done:

- default-OFF activation gate;
- pool inventory/replenishment trusted-CI path;
- double-claim/cross-tenant/empty-pool/rollback proof;
- one claimed D1 remains exclusive to one tenant;
- production canary demonstrates immediate claim without manual per-customer action.

### IC6 — Fresh beta speed proof

Outcome:

- create/use a fresh second beta account/tenant and run a clocked end-to-end proof through construction preview and verified handoff.

Proof must report separately:

- authentication/entitlement human/operator delay;
- TTFI;
- TTFC;
- TTFA;
- TTFH;
- TTFV;
- product count and failure/throttle state;
- mobile experience evidence;
- verified preview isolation regression.

Definition of Done:

- healthy-source TTFC satisfies the production target or the initiative remains open with measured root cause;
- no metric is inferred from UI animation;
- second tenant cannot read first tenant/default tenant and vice versa;
- PB9 verified runtime remains Last Known Good;
- construction state hands off safely;
- only then resume PB10.

## Sequencing

The approved temporary execution order is now:

```text
PB0 -> ... -> PB9
-> IC0 -> IC1 -> IC2 -> IC3 -> IC4 -> IC5 -> IC6
-> PB10 -> PB11 -> PB12
```

IC work does not reopen PB9. PB9 remains the verified-preview LKG while the new earlier construction experience is developed.

Each IC slice uses its own branch/PR, exact tested head, CI, trusted-main deployment and applicable privileged proof before the next slice begins.

## Permanent invariants during IC0–IC6

```text
TENANT_IMPORT_AUTOMATION_ENABLED=1
TENANT_SYNC_AUTOMATION_ENABLED=0
TENANT_SYNC_ACTIVE_COHORT=""
TENANT_SYNC_MAX_JOBS_PER_TICK=1
```

- no recurring Intelligent Sync activation;
- no M7E activation;
- no public merchant publication merely to prove speed;
- no unbounded supplier concurrency;
- no provider-private browser payload;
- no default-tenant fallback;
- no fake progress;
- no destructive migration without its own explicit slice;
- no advancement to the next IC slice before the current slice reaches its required proven state.

## Final decision rule

For every Instant Catalog optimization ask:

> Does this make the merchant see real value sooner while preserving provider safety, tenant isolation, authoritative verification and rollback?

If speed requires weakening one of those boundaries, the optimization is rejected.
