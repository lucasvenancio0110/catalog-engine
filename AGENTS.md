# Catalog Engine — Engineering Rules

These rules apply to all human and AI contributors working in this repository.

## Dependency policy

Use the smallest approved library that owns the problem. Do not add a second package for a responsibility already covered below unless there is a documented technical reason and a migration plan.

### Approved runtime libraries

- **Cheerio** — HTML/XML parsing and DOM querying in Node.js. Use it for Yupoo/static HTML extraction. Do not add jsdom for static parsing.
- **PQueue** — concurrency, backpressure and request/task rate limiting. Use it instead of hand-written promise pools or unbounded `Promise.all()` for network/image batches.
- **Zod** — validation at trust boundaries: external HTML-derived data, store configuration, generated catalog JSON and future API payloads. Do not publish or persist unvalidated structured data.
- **Sharp** — image metadata, validation, resize, conversion and optimization. Do not implement image transformations manually or shell out to ImageMagick without a documented exception.
- **Fuse.js** — storefront fuzzy search and relevance ranking. Do not add a second client-side search library while the catalog remains local/static.
- **Swiper** — product media gallery and touch navigation. Do not hand-roll swipe gesture logic for product images.
- **Motion** — purposeful, subtle storefront microinteractions. Respect reduced-motion preferences and do not use animation as decoration that harms clarity/performance.

### Approved build and quality libraries

- **Vite** — storefront dev server and production bundler. Browser npm dependencies must be imported through the Vite module graph, not from arbitrary public CDNs.
- **Vitest** — automated JavaScript tests. New parsing/classification/business rules require tests.
- **ESLint** — correctness/static-analysis rules. Fix lint violations instead of suppressing them unless the suppression has an explanatory comment.
- **Prettier** — formatting. Do not create competing formatting conventions.

Do not add React/Vue/Svelte/Angular solely for UI convenience. The storefront remains framework-agnostic until product complexity objectively justifies a framework migration.

## Vite/storefront rules

1. Keep `base: './'` while one artifact must remain portable across GitHub Pages, custom domains and future tenant subpaths.
2. Source code belongs under `src/`; generated supplier/catalog data remains outside the Vite module graph.
3. `data/catalog.json` and authorized media are staged into `dist/` only after the Vite build.
4. The public `dist/` must pass `npm run build:verify` before deployment.
5. `dist/` must never contain supplier hostnames, source URLs, source credentials or private sync state.
6. Do not commit `dist/` or `node_modules/` as application source.
7. Product search uses Fuse.js, media navigation uses Swiper, and motion uses Motion unless this policy is explicitly changed with a documented reason.
8. Supplier-derived text rendered in the storefront must use `textContent`/safe DOM construction. Do not place supplier-controlled names/descriptions into `innerHTML`.
9. Storefront taxonomy navigation must hide empty branches instead of rendering the supplier's entire taxonomy tree with zero-product categories.
10. Selecting a parent category must include products belonging to all descendants; selecting a leaf must restrict to that branch without relying on string-name matching.

## Native-first rule

Prefer Node.js/Web Platform APIs when they are already robust enough. Examples: `fetch`, `URL`, `AbortController`, `fs/promises`, `path`, `crypto`, `Intl`.

Do not add Axios/Got only to replace native `fetch`. Do not add Lodash for trivial array/object operations. Do not add UUID/slug/date libraries when native APIs cover the requirement cleanly.

## Scraper rules

1. Never use unbounded concurrency against a supplier.
2. Network/image batches must use PQueue with explicit concurrency and rate policy.
3. Retry logic must be bounded and must treat 429/5xx as transient.
4. Parse static HTML with Cheerio first. Browser automation is fallback-only when server HTML does not expose required data.
5. Every item must be classified before expensive image work.
6. Supplier URLs and sensitive source state must never be emitted into the public storefront artifact.
7. A product with incomplete downloaded media must not overwrite a previously healthy public product.
8. Yupoo routing quirks such as `isSubCate=true` must be resolved by the source adapter/resolver. Callers and future customers must not need provider-specific query-string knowledge.

## Synchronization rules

1. **A partial scan may never infer deletion.** `not observed` is not equivalent to `removed`.
2. Every synchronized source view is an explicit opaque **scope** (`catalog`, `category`, or future source scope). Pagination/query noise must normalize to the same scope identity.
3. Provider-routing parameters such as Yupoo `isSubCate`, pagination, tab, uid and referrer metadata must not create duplicate logical scope identities.
4. `REMOVED` is allowed only when the current scope is explicitly complete, the run has no extraction/media failures, and the product has no remaining membership in any other active scope.
5. A complete category scan may detach a product from that category without removing it from the store if another scope still owns it.
6. During partial scans, previously active but unobserved products and their scope memberships remain published and active.
7. A category scan must never replace the global source taxonomy tree. Only a complete `catalog` scope may authoritatively replace the private source taxonomy; other scopes merge into it.
8. Public product/category/scope IDs must be opaque stable IDs; never expose raw supplier album/category IDs in `catalog.json`, asset paths, sync state or `dist/`.
9. Raw source IDs, source URLs and source image URLs belong only in ignored/private source state.
10. Persistent `data/sync-state.json` may contain only opaque public IDs, hashes, timestamps, statuses, opaque scope memberships and change summaries. It must not contain supplier URLs or raw supplier IDs.
11. NEW/UPDATED/RESTORED are computed from stable identity + content fingerprints. Scope detachment and global removal are distinct events.
12. Confirmed global removals may delete public media only after all active scope memberships are gone.
13. Schema/state migrations must preserve active products safely and explicitly retire any legacy holding scope only when an authoritative complete catalog scan makes that safe.
14. Sync behavior changes require tests for NEW, UPDATED, RESTORED, partial UNOBSERVED, scope DETACHED, cross-scope preservation and final global REMOVED.
15. Daily sync is incremental. Expensive product detail requests are limited to the delta queue; full detail re-import is recovery tooling, not the default schedule.
16. Incomplete/temporarily broken supplier albums use bounded retry and backoff and must not be re-fetched indefinitely on every run.

## Public taxonomy rules

1. **Supplier taxonomy is evidence, not public truth.** Preserve the provider hierarchy privately for diagnostics/sync scope, but publish Catalog Engine's canonical merchandising taxonomy.
2. Canonical classification may use weighted evidence from product content, source path, aliases, known entities, competition/team dictionaries and explicit rules. Product evidence may override a wrong supplier folder.
3. Ambiguous team/entity/competition matches must become `review` or `unknown`; do not force a confident-looking wrong classification.
4. Raw category IDs and raw category URLs may exist only during extraction/private source processing. Public taxonomy uses opaque `c_<hash>` IDs only.
5. Public categories must expose only safe storefront fields such as `id`, `name`, opaque `parentId`, opaque `childIds` and `depth`.
6. Parent/child relationships must be reciprocal and acyclic in published data; `npm run taxonomy:audit` is mandatory after taxonomy changes/imports.
7. Products must carry an opaque canonical `categoryId`/path and may additionally carry team, league and facet references. Supplier category membership is not a competing public category system.
8. Unique-name matching is a controlled fallback only. Ambiguous names such as `United`, `City` or `Inter` must not be guessed without enough evidence.
9. Unmatched products use a stable opaque fallback/review state rather than leaking raw provider taxonomy.
10. Source category scans may enrich private evidence but cannot directly delete or redefine unrelated canonical public branches.
11. Public taxonomy schema changes require schema/version updates or documented backward compatibility plus regression tests.
12. Manual classification overrides are durable business data and must survive source sync/reclassification unless explicitly cleared by an authorized admin action.

## SaaS tenancy rules

1. Build features for a **tenant**, even while only `t_00000000000000000001` exists.
2. Keep a logical separation between the low-volume **control plane** (tenant/account/store/domain/source configuration) and the high-volume **tenant data plane** (products, taxonomy, media, private source index and sync state).
3. The intended scale model is an isolated catalog data plane per tenant (for example one D1 database per tenant or another explicitly isolated shard), rather than relying on a tenant predicate in every storefront product query.
4. Control-plane schemas may temporarily live in the current D1 during migration, but must remain portable to a future dedicated `CONTROL_DB`.
5. Never create unauthenticated admin write endpoints. Future admin mutations require an authenticated opaque principal, tenant membership/role checks and audit logging.
6. Do not store customer passwords in Catalog Engine. Identity comes from an authentication layer; Catalog Engine stores only opaque principal IDs and authorization metadata.
7. Tenant branding must be validated before persistence. Customer-selected themes are controlled presets/components, not arbitrary uploaded JavaScript or HTML.
8. Supplier URLs/credentials/private source state remain private tenant configuration and must never be returned by public storefront APIs.
9. A custom hostname belongs to only one tenant and is not activated until verified.
10. Provisioning must be idempotent and resumable: tenant -> profile -> source -> data plane -> migrations -> import -> classification -> smoke test -> publish.
11. A failed tenant sync/provisioning job must not corrupt another tenant or block unrelated tenants.
12. See `docs/SAAS-ARCHITECTURE.md` before changing tenancy, provisioning, domains or authentication boundaries.

## Data rules

1. Validate external/generated JSON with Zod before persistence or publication.
2. Public catalog schema changes require a `schemaVersion` increment or documented backward compatibility.
3. Generated data is not the source of truth for architecture decisions.
4. White-label public data must not contain supplier hostnames, source image URLs or source credentials.

## Image rules

1. Validate image decodability with Sharp.
2. Keep original-quality intent, but create web-optimized derivatives before large-scale rollout.
3. Do not duplicate identical media when a content-hash strategy can reuse it.
4. Object storage/CDN is required before the catalog scales materially beyond the repository MVP limit.

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

For crawler/import/sync/taxonomy changes, also run a real isolated crawl and then:

```bash
npm run audit
npm run sync:audit
npm run taxonomy:audit
```

A feature is not complete because it works once. It is complete when its behavior is tested, its output is validated, and its failure mode is understood.
