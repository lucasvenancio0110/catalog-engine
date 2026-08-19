# JavaScript Library Baseline

Decision baseline: **2026-08-19 post-audit**

The project uses one approved tool per recurring responsibility. New packages must have a clear owner/problem and must be added to `config/dependency-policy.json`; CI rejects unapproved dependencies.

This document records **dependency ownership**, not a promise that every installed dependency is permanently required. Runtime usage must be periodically revalidated against the actual architecture.

| Responsibility | Package | Status |
|---|---|---|
| Static HTML parsing | `cheerio` | Active |
| Concurrency / rate limiting | `p-queue` | Active |
| Runtime schema validation | `zod` | Active |
| Image processing | `sharp` | Active |
| Product fuzzy search | `fuse.js` | Installed / architecture re-evaluation required |
| Touch product gallery | `swiper` | Active |
| UI microinteractions | `motion` | Active |
| Frontend bundling | `vite` | Active |
| Unit/integration tests | `vitest` | Active (dev) |
| Static analysis | `eslint` | Active (dev) |
| Formatting | `prettier` | Active (dev) |

## Frontend architecture

Browser dependencies are imported through Vite modules. Production must not load application packages from arbitrary public CDNs.

Current decisions:

- Swiper owns current product-media swipe/navigation where used;
- Motion owns purposeful transitions/microinteractions and must respect reduced-motion accessibility;
- Vite owns dev/build output;
- Fuse.js is the approved client-side fuzzy-search package while client-side fuzzy search remains part of the architecture, but the post-audit product is increasingly API/D1-backed, so search ownership must be re-evaluated before Fuse becomes a permanent launch invariant.

Do not add a second client-side fuzzy-search library simply because Fuse's long-term role is being reviewed. The review may result in keeping Fuse, server-side search, or a deliberate hybrid.

## Design-system dependency evaluation

`docs/DESIGN-SYSTEM.md` owns the product UX quality contract.

The M3 Design Foundation milestone must explicitly evaluate whether new packages are justified for responsibilities such as:

- consistent iconography;
- accessible dialog/drawer/menu primitives;
- E2E browser testing;
- accessibility automation;
- large admin-table/virtualization behavior if real portal complexity proves the need.

A package is not approved because its demo looks premium. Compare:

- responsibility/overlap;
- framework compatibility;
- accessibility;
- mobile/touch quality;
- bundle/runtime cost;
- maintenance/activity;
- styling control;
- lock-in/migration cost.

No UI primitive library, icon package or table/virtualization package is approved by this document yet. Approval should happen through the Design Foundation milestone with `config/dependency-policy.json`, tests and documentation changed together.

## Browser automation distinction

Supplier scraping and product E2E testing are different responsibilities.

### Supplier extraction

Browser automation remains **fallback-only**. Static/server HTML should be parsed with Cheerio first when it contains the required evidence.

Do not add Playwright/Puppeteer merely to replace reliable static extraction.

### Product/browser E2E

Playwright or another maintained E2E tool is **allowed to be evaluated/approved as dev/test infrastructure** for launch-quality testing of:

- storefront flows;
- customer portal flows;
- responsive behavior;
- WebKit/Chromium/Firefox-equivalent coverage;
- keyboard/dialog/navigation behavior.

Therefore browser automation is not globally "rejected"; its approval depends on the responsibility it owns.

## Deliberately rejected by default

- Axios/Got: Node/Web Platform native `fetch` is sufficient for current needs.
- jsdom: Cheerio is lighter for static supplier HTML.
- Lodash: native JavaScript covers current transformations.
- React/Vue/Svelte/Angular: no framework migration solely for UI convenience. A framework requires an explicit architecture decision and migration plan justified by objective product complexity.
- duplicate libraries for an already-owned responsibility without a documented migration/replacement plan.

## Current post-audit dependency concerns

The audit identified two follow-up items:

1. `fuse.js`, `motion`, `swiper` and `vite` currently use broad `latest` declarations in `package.json` for some packages. Explicit supported ranges/pinning policy should be chosen to reduce lockfile-regeneration surprises.
2. Fuse.js appears installed and has a search module in the repository, but its effective runtime path must be verified during Design Foundation/search architecture work rather than assumed from the manifest alone.

## Enforcement

Current baseline:

```bash
npm run deps:check
npm run test
npm run lint
npm run build
npm run build:verify
```

When browser E2E/accessibility tooling is activated, its CI gate must be added deliberately rather than hidden inside an unrelated script.

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

Current versions/maintenance state must be rechecked from primary upstream sources when making a dependency decision.