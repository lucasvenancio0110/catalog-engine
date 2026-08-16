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

## Synchronization rules

1. **A partial scan may never infer deletion.** `not observed` is not equivalent to `removed`.
2. Every synchronized source view is an explicit opaque **scope** (`catalog`, `category`, or future source scope). Pagination/query noise must normalize to the same scope identity.
3. `REMOVED` is allowed only when the current scope is explicitly complete, the run has no extraction/media failures, and the product has no remaining membership in any other active scope.
4. A complete category scan may detach a product from that category without removing it from the store if another scope still owns it.
5. During partial scans, previously active but unobserved products and their scope memberships remain published and active.
6. A category scan must never replace the global taxonomy tree. Only a complete `catalog` scope may authoritatively replace the entire taxonomy; other scopes merge into it.
7. Public product/category/scope IDs must be opaque stable IDs; never expose raw supplier album/category IDs in `catalog.json`, asset paths, sync state or `dist/`.
8. Raw source IDs, source URLs and source image URLs belong only in ignored/private source state.
9. Persistent `data/sync-state.json` may contain only opaque public IDs, hashes, timestamps, statuses, opaque scope memberships and change summaries. It must not contain supplier URLs or raw supplier IDs.
10. NEW/UPDATED/RESTORED are computed from stable identity + content fingerprints. Scope detachment and global removal are distinct events.
11. Confirmed global removals may delete public media only after all active scope memberships are gone.
12. Schema/state migrations must preserve active products safely and explicitly retire any legacy holding scope only when an authoritative complete catalog scan makes that safe.
13. Sync behavior changes require tests for NEW, UPDATED, RESTORED, partial UNOBSERVED, scope DETACHED, cross-scope preservation and final global REMOVED.

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

For crawler/import/sync changes, also run a real isolated crawl and then:

```bash
npm run audit
npm run sync:audit
```

A feature is not complete because it works once. It is complete when its behavior is tested, its output is validated, and its failure mode is understood.
