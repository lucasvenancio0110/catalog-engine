# Catalog Engine — Design Foundation Audit

Status: **M3 implementation audit / decision record**  
Audit date: **2026-08-19**  
Scope: current storefront/portal UI structure, responsive debt and library ownership before UX 2.0 work.

## Purpose

This document translates the post-audit `DESIGN-SYSTEM.md` contract into an implementation starting point. It records what exists now, what should be preserved, what should be rebuilt and which library decisions are justified at this stage.

It does not replace the normative design contract.

## Current frontend architecture

The repository currently uses:

- Vite;
- browser ES modules;
- vanilla DOM rendering;
- no React/Vue/Svelte/Angular application;
- Motion for selected reveal/microinteraction behavior;
- Swiper for product media galleries;
- server/API-backed storefront product search/filter loading;
- a legacy `src/catalog/search.js` Fuse.js helper that is not part of the current storefront entry graph.

`src/ui/` contained only the Motion wrapper before this M3 foundation work. There was no shared token/primitives layer.

## Design-system fragmentation found

### Storefront

The storefront had its own root values for:

- dark/light colors;
- panel/background colors;
- muted text;
- borders;
- accent;
- local radii/spacing;
- two main responsive breakpoints (`900px`, `620px`).

Product-grid behavior was effectively:

- 4 columns on desktop;
- 2 columns below 900px;
- 2 compact columns below 620px.

This worked as an MVP, but it did not express the broader responsive verification contract required for 320px through 1920px+.

### Customer portal

The portal had a separate visual vocabulary:

- different root colors and brand tokens;
- different radii/shadows;
- separate focus treatment;
- separate desktop/mobile shell behavior;
- symbol-character icon placeholders.

The portal is visually more productized than the storefront foundation, but shared decisions such as spacing, control sizing, focus, safe areas and motion were duplicated rather than owned centrally.

## Decision: shared foundation, separate brands

Catalog Engine will not force storefront and portal into one visual skin.

Shared layer owns:

- typography/spacing scales;
- geometry/control sizes;
- layout maxima/gutters;
- motion timing/easing;
- focus/accessibility behavior;
- touch behavior;
- safe-area behavior;
- responsive quality primitives.

Surface layers own:

### Merchant storefront

- merchant colors/branding;
- commerce composition;
- category/product visual language;
- domain-specific merchandising presentation.

### Catalog Engine portal

- Catalog Engine brand;
- operational/status language;
- onboarding/admin information architecture.

This first implementation lives in `src/ui/foundation.css` and is scoped through `body.ce-storefront` / `body.ce-portal`.

## Component audit

### Storefront shell/header

Status: **IMPROVE / later REBUILD in M9**

Keep:

- sticky header concept;
- merchant name/logo boundary;
- compact mobile footprint.

Change later:

- replace glyph theme control with consistent iconography;
- improve mobile search/navigation hierarchy;
- support theme/brand engine tokens;
- improve semantic/deep-link navigation.

### Hero/stats

Status: **IMPROVE**

Keep product-count/value context, but future layout should become theme-aware rather than one fixed editorial hero.

### Search

Status: **REBUILD EXPERIENCE, KEEP API DIRECTION**

Current storefront submits search through `/api/products` rather than loading the whole ~17k catalog into Fuse in the current entry path.

Decision:

- do not reintroduce client-side full-catalog Fuse merely because the dependency is installed;
- preserve a UI contract independent of search implementation;
- later benchmark server-side vs hybrid typo tolerance before final removal/retention of Fuse.

### Category browser

Status: **IMPROVE / CEI-AWARE EVOLUTION**

Keep:

- progressive drill-down;
- team/league/facet navigation;
- counts;
- server-backed entity loading.

Change:

- replace emoji/glyph iconography;
- stronger responsive layout behavior;
- clearer selected/path state;
- use CEI merchandising output as the domain-aware navigation model.

### Product grid

Status: **FOUNDATION IMPROVED NOW, FULL REBUILD M9**

M3 foundation changes grid sizing from one fixed 4-column desktop rule to intrinsic `auto-fill/minmax` behavior, with intentional two-column narrow-phone behavior and a controlled six-column large-desktop ceiling.

M9 still owns:

- card hierarchy;
- badges/facets;
- quick view decision;
- richer states;
- skeletons;
- theme-aware merchandising.

### Product card

Status: **REBUILD M9**

Current card is intentionally simple. Preserve opaque public data/media and safe text rendering, but redesign interaction, typography, image state, badges and actionable information.

### Product dialog/gallery

Status: **IMPROVE / evaluate route-first product detail in M9**

Keep Swiper for the current touch gallery because it already owns the problem. Improve:

- mobile safe-area behavior;
- direct product routes/deep links;
- dialog focus semantics;
- sticky CTA only if UX evidence supports it;
- thumbnails/controls/iconography.

### Portal shell/sidebar/mobile nav

Status: **KEEP ARCHITECTURE, IMPROVE VISUAL/INTERACTION**

Portal already distinguishes desktop sidebar and mobile navigation rather than shrinking desktop directly. Preserve that direction.

Change:

- replace placeholder glyph icons;
- establish shared token use;
- make active/disabled future routes semantically correct when pages become functional;
- validate 320/360/390/430 and tablet behavior through E2E later.

### Store cards / empty / loading / error

Status: **KEEP CONCEPT, STANDARDIZE**

These already reflect the product's action-oriented portal philosophy. M11 will make them data-rich and operational rather than decorative.

## Library decisions after audit

### Vite — KEEP

Current architecture is functioning and build output is healthy. No framework/bundler migration is justified by the design goal alone.

### Motion — KEEP

Owns purposeful microinteractions. Continue using it selectively and keep the CSS `prefers-reduced-motion` baseline.

### Swiper — KEEP

Swiper remains appropriate for touch product-media navigation and supports modular/vanilla usage. Do not add Embla while Swiper already owns the gallery responsibility without a measured problem.

### Zod — KEEP

Not a visual library, but remains the trust-boundary/schema owner for future theme/brand/form configuration.

### Fuse.js — INVESTIGATE / POSSIBLE REMOVE

The file `src/catalog/search.js` imports Fuse, but current storefront entry/main does not import that module and current product search queries the Worker API.

Do not add new Fuse-dependent UX until the M3/M9 search benchmark decides whether:

- server search is sufficient;
- hybrid fuzzy suggestions are useful;
- Fuse should be removed as dead runtime dependency.

### Lucide — APPROVE AS NEXT ICONOGRAPHY CANDIDATE

Reason:

- framework-neutral web/JavaScript package exists;
- package has zero runtime dependencies at the current reviewed release;
- consistent SVG icon language is preferable to mixed emoji/text glyphs;
- fits the existing Vite module graph without requiring React.

Adoption should happen in a focused follow-up with bundle measurement and lockfile-safe dependency update. Do not use CDN loading.

### Radix / Base UI / Ark UI / Headless UI — DO NOT ADOPT NOW

The obvious packages in these families target framework ecosystems, especially React. Adding a frontend framework solely to gain primitives violates current architecture policy.

Native/custom primitives remain acceptable for the current vanilla surface. If portal complexity later objectively justifies a framework migration, primitive-library selection is reevaluated as part of that architecture decision.

### Tailwind / shadcn — DO NOT ADOPT NOW

The current problem is lack of a coherent design contract, not inability to write CSS. Introducing another styling/runtime convention before tokens/components are stabilized would increase migration surface without solving a proven blocker.

### TanStack / React Hook Form / Sonner / cmdk / Vaul — NOT CURRENTLY APPLICABLE

These become candidates only if a future portal architecture/framework and real product complexity gives them a clear responsibility. Do not pre-install future architecture.

### Playwright — APPROVE FOR LATER M20 TEST TOOLING

Browser automation for E2E product validation is distinct from browser automation for scraping. Playwright remains a launch-quality testing candidate and should be introduced with explicit browser CI/budget work, not into the scraper.

## Responsive implementation decision

The M3 shared foundation verifies/supports these representative widths conceptually:

- 320;
- 360;
- 390;
- 430;
- 768;
- 1024;
- 1280;
- 1440;
- 1920+.

The CSS does not create one breakpoint per device. It uses:

- intrinsic grid sizing;
- fluid gutters/type/spacing;
- explicit narrow-phone behavior;
- explicit large-desktop density ceiling;
- safe-area environment variables;
- hover behavior only for hover-capable fine pointers.

## M3 follow-up sequence

1. merge shared design foundation if quality/build gates pass;
2. add Lucide in a focused dependency/icon migration with bundle measurement;
3. remove/replace storefront emoji and portal glyph icon placeholders;
4. benchmark current API search and decide Fuse retention/removal;
5. pin/define explicit version ranges for `latest` dependencies;
6. create first reusable DOM/UI primitives only when a second consumer proves reuse;
7. execute full M9 Storefront UX 2.0 after core/provider/import safety work progresses;
8. execute M11 Portal UX 2.0 using the same foundation.

## Final decision

The design redesign is now a product architecture track, not a late styling task. The foundation is shared; the merchant and Catalog Engine brands remain deliberately distinct.