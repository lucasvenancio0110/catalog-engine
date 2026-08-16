# Catalog Engine — Engineering Rules

These rules apply to all human and AI contributors working in this repository.

## Dependency policy

Use the smallest approved library that owns the problem. Do not add a second package for a responsibility already covered below unless there is a documented technical reason and a migration plan.

### Approved runtime libraries

- **Cheerio** — HTML/XML parsing and DOM querying in Node.js. Use it for Yupoo/static HTML extraction. Do not add jsdom for static parsing.
- **PQueue** — concurrency, backpressure and request/task rate limiting. Use it instead of hand-written promise pools or unbounded `Promise.all()` for network/image batches.
- **Zod** — validation at trust boundaries: external HTML-derived data, store configuration, generated catalog JSON and future API payloads. Do not publish or persist unvalidated structured data.
- **Sharp** — image metadata, validation, resize, conversion and optimization. Do not implement image transformations manually or shell out to ImageMagick without a documented exception.

### Approved quality libraries

- **Vitest** — automated JavaScript tests. New parsing/classification/business rules require tests.
- **ESLint** — correctness/static-analysis rules. Fix lint violations instead of suppressing them unless the suppression has an explanatory comment.
- **Prettier** — formatting. Do not create competing formatting conventions.

### Approved storefront libraries — only after bundling is enabled

These are approved for the storefront but must not be loaded from an unpinned public CDN in production:

- **Fuse.js** — typo-tolerant local product search and relevance ranking.
- **Swiper** — touch-first product galleries/carousels.
- **Motion** — purposeful UI microinteractions/transition effects.
- **Vite** — preferred bundler/dev server when browser npm dependencies are introduced.

Do not add React/Vue/Svelte/Angular solely for UI convenience. The storefront remains framework-agnostic until product complexity objectively justifies a framework migration.

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
npm install
npm run test
npm run lint
```

For crawler/import changes, also run a real isolated crawl and then:

```bash
npm run audit
```

A feature is not complete because it works once. It is complete when its behavior is tested, its output is validated, and its failure mode is understood.
