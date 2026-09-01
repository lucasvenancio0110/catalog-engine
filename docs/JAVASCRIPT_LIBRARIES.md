# JavaScript Library Baseline

Decision baseline: **2026-09-01 M9B experience-stack foundation**

The project uses one approved tool per recurring responsibility. New packages must have a clear owner/problem and must be added to `config/dependency-policy.json`; CI rejects unapproved dependencies.

This document records **dependency ownership**, not a promise that every installed dependency is permanently required. Runtime usage must be periodically revalidated against the actual architecture.

| Responsibility | Package | Status |
|---|---|---|
| Static HTML parsing | `cheerio` | Active |
| Concurrency / rate limiting | `p-queue` | Active |
| Runtime schema validation | `zod` | Active |
| Image processing | `sharp` | Active |
| Iconography | `lucide` | Active |
| Touch product gallery | `swiper` | Active |
| UI microinteractions | `motion` | Active |
| Frontend bundling | `vite` | Active |
| Unit/integration tests | `vitest` | Active (dev) |
| Static analysis | `eslint` | Active (dev) |
| Formatting | `prettier` | Active (dev) |

Current storefront product search is API/server-backed. `Fuse.js` and the unused legacy client-search helper were removed in M3 rather than retained as speculative architecture.

## Frontend architecture

Browser dependencies are imported through Vite modules. Production must not load application packages from arbitrary public CDNs.

Current decisions:

- Lucide owns storefront/portal iconography through small surface-specific named-import packs;
- Swiper owns current product-media swipe/navigation where used;
- Motion owns purposeful transitions/microinteractions and must respect reduced-motion accessibility;
- Vite owns dev/build output;
- product search currently queries the Worker/API rather than loading the complete catalog into a client fuzzy-search index;
- Zod remains the structured configuration/trust-boundary validator where applicable.

Do not add a second package for any of these responsibilities without a measured problem and explicit migration/replacement plan.

A future hybrid typo-tolerant search layer may be evaluated if user evidence proves the server/API experience insufficient, but no client fuzzy-search library is pre-approved simply because one existed historically.

## M9B experience-stack foundation

The owner explicitly requested a richer, app-like storefront with purposeful motion, transitions, touch feedback and access to larger UI libraries. That product direction is approved, but it does **not** waive the one-owner-per-responsibility rule or permit multiple global design systems to compete for the same control.

The M9B experience stack therefore uses staged adoption:

### Active owners

- **Motion** remains the default owner for press feedback, reveal/stagger, sheets, small state transitions and other ordinary UI microinteractions.
- **Swiper** remains the owner of product-media swipe/gallery behavior.
- **Lucide** remains the iconography owner.
- **Web Platform APIs** are preferred when robust: View Transitions, native dialog/popover where appropriate, CSS scroll snap, container queries, `VisualViewport` and `IntersectionObserver`.

The shared `src/ui/motion.js` contract defines consistent durations/easing, reduced-motion behavior, press feedback and a progressive View Transitions fallback so later storefront slices do not invent animation timing independently.

### Approved future storefront pilots

The following packages are recorded in `config/dependency-policy.json` as **future pilots**, not installed runtime dependencies and not blanket permission to import them globally:

- **`@awesome.me/webawesome`** — candidate for accessible framework-agnostic primitives such as select, dropdown, tooltip, drawer/dialog and skeleton where the native/custom maintenance cost is material. It must be imported component-by-component and heavily themed; it does not own product cards, hero, merchant branding or the entire storefront skin.
- **`framework7`** — candidate for an isolated mobile interaction pattern only when a concrete M9/M10 need proves better touch ergonomics than the existing native/Motion/Swiper stack. It must not take over router, URL state, product gallery ownership or the global app shell merely because those capabilities exist.
- **`gsap`** — candidate only for a deliberate cinematic/timeline/scroll sequence that ordinary Motion cannot own cleanly. Motion remains the default microinteraction owner; GSAP must not duplicate routine button/card/sheet animation.

Upstream package state was rechecked during this decision. Exact runtime versions are pinned only when a pilot becomes an installed dependency and passes bundle/maintenance/accessibility review.

### Benchmark-only libraries

UIkit, Ionic Core, Onsen UI and Bootstrap may be used as reference/benchmark sources during design exploration, but they are **not runtime-approved** by this decision. Their broad component/mobile responsibilities materially overlap the selected owners. Promoting one requires a concrete replacement/ownership decision, bundle evidence and an explicit update to this document plus dependency policy.

This keeps the broad UI-library exploration available without shipping several competing CSS/JS systems to every merchant storefront.

## M3 dependency decisions completed

M3 deliberately made the following dependency changes:

- adopted `lucide` as framework-neutral iconography;
- split storefront and portal icon packs so one surface does not import the other's icon set;
- rejected whole-namespace/all-icons Lucide imports through regression tests;
- removed `fuse.js` because the active storefront search path is API-backed and the Fuse helper was orphaned;
- replaced mutable `latest` specs with reviewed explicit versions for the frontend packages that previously floated;
- added deterministic frontend raw/gzip bundle reporting to CI.

Reviewed exact versions at the M3 baseline:

- `lucide`: `1.31.0`;
- `motion`: `13.1.0`;
- `swiper`: `14.1.0`;
- `vite`: `8.2.1`.

These exact values describe the reviewed M3 baseline. Future upgrades remain allowed, but must be deliberate, tested and lockfile-consistent rather than obtained implicitly through `latest`.

## Design-system dependency evaluation

`docs/DESIGN-SYSTEM.md` owns the product UX quality contract.

Current outcome:

- **Lucide** — approved/active for iconography;
- **Motion** — retained for purposeful microinteractions;
- **Swiper** — retained for touch media gallery;
- **Web Awesome / Framework7 / GSAP** — approved only as staged future pilots under the bounded ownership rules above; not yet runtime dependencies;
- **Tailwind/shadcn** — not adopted; lack of a coherent design contract was the problem, not inability to write CSS;
- **Radix/Base UI/Ark UI/Headless UI** — not adopted because adding a framework solely for primitives is not justified by the current vanilla architecture;
- **TanStack/React Hook Form/Sonner/cmdk/Vaul** — not applicable without a concrete ownership problem/framework decision;
- **Playwright** — approved for later evaluation as launch-quality E2E/test infrastructure, not as default supplier extraction tooling.

A package is not approved because its demo looks premium. Compare:

- responsibility/overlap;
- framework compatibility;
- accessibility;
- mobile/touch quality;
- bundle/runtime cost;
- maintenance/activity;
- styling control;
- lock-in/migration cost.

## Browser automation distinction

Supplier scraping and product E2E testing are different responsibilities.

### Supplier extraction

Browser automation remains **fallback-only**. Static/server HTML should be parsed with Cheerio first when it contains the required evidence.

Do not add Playwright/Puppeteer merely to replace reliable static extraction.

### Product/browser E2E

Playwright or another maintained E2E tool is allowed to be evaluated/approved as dev/test infrastructure for launch-quality testing of:

- storefront flows;
- customer portal flows;
- responsive behavior;
- Chromium/WebKit/Firefox coverage;
- keyboard/dialog/navigation behavior;
- accessibility integration where appropriate.

Browser automation is therefore not globally rejected; approval depends on the responsibility it owns.

## Deliberately rejected by default

- Axios/Got: Node/Web Platform native `fetch` is sufficient for current needs.
- jsdom: Cheerio is lighter for static supplier HTML.
- Lodash: native JavaScript covers current transformations.
- React/Vue/Svelte/Angular: no framework migration solely for UI convenience. A framework requires an explicit architecture decision and migration plan justified by objective product complexity.
- duplicate libraries for an already-owned responsibility without a documented migration/replacement plan.
- arbitrary public-CDN application dependencies.

## Current dependency concerns

The major M3 issues (`latest`, orphan Fuse, inconsistent iconography) are resolved.

Remaining dependency/tooling work is evidence-driven:

1. apply the M9B experience-stack pilots only to concrete components with measured bundle/accessibility/mobile benefit;
2. evaluate Playwright/browser accessibility tooling during the launch-quality E2E milestone;
3. review upstream dependency upgrades deliberately rather than continuously floating;
4. continue measuring frontend bundle impact in CI;
5. reevaluate framework/primitives only if Portal/Storefront complexity creates a measurable maintenance/accessibility problem.

## Enforcement

Current baseline:

```bash
npm run deps:check
npm run test
npm run lint
npm run build
npm run build:verify
```

Frontend CI additionally reports raw/gzip bundle size. Provider/import changes have dedicated provider/tenant gates where applicable.

When browser E2E/accessibility tooling is activated, its CI gate must be added deliberately rather than hidden inside an unrelated script.

## Primary documentation

- Cheerio: https://cheerio.js.org/
- PQueue: https://github.com/sindresorhus/p-queue
- Zod: https://zod.dev/
- Sharp: https://sharp.pixelplumbing.com/
- Lucide: https://lucide.dev/
- Swiper: https://swiperjs.com/
- Motion: https://motion.dev/
- Web Awesome: https://webawesome.com/
- Framework7: https://framework7.io/
- GSAP: https://gsap.com/
- Vite: https://vite.dev/
- Vitest: https://vitest.dev/
- ESLint: https://eslint.org/
- Prettier: https://prettier.io/

Current versions/maintenance state must be rechecked from primary upstream sources when making a future dependency decision.
