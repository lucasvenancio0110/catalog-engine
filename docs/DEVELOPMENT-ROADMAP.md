# Catalog Engine — Master Development Roadmap

Status: **Normative execution plan**  
Scope: ordered product/engineering milestones from the post-audit baseline to public launch.  
Purpose: make sequencing, gates and scope explicit so the project does not drift between infrastructure, CEI, design, portal and commercial work.

## Roadmap rules

1. This roadmap defines **execution order**, not durable product truth. Product contracts still live in their focused normative documents.
2. A milestone is complete only when its Definition of Done is evidenced in code/tests/runtime as applicable.
3. Customer-facing work is incomplete without responsive, loading, empty, error, keyboard, touch and accessibility behavior.
4. Infrastructure work is incomplete without a known failure mode, rollback/retry behavior and safe observability.
5. Do not build universal/future scope merely because the architecture permits it.
6. Launch scope is intentionally narrower than the long-term Catalog Engine vision.
7. Documentation and implementation change together when a milestone changes an existing contract.
8. A future milestone receives `A`, `B` or numbered sub-slices only through the decomposition process in `DEVELOPMENT-CONTINUITY.md`; names discussed before that PR are proposals, not approved work.
9. A contributor may not silently advance, rename or reorder the active slice. Roadmap status and `CURRENT-STATE.md` must remain consistent with the evidence level actually reached.
10. Every transfer to a new human or AI follows the live revalidation and handoff protocol in `DEVELOPMENT-CONTINUITY.md`.

## Launch product definition

Catalog Engine v1 is a recurring multi-tenant B2B SaaS that can transform a supported supplier catalog into a professional white-label merchant storefront, organize it using CEI, keep it synchronized and publish it on the merchant's verified domain.

### V1 launch scope

- source connector: Yupoo;
- initial merchandising vertical: sports/football;
- source-neutral provider/core boundaries;
- CEI Core + Sports Knowledge Pack v1;
- isolated tenant D1 and tenant Worker;
- queue-based tenant import;
- incremental/safe synchronization;
- secure media proxy/cache delivery;
- premium responsive storefront;
- controlled themes/branding;
- customer portal;
- authentication/account/membership boundary;
- billing/trial/entitlements according to the final commercial decision;
- self-service onboarding;
- verified custom-domain publication;
- observability/security/recovery;
- closed beta and release-candidate validation.

### Explicitly outside V1 unless pulled forward by evidence

- universal Shopify/WooCommerce/PDF/ERP connector catalog;
- complete CEI autonomous research across arbitrary retail domains;
- production fashion/automotive/dental Knowledge Packs;
- agency/reseller mode;
- advanced multi-source merge/deduplication;
- advanced merchant analytics/BI;
- merchant end-customer payments/orders;
- marketplace behavior;
- arbitrary customer JavaScript/HTML themes.

Architecture should not block these futures, but they must not delay the first sellable product.

---

# M0 — Post-audit truth and governance

Priority: **P0**  
Goal: make the repository itself explain what exists, what is a contract and what remains future work.

Deliverables:

- `CURRENT-STATE.md` as mutable implementation truth;
- this roadmap;
- `DESIGN-SYSTEM.md` as customer-facing UX quality contract;
- update `DOCUMENT-MAP.md` for state/roadmap/design ownership;
- mark superseded activation/readiness documents historical where their future state already occurred;
- correct stale README provisioning/architecture language;
- point overview docs to this roadmap rather than embedding stale next-step lists.

Definition of Done:

- a contributor can distinguish current state, normative contract, roadmap and history;
- no known document claims production dispatch is still disabled;
- no known top-level sequence contradicts the canonical provisioning order.

---

# M1 — Production safety completion

Priority: **P0**

Already completed at this checkpoint:

- PR #47: Cloudflare production-credential boundary for PR workflows;
- PR #48: atomic public catalog D1 publication artifact.

Remaining:

- protect `main`;
- required quality checks;
- deliberate review/merge policy;
- third-party Actions version/pinning review;
- production migration parity verification;
- rollback and backup/export runbook;
- remove or govern stale privileged workflows;
- decide lifecycle of retained smoke resources.

Definition of Done:

- ordinary PR code cannot execute privileged production mutation paths;
- merge to `main` requires the agreed quality gates;
- rollback path exists for code and catalog publication;
- production schema state can be verified deliberately.

---

# M2 — Separate application deployment from catalog publication

Priority: **P0**

Target application pipeline:

`commit -> PR -> quality -> build -> merge -> deploy Worker/assets -> smoke`

Target data pipeline:

`source -> scan/delta -> normalize -> validate -> publication -> D1 verify`

Deliverables:

- remove public catalog rebuild/mutation from ordinary code deploy;
- independent catalog publication workflow/job;
- build/verify before production application mutation;
- no CSS/Worker-only change can rewrite catalog data;
- clarify full-recovery tooling vs normal sync tooling;
- stop routine commercial-data changes from requiring direct push to `main`.

Definition of Done:

Changing a customer-facing CSS token or Worker route cannot rebuild, delete or republish catalog data.

---

# M3 — Design Foundation and frontend architecture

Priority: **P1 — early, cross-cutting**

Goal: redesign customer-facing product surfaces on a single responsive/accessibility system before more UI is built.

Deliverables:

## Design audit

Inventory and classify every current surface/component:

- storefront shell/header/navigation;
- search/category discovery;
- product grid/card/gallery/detail/dialog;
- filters/facets;
- loading/empty/error states;
- portal shell/navigation/store list/overview;
- onboarding/progress;
- CEI review states;
- appearance/domain/billing/account states;
- mobile/tablet/desktop behavior.

Each existing element becomes `KEEP`, `IMPROVE`, `REBUILD`, `REMOVE` or `CREATE`.

## Library architecture

Re-evaluate approved dependencies against the post-audit architecture.

Evaluate by responsibility, not popularity:

- iconography;
- UI primitives/dialog/drawer/menu;
- motion;
- gallery/carousel;
- fuzzy/server/hybrid search;
- forms/schema validation;
- admin tables/virtualization only if complexity proves need;
- E2E/accessibility tooling.

No framework migration solely for convenience. If portal complexity later objectively justifies React or another framework, that requires its own architecture decision and migration plan.

## Design system

Define tokens and primitives for:

- typography;
- spacing;
- containers/grid;
- semantic colors;
- surfaces/borders/elevation;
- radius;
- focus;
- motion;
- icons;
- buttons/inputs/selects;
- cards;
- dialogs/drawers;
- status/badges;
- skeleton/loading;
- empty/error states;
- responsive layout rules.

## Responsive quality contract

Validate at representative widths including:

- 320;
- 360;
- 390;
- 430;
- 768;
- 1024;
- 1280;
- 1440;
- 1920+.

Components should prefer intrinsic sizing/container behavior where appropriate rather than accumulating arbitrary viewport-specific fixes.

Definition of Done:

- design tokens exist and are used by new customer-facing work;
- responsive/component rules are documented;
- library ownership is explicit;
- no essential action depends on hover;
- reduced motion and focus behavior are defined;
- customer-facing feature DoD includes mobile/touch/keyboard/loading/empty/error/accessibility.

---

# M4 — Source/provider engine

Priority: **P1**

Goal: make Yupoo the first adapter rather than the architecture boundary.

Create a source-neutral provider contract equivalent to:

- validate source;
- discover scopes/categories;
- listing scan;
- detail fetch;
- evidence normalization;
- stable identity/fingerprint;
- media evidence extraction;
- provider-safe retry/routing rules.

Introduce a normalized evidence record consumed by CEI and sync logic.

Definition of Done:

A future second provider can produce normalized evidence without changing CEI classification semantics.

---

# M5 — Tenant import / queue activation

Priority: **P1**

Goal: turn existing inert queue-oriented import code into proven isolated tenant ingestion.

Deliverables:

- create/configure scan and detail Queue resources;
- queue producer/consumer bindings;
- dedicated scan Worker;
- detail consumer;
- finalize barrier;
- bounded concurrency/retry/backoff;
- leases/idempotent duplicate delivery;
- dead-letter/recovery strategy;
- tenant-private source resolution;
- two-tenant isolation test;
- operational counters and safe error codes.

Definition of Done:

`create tenant -> connect Yupoo source -> isolated D1 import completes automatically`

without one GitHub Action or manual Cloudflare operation per customer.

---

# M6 — CEI Core + Sports Knowledge Pack v1

Priority: **P1 / product moat**

Goal: evolve the current sports classifier into a source-neutral intelligence core while keeping launch scope realistic.

CEI Core launch capabilities:

- normalized evidence schema;
- context/domain detection;
- Knowledge Pack interface;
- entity/attribute resolution;
- confidence representation;
- semantic conflict representation;
- versioned classification;
- merchant overrides;
- verification;
- merchandising output;
- tenant memory boundary;
- schema-validated persistence.

Sports Knowledge Pack v1:

- competition/league entities;
- clubs/national teams;
- product types;
- audience/version/style facets;
- season/year evidence where reliable;
- ambiguity rules;
- merchandising hierarchy;
- review thresholds.

Important launch rule:

Universal autonomous research is not required for CEI v1. Research architecture may be introduced behind explicit experimental/escalation boundaries after deterministic Sports v1 quality is measurable.

Definition of Done:

- CEI consumes normalized evidence rather than Yupoo objects;
- supplier folder structure is evidence, not public truth;
- merchant overrides survive reruns;
- low-confidence/conflicting cases surface instead of being guessed;
- classification and merchandising quality is covered by regression fixtures.

---

# M7 — Intelligent Sync v2

Priority: **P1**

Deliverables:

- per-tenant sync scheduling;
- lightweight listing comparison;
- delta detail fetch;
- NEW/CHANGED/MOVED/RESTORED/removal semantics;
- incomplete scan never means delete;
- repeated miss rules where applicable;
- catastrophic-diff circuit breaker;
- suspicious-run quarantine;
- last-known-good preservation;
- idempotent retries;
- CEI reprocessing only for affected products/knowledge;
- change/review feed;
- safe state/cursor promotion after verification.

Catastrophic guard example:

A complete scan dropping from ~17k products to a few hundred should enter `suspicious/review` rather than automatically deleting the missing majority.

Definition of Done:

A supplier outage, malformed scan or abnormal result cannot silently destroy a healthy published catalog.

## M7 approved execution ledger

The table below is the canonical M7 slice order. Detailed behavior and safety invariants remain owned by `TENANT-SYNC.md`; production evidence remains owned by `CURRENT-STATE.md` and focused closure records.

| Slice                                                  | Status                                                             | Bounded outcome                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| M7A — Sync safety decision                             | **PRODUCTION GREEN**                                               | Preserve/quarantine partial, unhealthy or implausible scans before destructive delta reasoning.       |
| M7B — Recurring scheduler foundation                   | **PRODUCTION GREEN — foundation disabled**                         | Durable per-tenant schedule/job foundation with recurring automation still off.                       |
| M7C1 — Shared listing delta                            | **PRODUCTION GREEN**                                               | One provider-neutral NEW/CHANGED/MOVED/RESTORED/MISSING/REMOVED contract.                             |
| M7C2 — Incremental planning                            | **PRODUCTION GREEN — read-only foundation**                        | Read paginated private LKG and calculate a safe plan without canonical mutation.                      |
| M7C3 — Private staged sync state                       | **PRODUCTION GREEN — listing foundation**                          | Assemble listing/delta state privately while LKG remains authoritative.                               |
| M7C4 — Schema v5 fleet activation                      | **PRODUCTION GREEN**                                               | Additive ready-tenant fleet migration for listing-stage storage.                                      |
| M7D1 — Candidate State Schema v6                       | **PRODUCTION GREEN**                                               | Private relational storage for candidate detail, media, CEI and merchandising, still inert.           |
| M7D2 — Controlled Enrollment and Scheduling Guard      | **PRODUCTION GREEN**                                               | Default-disabled tenant/source enrollment, per-cycle limits, kill switch and conflict-safe selection. |
| M7D3 — Incremental Dispatch and Scan-to-Stage          | **PRODUCTION GREEN**                                               | Live dispatcher/Queue incremental scan safely reaches private `details_pending` stage with LKG intact.|
| M7D4 — Staged Affected Detail                          | **PRODUCTION GREEN**                                               | Fetch and stage detail/media only for events that require it, with bounded idempotent retry.          |
| M7D5 — Affected-only CEI Candidate Processing          | **PRODUCTION GREEN**                                               | Reprocess only affected candidates while preserving merchant overrides and generic CEI boundaries.    |
| M7D6 — Candidate Verification                          | **PRODUCTION GREEN**                                               | Verify the complete candidate view, counts, relationships, media, CEI and privacy before promotion.   |
| M7D7 — Promotion Authority Primitive                   | **PLANNED — architecture decision complete / implementation next** | Implement the measured bounded set-based D1 transaction so readers see only old or new complete state. |
| M7D8 — Verified Promotion and Cursor Commit            | **PLANNED**                                                        | Promote verified state idempotently and advance cursor/schedule only after the authority switch.      |
| M7D9 — Repeated Miss and Safe Removal                  | **PLANNED**                                                        | Apply authoritative repeated-miss, multi-scope membership, removal and restoration semantics.         |
| M7D10 — Recovery, Replay and Operational Observability | **PLANNED**                                                        | Close crash, lease, duplicate delivery, DLQ/replay and safe diagnostic paths.                         |
| M7D11 — Safe Change and Review Feed                    | **PLANNED — scope decision before customer UI**                    | Project promoted changes and exceptions through opaque, tenant-scoped, redacted events.               |
| M7E — Deliberate Activation                            | **DECISION REQUIRED**                                              | Activation-only change for an explicitly approved canary cohort and scheduler-owned production proof. |

M7D3 production closure is recorded in `M7D3-CLOSURE-2026-08-25.md`. The final scheduler-owned canary proved dispatcher discovery, zero manual Queue injection, private `details_pending` stage, clean queues and unchanged canonical/storefront state while `TENANT_SYNC_AUTOMATION_ENABLED` remained off.

M7D4 production closure is recorded in `M7D4-CLOSURE-2026-08-25.md`. Final trusted-main SHA `95d3f3ba76adf5638576b212ccd5c94113e0eaa5` passed exact-SHA Queue activation, application deploy and scheduler/dispatcher-owned affected-detail canary. The canary reached private `details_complete` with one complete affected candidate, two candidate media relationships, zero foreign-key findings, no manual Queue injection, clean Queue/DLQ backlogs and unchanged canonical LKG/storefront authority while recurring Intelligent Sync remained off.

M7D5 production closure is recorded in `M7D5-CLOSURE-2026-08-25.md`. Final trusted-main SHA `acf09a32b6ae357132df9b871225305e653d50aa` passed exact-SHA application deploy, Queue consumer activation and scheduler/dispatcher-owned cumulative affected-detail + affected-only CEI canary. The canary produced one private candidate classification and one private candidate intelligence record through classifier v3 / Sports Knowledge Pack v1, reapplied merchant override version 7, reported zero foreign-key findings, preserved canonical LKG/catalog/override/intelligence and storefront authority, used no manual Queue injection, returned clean Queue/DLQ backlogs and kept recurring Intelligent Sync off.

M7D6 production closure is recorded in `M7D6-CLOSURE-2026-08-25.md`. Final trusted-main SHA `c757b779e3822a360b1fff4594d8387b4c6fd6e5` passed exact-SHA Queue activation `32866176282`, application deploy `32866176706` and scheduler/dispatcher-owned cumulative candidate-verification canary `32866423144` / job `97862709090`. The canary reached private `stageState=verified` with `sync_candidate_verified_v1`, zero foreign-key findings, candidate navigation/merchandising verification metadata, merchant override version 7 preserved, no manual Queue injection, clean Queue/DLQ backlogs and unchanged canonical LKG/catalog/override/intelligence/storefront authority. Promotion, cursor advancement and removal activation remained false and recurring Intelligent Sync remained off.

M7D7 architecture decision is recorded in `M7D7-PROMOTION-AUTHORITY-DECISION-2026-08-25.md`. Real Cloudflare D1 run `32873067956` / job `97884460496` on SHA `581d73f27aa457be0b71685a38500bc3ff70615f` proved a 20,000-product / 40,000-media stress transaction with approximately 140,000 modeled canonical row changes in 1,374.0 ms wall / 436.537 ms internal SQL, complete rollback on forced batch failure and old-or-new-only concurrent reader observations. V1 therefore selects one bounded set-based D1 transaction as the authority switch; generation/pointer is rejected at this measured envelope. M7D7 implementation is still pending and must fail closed above the measured envelope rather than chunk canonical serving writes.

M7D2 through M7D11 must remain separate implementation claims unless a later documentation decision proves a safer decomposition. M7E may not contain feature code or migrations. `TENANT_SYNC_AUTOMATION_ENABLED` remains `0` until the M7E decision and complete production proof.

M7 is complete only when the safe recurring path is connected end to end, recovery is proven, the agreed review-feed scope is delivered and M7E passes on the exact trusted-main code. Schema or scheduler foundations alone do not close M7.

---

# M8 — Media Engine hardening

Priority: **P1**

Target request path:

`storefront -> opaque media ID -> tenant media registry -> validated upstream -> Cloudflare cache -> response`

Deliverables:

- HTTPS-only upstream validation;
- strict host allowlist/provider policy;
- manual redirects;
- validate every redirect hop;
- redirect count limit;
- timeout/abort;
- Content-Length/stream byte guard;
- image content-type validation;
- safe referer/provider behavior;
- cache policy and fallback;
- placeholder/error UX;
- optional R2/Cloudflare Images decision based on reliability/cost/transform needs rather than product count alone.

Definition of Done:

Media upstream behavior cannot escape the trust boundary or make ordinary storefront rendering depend on unsafe redirects/unbounded downloads.

---

# M9 — Storefront UX 2.0

Priority: **P1 / visible product value**

This is a full product-experience redesign, not a CSS facelift.

Deliverables:

- shared storefront shell;
- premium responsive header/navigation;
- search experience;
- category/entity discovery;
- responsive product grid;
- product card redesign;
- quick view where it improves discovery;
- product detail route/experience;
- mobile-first media gallery;
- filters/facets/sort;
- collections/new/featured merchandising;
- loading skeletons;
- empty/error states;
- share/contact/merchant CTA;
- browser history/deep links;
- SEO metadata/Open Graph/canonical behavior;
- accessibility/keyboard/touch behavior;
- performance budgets.

Representative product-grid behavior should be intentionally designed across phone/tablet/desktop rather than fixed to one desktop column count.

Definition of Done:

A user receiving a merchant storefront link without context perceives a professional retail experience, not an imported supplier catalog or internal tool.

---

# M10 — Theme and Brand Engine

Priority: **P1**

Goal: let different stores feel genuinely branded without arbitrary code execution.

Tenant-controlled configuration can include:

- logo/brand assets;
- semantic brand colors;
- supported typography choices;
- density/radius presentation controls;
- hero/banner content;
- home section order/visibility;
- public contact/CTA;
- controlled storefront presets.

Potential preset families may include editorial, commerce, street and minimal directions, but names/content remain design decisions until implemented.

Definition of Done:

Two tenants can use the same platform/runtime and visibly express different merchant brands while staying inside the maintained responsive/accessibility system.

---

# M11 — Customer Portal UX 2.0

Priority: **P1**

Goal: make `app.catalogoengine.com` the merchant's simple operational home.

Primary launch information architecture:

- Minhas lojas;
- Visão geral;
- Catálogo;
- Alterações/Revisão;
- Aparência;
- Fonte/Integrações;
- Domínio;
- Plano e cobrança;
- Conta.

Overview must answer:

`Minha loja está funcionando? O Catalog Engine está trabalhando por mim? Preciso fazer alguma coisa?`

Deliverables include responsive mobile navigation and action-oriented status, not decorative dashboard charts.

Definition of Done:

A merchant can understand store/catalog/domain/sync health without seeing D1, Worker, namespace, migration or provider-internal terminology.

---

# M12 — CEI Review Experience

Priority: **P1**

Goal: convert CEI uncertainty into simple merchant decisions.

Examples:

- ambiguous team/entity choice;
- unclear product type;
- conflicting evidence;
- merchant-specific public naming;
- technical claim requiring explicit confirmation.

Rules:

- review exceptions, not thousands of products;
- explain the decision needed in merchant language;
- save confirmed merchant decisions as durable tenant memory/override;
- show confidence only when it improves decisions; do not expose raw internal reasoning.

Definition of Done:

CEI uncertainty becomes a short actionable queue rather than hidden wrong classification or technical logs.

---

# M13 — Authentication, accounts and memberships

Priority: **P1**

Deliverables:

- production identity-provider decision/configuration;
- OIDC/JWT boundary wired end-to-end;
- principal -> account -> membership -> tenant authorization;
- owner role required at minimum;
- role model remains compatible with admin/editor/viewer;
- recovery/login/session UX;
- audit-sensitive mutations;
- cross-tenant authorization regression tests.

Definition of Done:

A real merchant can sign in, see only authorized stores and cannot obtain another tenant by modifying client-provided identifiers.

---

# M14 — Billing, trial and entitlements

Priority: **P1**

The existing documents currently encode payment-before-store. Post-audit product strategy should deliberately decide whether launch uses a controlled trial before public publication.

Recommended hypothesis to test:

- account can receive a bounded trial entitlement;
- one store/source/private preview may be allowed during trial;
- public custom-domain publication and continuous service require paid entitlement;
- exact trial duration/limits remain configurable commercial policy.

Deliverables:

- billing provider selection;
- billing customer/subscription mirror;
- normalized states including `trialing` if adopted;
- trusted webhook/event verification;
- reconciliation;
- entitlement evaluation;
- store/source/feature limits;
- grace/suspension/reactivation;
- cancellation/paid-through behavior;
- billing recovery UI;
- auditable pilot/admin grants rather than hard-coded bypasses.

Definition of Done:

Product permissions derive from trusted normalized entitlement state, never a browser claim.

---

# M15 — Onboarding Experience

Priority: **P1 / conversion-critical**

Target merchant journey:

`account -> create store -> connect source -> real progress -> private preview -> brand -> domain/payment gate as policy requires -> publish`

Progress must use real durable stages, never fake percentages.

Desired merchant language can include:

- source found;
- products detected;
- segment understood;
- organizing products;
- preparing preview;
- needs attention;
- waiting for domain;
- publishing.

The user may leave and return while long jobs continue.

Definition of Done:

A merchant can reach first useful private preview without owner-operated Cloudflare/GitHub steps.

---

# M16 — Self-service provisioning orchestration

Priority: **P1**

Wire portal actions to the already-modeled durable lifecycle:

`entitlement -> tenant -> profile -> source -> data plane -> migrations -> import -> classify -> verify/private preview -> runtime/domain -> publish`

Exact implementation checkpoints must stay idempotent/resumable.

Deliverables:

- portal/API orchestration;
- retry/resume;
- safe customer-visible progress;
- no duplicate resources on repeat/double-submit;
- operator-only exception path.

Definition of Done:

Normal store creation no longer requires the Catalog Engine owner to create tenant infrastructure manually.

---

# M17 — Domain and publication UX

Priority: **P1**

Backend domain/runtime/publish gates are already substantially implemented/proven; this milestone turns them into a sellable merchant journey.

Flow:

`enter domain -> exact DNS instruction -> automatic checks -> certificate/hostname ready -> runtime/store smoke -> final publish`

Deliverables:

- simple domain entry;
- exact actionable DNS record;
- automatic refresh/poll state;
- customer-friendly status/error handling;
- verified runtime/domain publish gate;
- public/live confirmation;
- disconnect/change-domain lifecycle.

Definition of Done:

Merchant domain publication works without exposing Cloudflare internals or requiring routine owner intervention.

---

# M18 — Observability and operations

Priority: **P1 before beta**

Correlate operations using identifiers such as:

- request ID;
- tenant ID;
- provisioning run ID;
- import/sync ID;
- CEI/classifier version;
- publish job/runtime version.

Deliverables:

- structured safe logs;
- health metrics;
- job duration/failure/retry metrics;
- tenant-isolated diagnostics;
- alert thresholds;
- operator runbooks;
- fleet view appropriate for initial scale.

Definition of Done:

An operator can answer why tenant X failed to import/sync/publish without exposing or inspecting unrelated tenant private data.

---

# M19 — Security hardening

Priority: **P1 before beta**

Review/test:

- authentication/authorization/IDOR;
- SSRF/media/source URL boundaries;
- CORS;
- CSP/security headers;
- XSS/supplier-controlled text;
- secrets/token permissions;
- rate limiting/abuse;
- webhook signatures;
- tenant routing;
- audit events;
- dependency/supply-chain policy;
- data retention/deletion boundaries.

Definition of Done:

No known high-severity launch blocker remains and security-sensitive flows have regression tests or documented operational controls.

---

# M20 — Performance, accessibility and browser E2E

Priority: **P1 launch gate**

Tooling should include browser E2E capability; Playwright is allowed as test infrastructure when selected, even though browser automation remains fallback-only for supplier scraping.

Test matrix includes representative:

- iPhone-size viewport/device behavior;
- Android-size behavior;
- tablet;
- laptop/desktop;
- 1440/1920+ layouts;
- Safari/WebKit-equivalent coverage;
- Chromium;
- Firefox where practical.

Test:

- signup/session;
- onboarding;
- storefront navigation/search/product;
- refresh/deep links/back-forward;
- CEI review;
- appearance;
- domain;
- billing recovery;
- publish;
- responsive touch/keyboard behavior.

Accessibility includes automated checks plus manual focus/dialog/menu review.

Initial Core Web Vitals targets should follow current web-good thresholds where measurable, with product-specific budgets documented once instrumentation is active.

Definition of Done:

The product has repeatable browser evidence rather than screenshots/manual confidence only.

---

# M21 — Commercial landing and launch funnel

Priority: **P2 until product path works; P1 before launch**

Build `catalogoengine.com` around real product evidence:

- hero/value proposition;
- before/after transformation;
- how it works;
- CEI in merchant language;
- automation/recurring value;
- real demo store(s);
- plans;
- FAQ;
- factual trust/security/legal links;
- checkout/app handoff.

Never advertise an unimplemented provider/domain/CEI capability as available.

Definition of Done:

Landing claims correspond to production behavior and the CTA reaches the real entitlement/onboarding funnel.

---

# M22 — Closed beta

Priority: **launch P0**

Start with a small controlled cohort, approximately 3–5 real pilot merchants.

Measure:

- time to first preview;
- import success/failure;
- automatic classification rate;
- review/unknown/conflict rate;
- sync reliability;
- domain success time;
- mobile/portal usability;
- support interventions per tenant;
- trial/payment conversion if enabled;
- customer perception of storefront quality/value.

Definition of Done:

The platform has completed real merchant journeys with defects/operational gaps captured and prioritized.

---

# M23 — Beta-driven UX/product iteration

Priority: **launch P0**

Use evidence, not taste, to correct:

- onboarding friction;
- confusing language;
- CEI review burden;
- mobile layout problems;
- storefront discovery issues;
- domain setup friction;
- billing objections/recovery;
- theme limits;
- support-heavy operational steps.

Do not widen V1 source/domain scope unless beta evidence proves it is a launch blocker.

---

# M24 — Release Candidate

Priority: **launch P0**

Feature freeze except blockers/security/performance.

Prove end-to-end:

`signup/trial-or-payment -> entitlement -> store -> source -> import -> CEI -> preview -> appearance -> domain -> publish -> sync -> billing recovery/reactivation`

Also prove:

- rollback;
- backup/recovery;
- tenant isolation;
- production smoke;
- E2E browser matrix;
- legal/commercial minimums;
- monitoring/alerts;
- support/runbook readiness.

---

# M25 — Public Launch

Launch condition:

A merchant who has never spoken with the Catalog Engine operator can understand the offer, obtain the allowed entitlement, create a store, connect a supported catalog, receive an organized private preview, customize the brand, connect/publish the domain and remain synchronized without routine manual GitHub/Cloudflare operation by the Catalog Engine owner.

If that condition is not true, the product is still assisted service/infrastructure rather than the intended self-service SaaS.

---

## Immediate execution order from this document

1. Execute M7D7 using the accepted bounded set-based D1 transaction architecture. M7D6 is Production Green and the M7D7 architecture gate is complete.
2. After M7D7 itself is Production Green, execute M7D8 so cursor/schedule/control metadata commits only after durable promoted authority.
3. Execute M7D9 recovery-safe removal semantics and M7D10 recovery/replay/observability.
4. Resolve the M7D11 backend/UI scope decision and deliver the approved safe change/review-feed boundary.
5. Execute M7E only after explicit cohort, operational-limit and activation approval; keep recurring sync off until then.
6. Decompose M8 in a planning PR immediately before M8 execution. Any names such as M8A/M8B remain **PROPOSED** until that PR merges.
7. Decompose M9 the same way immediately before Storefront UX 2.0 execution. Any names such as M9A/M9B remain **PROPOSED** until that PR merges.
8. Continue M10 -> M17 as the productization path, decomposing each macro milestone before implementation where more than one bounded PR is required.
9. Finish remaining M1 governance debt through focused safety PRs without displacing the active milestone unless it becomes a blocker.
10. Do not enter closed beta before M18-M20 launch gates are materially complete.