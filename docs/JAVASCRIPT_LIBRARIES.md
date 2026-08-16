# JavaScript Library Baseline

Decision baseline: 2026-08-16

The project uses one approved tool per recurring responsibility. New packages must have a clear owner/problem and must be added to `config/dependency-policy.json`; CI rejects unapproved dependencies.

| Responsibility | Package | Status |
|---|---|---|
| Static HTML parsing | `cheerio` | Active |
| Concurrency / rate limiting | `p-queue` | Active |
| Runtime schema validation | `zod` | Active |
| Image processing | `sharp` | Active |
| Product fuzzy search | `fuse.js` | Active |
| Touch product gallery | `swiper` | Active |
| UI microinteractions | `motion` | Active |
| Frontend bundling | `vite` | Active |
| Tests | `vitest` | Active (dev) |
| Static analysis | `eslint` | Active (dev) |
| Formatting | `prettier` | Active (dev) |

## Storefront architecture

Browser dependencies are imported through Vite modules. Production must not load these packages from arbitrary public CDNs.

- Fuse.js owns typo-tolerant local search.
- Swiper owns image swiping/navigation.
- Motion owns subtle transitions and must respect reduced-motion accessibility.
- Vite owns dev/build output and uses a relative base so the same artifact is portable across GitHub Pages, custom domains and future tenant paths.

## Deliberately rejected by default

- Axios/Got: Node 22 native `fetch` is sufficient.
- jsdom: Cheerio is lighter for static supplier HTML.
- Playwright/Puppeteer: browser automation is fallback-only.
- Lodash: native JavaScript covers current transformations.
- React/Vue/Svelte/Angular: no framework migration without objective product complexity that justifies it.

## Enforcement

```bash
npm run deps:check
npm run test
npm run lint
npm run build
npm run build:verify
```

`npm run build:verify` additionally prevents deployment if public data contains supplier URLs or referenced catalog images are missing from the generated `dist/`.

## Primary documentation

- Cheerio: https://cheerio.js.org/
- PQueue: https://github.com/sindresorhus/p-queue
- Zod: https://zod.dev/
- Sharp: https://sharp.pixelplumbing.com/
- Fuse.js: https://www.fusejs.io/
- Swiper: https://swiperjs.com/
- Motion: https://motion.dev/
- Vite: https://vite.dev/
- Vitest: https://vitest.dev/
- ESLint: https://eslint.org/
- Prettier: https://prettier.io/
