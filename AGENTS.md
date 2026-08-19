# Catalog Engine — Engineering Rules

These rules apply to all human and AI contributors working in this repository.

## Mandatory document-read protocol

Documentation is part of the implementation contract.

Before changing or adding anything in this repository, contributors must:

1. read this `AGENTS.md`;
2. read `docs/DOCUMENT-GOVERNANCE.md`;
3. read `docs/DOCUMENT-MAP.md`;
4. read every document mapped to the affected product/technical area;
5. for material product/architecture work, inspect `docs/CURRENT-STATE.md` and the relevant milestone in `docs/DEVELOPMENT-ROADMAP.md`;
6. compare the proposed change with documented invariants before coding;
7. update the owning document in the same PR when the intended behavior changes;
8. never silently implement a decision that contradicts current documentation.

If a new product decision should replace an old instruction, change the instruction deliberately and explain that change in the PR. Code and documentation must merge together when they define the same behavior.

For every change ask: **which tenant/account owns this, which documented contract does it touch, and does it introduce manual per-customer work that should be automated?**

## Dependency policy

Use the smallest approved library that owns the problem. Do not add a second package for a responsibility already covered below unless there is a documented technical reason and a migration plan.

### Approved runtime libraries

- **Cheerio** — HTML/XML parsing and DOM querying in Node.js. Use it for Yupoo/static HTML extraction. Do not add jsdom for static parsing.
- **PQueue** — concurrency, backpressure and request/task rate limiting. Use it instead of hand-written promise pools or unbounded `Promise.all()` for network/image batches.
- **Zod** — validation at trust boundaries: external HTML-derived data, store configuration, generated catalog JSON and future API payloads. Do not publish or persist unvalidated structured data.
- **Sharp** — image metadata, validation, resize, conversion and optimization. Do not implement image transformations manually or shell out to ImageMagick without a documented exception.
- **Fuse.js** — currently approved for typo-tolerant client-side search when that architecture is appropriate. Do not add a second client-side search library while Fuse owns that responsibility; server/hybrid search may replace the client-side architecture through an explicit documented decision.
- **Swiper** — product media gallery and touch navigation. Do not hand-roll swipe gesture logic for product images without a documented reason.
- **Motion** — purposeful, subtle storefront/portal microinteractions. Respect reduced-motion preferences and do not use animation as decoration that harms clarity/performance.

### Approved build and quality libraries

- **Vite** — storefront/portal dev server and production bundler. Browser npm dependencies must be imported through the Vite module graph, not from arbitrary public CDNs.
- **Vitest** — automated JavaScript tests. New parsing/classification/business rules require tests.
- **ESLint** — correctness/static-analysis rules. Fix lint violations instead of suppressing them unless the suppression has an explanatory comment.
- **Prettier** — formatting. Do not create competing formatting conventions.

Do not add React/Vue/Svelte/Angular solely for UI convenience. The customer-facing frontend remains framework-agnostic until product complexity objectively justifies a framework migration through an explicit architecture decision and migration plan.

UI/developer-tool dependencies must also follow `docs/DESIGN-SYSTEM.md` and `docs/JAVASCRIPT_LIBRARIES.md`.

## Vite/storefront rules

1. Keep `base: './'` while one artifact must remain portable across the currently supported deployment/custom-domain paths unless a documented routing change deliberately replaces this requirement.
2. Source code belongs under `src/`; generated supplier/catalog data remains outside the Vite module graph.
3. `data/catalog.json` and authorized media/data artifacts are staged into `dist/` only after the Vite build where that compatibility path remains active.
4. The public `dist/` must pass `npm run build:verify` before deployment.
5. `dist/` must never contain supplier hostnames, source URLs, source credentials or private sync state.
6. Do not commit `dist/` or `node_modules/` as application source.
7. Fuse.js owns current client-side fuzzy-search behavior where used, Swiper owns current product-gallery swipe behavior, and Motion owns purposeful microinteractions unless the dependency policy is explicitly changed with a documented reason.
8. Supplier-derived text rendered in the storefront must use `textContent`/safe DOM construction. Do not place supplier-controlled names/descriptions into `innerHTML`.
9. Storefront taxonomy navigation must hide empty branches instead of rendering the supplier's entire taxonomy tree with zero-product categories.
10. Selecting a parent category must include products belonging to all descendants; selecting a leaf must restrict to that branch without relying on string-name matching.
11. Customer-facing storefront work must follow the responsive/accessibility/state contract in `docs/DESIGN-SYSTEM.md`.

## Customer-facing UX quality rules

For storefront, portal, onboarding, CEI review, appearance, domain, billing and other merchant-facing work:

1. A feature is incomplete until applicable desktop, phone, touch, keyboard/focus, loading, empty and error states are intentionally handled.
2. No essential action may require hover.
3. Motion must respect `prefers-reduced-motion`.
4. Interactive controls require visible focus and semantic/accessible labeling.
5. Mobile may use a different interaction pattern from desktop; do not merely shrink desktop navigation/sidebars.
6. Test representative narrow and wide widths defined by `docs/DESIGN-SYSTEM.md`; verification widths are not a requirement to create a media query at each width.
7. Customer-facing errors must not expose stack traces, D1/provider IDs, Worker names, private source URLs or provider-secret detail.
8. Long-running backend progress must reflect durable real stages/status; never invent fake percentages.
9. Major customer journeys must eventually have browser E2E coverage before public launch.

## Native-first rule

Prefer Node.js/Web Platform APIs when they are already robust enough. Examples: `fetch`, `URL`, `AbortController`, `fs/promises`, `path`, `crypto`, `Intl`.

Do not add Axios/Got only to replace native `fetch`. Do not add Lodash for trivial array/object operations. Do not add UUID/slug/date libraries when native APIs cover the requirement cleanly.

## Scraper rules

1. Never use unbounded concurrency against a supplier.
2. Network/image batches must use PQueue with explicit concurrency and rate policy.
3. Retry logic must be bounded and must treat 429/5xx as transient.
4. Parse static HTML with Cheerio first. Browser automation is fallback-only when server HTML does not expose required data.
5. Browser automation used for E2E product testing is a separate concern and is not prohibited by the scraper fallback rule.
6. Every item must be classified before expensive image work where the active ingestion architecture makes that ordering applicable.
7. Supplier URLs and sensitive source state must never be emitted into the public storefront artifact.
8. A product with incomplete media/detail evidence must not overwrite a previously healthy public product unless a safe publication contract explicitly permits that transition.
9. Yupoo routing quirks such as `isSubCate=true` must be resolved by the source adapter/resolver. Callers and future customers must not need provider-specific query-string knowledge.

## Synchronization rules

1. **A partial scan may never infer deletion.** `not observed` is not equivalent to `removed`.
2. Every synchronized source view is an explicit opaque **scope** (`catalog`, `category`, or future source scope). Pagination/query noise must normalize to the same scope identity.
3. Provider-routing parameters such as Yupoo `isSubCate`, pagination, tab, uid and referrer metadata must not create duplicate logical scope identities.
4. `REMOVED` is allowed only when the current scope is explicitly complete, the run has no disqualifying extraction/media failures, and the product has no remaining membership in any other active scope.
5. A complete category scan may detach a product from that category without removing it from the store if another scope still owns it.
6. During partial scans, previously active but unobserved products and their scope memberships remain published and active.
7. A category scan must never replace the global source taxonomy tree. Only a complete `catalog` scope may authoritatively replace the private source taxonomy; other scopes merge into it.
8. Public product/category/scope IDs must be opaque stable IDs; never expose raw supplier album/category IDs in public catalog data, asset paths, sync state or `dist/`.
9. Raw source IDs, source URLs and source image URLs belong only in private source state.
10. Persistent public/repository sync state may contain only safe opaque IDs, hashes, timestamps, statuses, opaque scope memberships and change summaries. It must not contain supplier URLs or raw supplier IDs.
11. NEW/UPDATED/RESTORED are computed from stable identity + content fingerprints. Scope detachment and global removal are distinct events.
12. Confirmed global removals may delete/retire public media only after all active scope memberships are gone and the media lifecycle contract permits it.
13. Schema/state migrations must preserve active products safely and explicitly retire legacy state only when an authoritative safe boundary makes that valid.
14. Sync behavior changes require tests for NEW, UPDATED, RESTORED, partial UNOBSERVED, scope DETACHED, cross-scope preservation and final global REMOVED.
15. Daily/routine sync is incremental. Expensive product detail requests are limited to the delta/retry queue; full detail re-import is recovery tooling, not the default schedule.
16. Incomplete/temporarily broken supplier items use bounded retry/backoff and must not be re-fetched indefinitely on every run.
17. Abnormal complete-scan volume drops require a catastrophic-diff/suspicious-run guard before launch; a technically complete but implausible scan must not silently remove most of a healthy catalog.

## Public taxonomy rules

1. **Supplier taxonomy is evidence, not public truth.** Preserve the provider hierarchy privately for diagnostics/sync scope, but publish Catalog Engine's canonical merchandising taxonomy.
2. Canonical classification may use weighted evidence from product content, source path, aliases, known entities, competition/team dictionaries, Knowledge Packs and explicit rules. Product evidence may override a wrong supplier folder.
3. Ambiguous entity/competition/product matches must become `review` or `unknown`; do not force a confident-looking wrong classification.
4. Raw category IDs and raw category URLs may exist only during extraction/private source processing. Public taxonomy uses opaque stable IDs.
5. Public categories must expose only safe storefront fields such as ID, name and safe opaque relationships/metadata.
6. Parent/child relationships must be reciprocal and acyclic in published data; taxonomy audits remain mandatory after taxonomy changes/imports where the audit applies.
7. Products must carry canonical merchandising relationships and may additionally carry team, league and facet references. Supplier category membership is not a competing public category system.
8. Unique-name matching is a controlled fallback only. Ambiguous names such as `United`, `City` or `Inter` must not be guessed without enough evidence.
9. Unmatched products use a stable opaque fallback/review state rather than leaking raw provider taxonomy.
10. Source category scans may enrich private evidence but cannot directly delete or redefine unrelated canonical public branches.
11. Public taxonomy schema changes require schema/version updates or documented backward compatibility plus regression tests.
12. Manual classification/merchandising overrides are durable business data and must survive source sync/reclassification unless explicitly cleared by an authorized admin action.

## SaaS tenancy rules

1. Build features for a **tenant**, even while the default/original catalog exists as a compatibility tenant.
2. Keep a logical separation between the low-volume **control plane** (tenant/account/store/domain/source configuration) and the high-volume **tenant data plane** (products, taxonomy, media, private source index and sync state).
3. The intended scale model is an isolated catalog data plane per tenant (for example one D1 database per tenant or another explicitly isolated shard), rather than relying on a tenant predicate in every storefront product query.
4. Control-plane schemas may temporarily live in the current D1 during migration, but must remain portable to a future dedicated `CONTROL_DB`.
5. Never create unauthenticated admin write endpoints. Admin mutations require an authenticated opaque principal, tenant membership/role checks and audit logging.
6. Do not store customer passwords in Catalog Engine. Identity comes from an authentication layer; Catalog Engine stores only opaque principal IDs and authorization metadata.
7. Tenant branding must be validated before persistence. Customer-selected themes are controlled presets/components, not arbitrary uploaded JavaScript or HTML.
8. Supplier URLs/credentials/private source state remain private tenant configuration and must never be returned by public storefront APIs.
9. A custom hostname belongs to only one tenant and is not activated until verified.
10. Provisioning must be idempotent and resumable in this canonical product order: entitlement -> tenant -> profile -> source -> data plane -> migrations -> import -> classification -> storefront verification/private preview -> runtime/domain readiness -> publish. Narrow implementation checkpoints may refine this order but may not silently bypass its trust/safety gates.
11. Successful provisioning steps are checkpoints and must not be replayed on retry. A failed step resumes at that step; a missing/unverified customer domain blocks publication without restarting import/classification.
12. Provisioning transition metadata must never contain supplier URLs, credentials, tokens, passwords or other private source state.
13. A failed tenant sync/provisioning job must not corrupt another tenant or block unrelated tenants.
14. Before changing tenancy, provisioning, domains, authentication or billing gates, read `docs/TENANCY.md`, `docs/SAAS-ARCHITECTURE.md` and every additional document required by `docs/DOCUMENT-MAP.md`.
15. The self-service store/tenant creation path must enforce account entitlements server-side; frontend visibility alone is never sufficient authorization to provision a tenant.

## Data rules

1. Validate external/generated JSON with Zod before persistence or publication.
2. Public catalog schema changes require a `schemaVersion` increment or documented backward compatibility.
3. Generated data is not the source of truth for architecture decisions.
4. White-label public data must not contain supplier hostnames, source image URLs or source credentials.
5. Application deployment and catalog-data publication are separate responsibilities; the roadmap requires decoupling them so ordinary code-only changes cannot mutate commercial catalog data.

## Image/media rules

1. Validate first-party image decodability with Sharp where images are downloaded/transformed by Catalog Engine.
2. Public media delivery must use opaque IDs and a validated delivery boundary; never expose private source URLs in public catalog APIs.
3. Do not duplicate identical media when a content-hash strategy can reuse it where Catalog Engine owns stored copies.
4. Media delivery strategy is provider-neutral. Valid strategies can include validated remote proxy + Cloudflare cache, R2, Cloudflare Images or a deliberate hybrid.
5. Do not require mass object-storage duplication solely because a catalog crossed an arbitrary product/image count. Choose storage/transform strategy from reliability, cost, legal/content and performance evidence.
6. Remote media proxying must validate HTTPS/upstream policy and, before launch, must enforce safe redirect-hop validation, bounded redirects, timeout and response-size/content-type limits.

## Quality gate

Before merging behavior changes:

```bash
npm ci
npm run deps:check
npm run test
npm run lint
```

For storefront/build changes also run:

```bash
npm run build
npm run build:verify
```

For crawler/import/sync/taxonomy changes, also run the relevant isolated real-source verification and applicable audits, for example:

```bash
npm run audit
npm run sync:audit
npm run taxonomy:audit
```

Customer-facing launch-critical work must additionally satisfy the browser/responsive/accessibility evidence required by `docs/DESIGN-SYSTEM.md` and the relevant `DEVELOPMENT-ROADMAP.md` milestone once that tooling is active.

A feature is not complete because it works once. It is complete when its behavior is tested, its output is validated, its documentation still matches, its responsive/failure states are understood where customer-facing, and its operational failure mode is understood.