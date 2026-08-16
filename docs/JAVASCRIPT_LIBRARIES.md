# JavaScript Library Baseline

Decision date: 2026-08-16

The goal is not to maximize dependencies. The goal is to standardize one strong tool per recurring responsibility and eliminate duplicated custom infrastructure.

| Responsibility | Decision | Package | Status | Why |
|---|---|---|---|---|
| Static HTML parsing | Keep | `cheerio` | Installed | Fast DOM/query model and already proven against the Yupoo structure. |
| Concurrency / rate limiting | Adopt | `p-queue` | Installed | Explicit concurrency, queueing, timeout and rate-limit controls are safer than unbounded Promise batches. |
| Runtime schema validation | Adopt | `zod` | Installed | Makes source/store/catalog boundaries explicit and fail-fast. |
| Image processing | Adopt | `sharp` | Installed | Decoding, metadata, resize and WebP/AVIF/JPEG optimization in one high-performance package. |
| Tests | Adopt | `vitest` | Installed (dev) | Fast ESM-compatible automated tests with a modern API. |
| Static analysis | Adopt | `eslint` | Installed (dev) | Enforces correctness and catches regressions before deploy. |
| Formatting | Adopt | `prettier` | Installed (dev) | One deterministic formatting policy. |
| Product search | Approved next | `fuse.js` | Not installed yet | Fuzzy typo-tolerant search is valuable when the storefront contains hundreds/thousands of products. |
| Touch gallery | Approved next | `swiper` | Not installed yet | Strong mobile gallery interaction for product photos. |
| UI motion | Approved next | `motion` | Not installed yet | Lightweight purposeful animations without adopting a UI framework. |
| Frontend bundling | Approved next | `vite` | Not installed yet | Required before browser npm dependencies are introduced cleanly. |

## Deliberately rejected for the current architecture

- Axios/Got as a default HTTP client: Node 22 native `fetch` already covers the base requirement.
- jsdom as the default parser: Cheerio is lighter for static supplier HTML.
- Playwright/Puppeteer as the default scraper: browser automation is expensive and should be fallback-only for pages that cannot be read server-side.
- Lodash for general helpers: native JavaScript is sufficient for the current transformations.
- React/Vue/Svelte/Angular: the current storefront does not yet justify framework migration cost.
- Multiple queue/retry libraries for the same concern: PQueue owns concurrency/backpressure; bounded retry remains a small domain-specific utility until requirements justify extracting it.

## Sources reviewed

- Cheerio: https://cheerio.js.org/
- PQueue: https://github.com/sindresorhus/p-queue
- Zod: https://zod.dev/
- Sharp: https://sharp.pixelplumbing.com/
- Vitest: https://vitest.dev/
- ESLint: https://eslint.org/
- Prettier: https://prettier.io/
- Fuse.js: https://www.fusejs.io/
- Swiper: https://swiperjs.com/
- Motion: https://motion.dev/
- Vite: https://vite.dev/
