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
7. A category scan must never replace the global taxonomy tree. Only a complete `catalog` scope may authoritatively replace the entire taxonomy; other scopes merge into it.
8. Public product/category/scope IDs must be opaque stable IDs; never expose raw supplier album/category IDs in `catalog.json`, asset paths, sync state or `dist/`.
9. Raw source IDs, source URLs and source image URLs belong only in ignored/private source state.
10. Persistent `data/sync-state.json` may contain only opaque public IDs, hashes, timestamps, statuses, opaque scope memberships and change summaries. It must not contain supplier URLs or raw supplier IDs.
11. NEW/UPDATED/RESTORED are computed from stable identity + content fingerprints. Scope detachment and global removal are distinct events.
12. Confirmed global removals may delete public media only after all active scope memberships are gone.
13. Schema/state migrations must preserve active products safely and explicitly retire any legacy holding scope only when an authoritative complete catalog scan makes that safe.
14. Sync behavior changes require tests for NEW, UPDATED, RESTORED, partial UNOBSERVED, scope DETACHED, cross-scope preservation and final global REMOVED.

## Public taxonomy rules

1. The provider's taxonomy scanner is the authority for hierarchy. Do not infer parent/child relationships from product names in the storefront.
2. Raw category IDs and raw category URLs may exist only during extraction/private source processing. Public taxonomy uses opaque `c_<hash>` IDs only.
3. Public categories must expose only safe storefront fields such as `id`, `name`, opaque `parentId`, opaque `childIds` and `depth`.
4. Parent/child relationships must be reciprocal and acyclic in published data; `npm run taxonomy:audit` is mandatory after taxonomy changes/imports.
5. Products must carry an opaque `categoryId` and `categoryPathIds` that ends at their own category and follows the audited parent chain.
6. Unique-name matching is a controlled fallback only when the private source category ID is missing; ambiguous names must not be guessed.
7. Unmatched products use a stable opaque fallback category rather than leaking or inventing a raw provider category.
8. Category scans may enrich/merge taxonomy but cannot delete unrelated global taxonomy branches.
9. Public taxonomy schema changes require schema/version updates and regression tests for hierarchy, descendant counts, breadcrumb trails and parent filtering.

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
