# Catalog Engine — Design Foundation Audit

Status: **M3 foundation + iconography/dependency hardening implemented**  
Audit date: **2026-08-19**  
Scope: storefront/portal UI structure, responsive foundation and frontend library ownership before UX 2.0 work.

## Purpose

This document translates the post-audit `DESIGN-SYSTEM.md` contract into the implemented frontend foundation. It records what now exists, what is deliberately preserved and what remains for the later storefront/portal UX milestones.

It does not replace the normative design contract.

## Current frontend architecture

The repository uses:

- Vite;
- browser ES modules;
- vanilla DOM rendering;
- no React/Vue/Svelte/Angular application;
- Motion for selected reveal/microinteraction behavior;
- Swiper for product media galleries;
- Lucide for framework-neutral SVG iconography;
- server/API-backed storefront product search/filter loading;
- shared brand-neutral UI foundations under `src/ui/`.

Fuse.js and the unused `src/catalog/search.js` helper were removed in M3 because the production storefront does not use that client-side search path.

## Shared foundation, separate brands

Catalog Engine does not force storefront and portal into one visual skin.

The shared layer owns:

- typography/spacing scales;
- geometry/control sizes;
- layout maxima/gutters;
- motion timing/easing;
- focus/accessibility behavior;
- touch behavior;
- safe-area behavior;
- responsive quality primitives;
- common icon geometry.

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

The shared implementation lives primarily in `src/ui/foundation.css` and `src/ui/iconography.css`, scoped through `body.ce-storefront` / `body.ce-portal`.

## Component audit

### Storefront shell/header

Status: **FOUNDATION IMPROVED / full composition later in M9**

M3 completed:

- responsive/safe-area foundation;
- professional theme-toggle iconography;
- shared focus/touch behavior.

M9 still owns search/navigation hierarchy, theme-engine integration and deeper merchandising composition.

### Search

Status: **API DIRECTION CONFIRMED / UX later in M9**

The storefront submits search through `/api/products` rather than loading the complete catalog into a browser-side fuzzy index.

M3 decision:

- Fuse.js removed as an unused runtime dependency;
- the search contract now tests that trimmed query, page and active filters are sent to the products API;
- the interactive input keeps the existing 300 ms debounce;
- typo-tolerance improvements, if needed later, belong to the server/search architecture rather than an accidental duplicate full-catalog client index.

### Category browser

Status: **FOUNDATION IMPROVED / CEI-aware evolution later**

M3 completed:

- removed emoji and OS-dependent flag iconography;
- introduced Lucide category/navigation icons;
- kept progressive drill-down, counts and server-backed entity loading.

Later work still owns stronger selected/path state and CEI merchandising output.

### Product grid

Status: **FOUNDATION IMPROVED / full rebuild M9**

M3 changed grid sizing from one fixed four-column desktop rule to intrinsic `auto-fill/minmax` behavior, with intentional two-column narrow-phone behavior and a controlled large-desktop density ceiling.

M9 still owns card hierarchy, badges/facets, richer states, skeletons and theme-aware merchandising.

### Product dialog/gallery

Status: **IMPROVE / evaluate route-first product detail in M9**

Swiper remains the gallery owner. M3 added consistent close/CTA iconography and safe-area foundations. M9 owns deep links, focus semantics and final mobile product-detail composition.

### Portal shell/sidebar/mobile nav

Status: **KEEP ARCHITECTURE / iconography standardized**

Portal continues to distinguish desktop sidebar and mobile navigation rather than shrinking desktop directly.

M3 replaced placeholder Unicode glyphs with Lucide SVGs and moved common geometry/accessibility behavior into the shared foundation.

## Library decisions after M3

### Vite — KEEP, PINNED

Current architecture remains appropriate. The previously mutable `latest` specifier was replaced with the already-working lockfile version `8.2.1`; this was a pin, not a bundler upgrade.

### Motion — KEEP, PINNED

Owns purposeful microinteractions. The already-resolved `13.1.0` version is now explicit instead of `latest`.

### Swiper — KEEP, PINNED

Owns touch product-media navigation. The already-resolved `14.1.0` version is now explicit instead of `latest`.

### Zod — KEEP

Remains the trust-boundary/schema owner for future theme/brand/form configuration.

### Fuse.js — REMOVED

The helper was not part of the production storefront entry graph and duplicated the server-backed search direction. Both the package and orphan helper module were removed; tests now assert the actual API search contract.

### Lucide — ADOPTED

Lucide is now the shared framework-neutral icon library.

Implementation rules:

- exact version `1.31.0`;
- no CDN loading;
- direct named imports only;
- separate storefront and portal icon packs;
- no all-icons namespace import;
- SVGs hydrated only inside the relevant surface/dynamic subtree;
- bundle cost reported by CI after every relevant frontend build.

### Radix / Base UI / Ark UI / Headless UI — DO NOT ADOPT NOW

Adding a frontend framework solely to gain primitives is not justified. Native/custom primitives remain appropriate for the current vanilla architecture; this can be revisited only with a real architecture need.

### Tailwind / shadcn — DO NOT ADOPT NOW

The problem being solved is coherent product architecture and design contracts, not inability to write CSS. Do not introduce another styling convention without a demonstrated need.

### TanStack / React Hook Form / Sonner / cmdk / Vaul — NOT CURRENTLY APPLICABLE

These become candidates only if future portal complexity and architecture give them a clear responsibility.

### Playwright — LATER M20 TEST TOOLING

Browser E2E validation remains a launch-quality testing milestone, distinct from scraper automation.

## Responsive implementation decision

The shared foundation is intended to validate representative widths:

- 320;
- 360;
- 390;
- 430;
- 768;
- 1024;
- 1280;
- 1440;
- 1920+.

It does not create one breakpoint per device. It relies on intrinsic grid sizing, fluid gutters/type/spacing, explicit narrow-phone behavior, a large-desktop density ceiling, safe-area environment variables and hover behavior only for hover-capable fine pointers.

## CI contracts added by M3

Frontend changes are now checked with a secret-free workflow that performs:

1. `npm ci`;
2. dependency policy validation;
3. all Vitest tests;
4. lint;
5. Vite build for storefront and portal;
6. raw/gzip bundle reporting per generated JS/CSS asset;
7. public artifact verification.

Additional regression tests reject reintroduction of `latest`, Fuse, all-icons Lucide imports and legacy emoji/glyph iconography.

## What remains after M3

M3 is foundation, not the final visual redesign. Later milestones still own:

- M9 Storefront UX 2.0;
- M10 Theme Engine;
- M11 Portal UX 2.0;
- M20 browser E2E/accessibility/performance launch gates.

The next architecture milestone after M3 is M4 Provider Engine.

## Final decision

The redesign is a product-architecture track, not a late styling task. The foundation and icon language are shared; merchant and Catalog Engine branding remain deliberately separate, and frontend dependencies are now explicit rather than floating on `latest`.