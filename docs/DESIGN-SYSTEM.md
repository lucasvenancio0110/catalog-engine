# Catalog Engine — Design System & Responsive Experience

Status: **Normative product/UX contract**  
Scope: storefront, customer portal, onboarding, CEI review, domain/billing surfaces and shared customer-facing UI.  
Non-goal: freeze one visual style forever or force a framework migration.

## Product design principle

Catalog Engine must feel like a maintained premium product, not a supplier mirror, generated template or internal infrastructure dashboard.

The design system exists to provide:

- consistent visual authority;
- excellent mobile behavior;
- predictable interaction states;
- accessibility;
- fast product development without visual drift;
- controlled tenant theming without arbitrary customer code;
- shared quality across storefront and customer portal while preserving different brand roles.

The public merchant storefront expresses **the merchant brand**. `catalogoengine.com` and `app.catalogoengine.com` express **the Catalog Engine brand**. They can share engineering primitives without looking like the same product skin.

## Customer-facing Definition of Done

A customer-facing feature is incomplete until the applicable states are designed and verified:

- desktop;
- phone;
- tablet when layout materially differs;
- touch interaction;
- keyboard/focus interaction;
- loading;
- empty;
- error;
- disabled/restricted state;
- reduced-motion behavior;
- long/short content;
- slow/failed network behavior where relevant.

No essential capability may require hover.

## Architecture baseline

The current frontend remains Vite + browser ES modules and must not migrate to React/Vue/Svelte/Angular merely to obtain UI components.

Framework adoption is a separate architecture decision requiring evidence that product complexity, maintainability or accessibility benefits outweigh migration/bundle/operational cost.

Browser dependencies must be imported through the application build graph rather than arbitrary public CDN scripts.

## Library ownership rule

One recurring responsibility should have one clear owner.

Current responsibilities already have candidate/active owners such as:

- purposeful motion: Motion;
- touch product media navigation: Swiper;
- validation at trust boundaries: Zod;
- storefront fuzzy search: Fuse.js is installed but its long-term ownership must be revalidated against API/server/hybrid search architecture.

Before approving a new UI dependency, compare:

- actual problem solved;
- framework compatibility;
- accessibility semantics;
- bundle/runtime cost;
- maintenance/activity;
- styling control;
- mobile/touch quality;
- overlap with an existing dependency;
- lock-in/migration cost.

Candidate areas that may justify a dedicated library include:

- consistent iconography;
- accessible low-level UI primitives if native/custom implementation cost becomes material;
- E2E/accessibility test infrastructure;
- large admin-table/virtualization behavior only after real portal complexity requires it.

Do not install a library solely because its demo looks polished.

## Design-token layers

The target token hierarchy is:

1. **foundation tokens** — raw scales;
2. **semantic tokens** — meaning such as background/text/border/status/action;
3. **component tokens** — controlled component-specific mapping only when necessary;
4. **tenant theme tokens** — validated merchant branding values mapped into safe semantic slots.

Avoid hard-coded one-off colors/spacing values scattered through components when a semantic token owns the decision.

## Typography

Define a compact hierarchy, for example:

- display-xl;
- display-lg;
- heading-xl;
- heading-lg;
- heading-md;
- heading-sm;
- body-lg;
- body-md;
- body-sm;
- label;
- caption.

Rules:

- type scale must remain readable on 320px phones;
- line-height belongs to the token/type role;
- merchant-controlled font choices, if introduced, come from an approved set or safe asset pipeline;
- public product/supplier text must not be able to inject markup/styles.

## Spacing

Use a documented spacing scale rather than arbitrary values.

A practical baseline can include:

`4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96`

Exceptions are allowed when geometry genuinely requires them, but repeated exceptions should become tokens or indicate a component/layout problem.

## Containers and layout

Define:

- page horizontal gutters;
- readable content max widths;
- storefront commerce max width;
- portal work-area max width where appropriate;
- grid gaps;
- section spacing;
- sticky/fixed safe-area behavior.

Do not let ultra-wide displays stretch product cards/text indefinitely.

Prefer CSS Grid/Flexbox/intrinsic sizing and container-aware components before adding many viewport-specific overrides.

## Responsive verification matrix

Representative widths must be exercised during major visual work:

- 320px;
- 360px;
- 390px;
- 430px;
- 768px;
- 1024px;
- 1280px;
- 1440px;
- 1920px+.

These widths are **verification points**, not mandatory media-query breakpoints.

Breakpoints must be introduced because content/layout behavior needs them, not because a device name exists.

## Product-grid contract

The product grid must be intrinsically responsive.

Launch design should deliberately validate patterns equivalent to:

- compact phones: typically two useful product columns when card content supports it;
- larger phones: two columns with improved gutters/card width;
- tablet: approximately three to four columns depending on available container width;
- desktop: approximately four to six columns depending on card minimum width and content density;
- large desktop: controlled maximum content width rather than infinite stretching.

Exact counts are implementation decisions. The invariant is that cards remain readable/tappable and visual density remains intentional.

## Product-card contract

A product card may include supported information such as:

- primary image;
- new/featured/status badge;
- product public name;
- merchant-relevant entity/category metadata;
- important facets;
- discovery/action affordance.

Required states:

- default;
- hover when pointer exists;
- keyboard focus;
- pressed/touch feedback;
- loading/skeleton;
- image unavailable;
- long text;
- hidden/unavailable behavior where appropriate.

Do not expose supplier/private source identity through product-card text or URLs.

## Product-detail contract

Desktop can use a gallery + information composition. Mobile should prioritize swipeable media, product identity, important facets and the primary merchant CTA without reproducing a desktop sidebar at phone width.

Consider sticky mobile action areas only when they improve conversion and do not obstruct content/safe areas.

Product detail must support direct/deep linking as storefront routing evolves.

## Navigation contract

Desktop and mobile navigation are allowed to be different interaction patterns.

Desktop can expose broad category/search navigation. Mobile should prioritize a clear brand/search/menu hierarchy and use drawers/sheets where they improve reachability.

The mobile experience must not be a shrunken desktop header.

## Search and filtering

Search UX must remain useful as catalogs scale.

The visual contract is independent from whether the underlying implementation is Fuse.js, server-side D1 search or hybrid search.

Search/filter states must support:

- query loading;
- no results;
- corrected/fuzzy relevance behavior when implemented;
- clear filters;
- filter counts only when trustworthy;
- mobile filter sheet/drawer when necessary;
- URL/deep-link state where useful.

Do not freeze client-side Fuse.js as a permanent architecture requirement solely because it was useful during the static-catalog stage.

## Surfaces, borders, radius and elevation

Use semantic roles rather than styling every card uniquely.

Suggested conceptual roles:

- background;
- surface;
- surface-muted;
- raised;
- floating/overlay;
- border;
- border-strong;
- focus-ring.

Radius should use a compact scale such as:

- xs;
- sm;
- md;
- lg;
- xl;
- full.

Elevation should communicate layering/hierarchy, not decorate every panel with shadows.

## Color semantics

Define semantic roles such as:

- background;
- surface;
- text;
- text-secondary;
- text-muted;
- border;
- action/primary;
- action-hover/pressed;
- success;
- warning;
- danger;
- information;
- focus.

Tenant colors map into approved theme roles. A merchant color choice may need automatic contrast adjustment/rejection to preserve accessibility.

## Iconography

The product should use one consistent icon family/strategy rather than emojis or mixed icon sources for primary UI semantics.

A lightweight icon library may be approved during the M3 library evaluation. Until then, do not introduce multiple competing icon packages.

Decorative icons must not replace text where the action meaning would become ambiguous.

## Motion

Motion is purposeful and subtle.

Use motion to communicate:

- state change;
- hierarchy/layer opening;
- continuity between related elements;
- successful action feedback;
- progressive onboarding/import status.

Avoid animation whose only purpose is visual spectacle when it delays interaction or reduces clarity.

All motion-sensitive components must respect `prefers-reduced-motion`.

## Dialogs, drawers and overlays

Overlay components must handle:

- focus entry/return;
- escape/close behavior;
- scroll locking where appropriate;
- keyboard navigation;
- accessible label/title relationship;
- touch-safe controls;
- small-screen height/safe area;
- loading/error states inside the overlay.

Do not choose a primitive library until the library architecture comparison proves it is beneficial for the framework-agnostic stack.

## Loading

Prefer structure-preserving loading feedback:

- skeletons for product lists/cards;
- staged real onboarding/import checkpoints;
- localized progress indicators for actions;
- preserved content during background refresh where safe.

Never show fake percentage progress for long-running backend jobs.

## Empty states

Empty states should explain:

- what is empty;
- whether that is expected;
- the next useful action.

Examples differ between:

- empty new store;
- no search results;
- no products requiring CEI review;
- no domain configured;
- no billing issue.

## Error states

Customer-facing errors must answer:

1. what happened in merchant language;
2. whether Catalog Engine will retry automatically;
3. whether the customer must act;
4. the next action when one exists.

Do not expose provider stack traces, D1 IDs, Worker script names, raw Cloudflare responses or supplier URLs.

## Portal design philosophy

The portal is not a generic analytics dashboard.

Its primary question is:

> Is my store healthy, is Catalog Engine working, and do I need to do anything?

Prefer status, exceptions and next actions over decorative charts.

The primary launch information architecture is defined in `CUSTOMER-PORTAL.md` and `DEVELOPMENT-ROADMAP.md`.

## CEI experience

CEI should appear as useful organization and exception handling, not opaque AI theater.

Merchant UI may show:

- detected catalog domain;
- products automatically organized;
- items needing review;
- clear ambiguity choices;
- verified corrections.

Do not expose chain-of-thought/internal reasoning or unverifiable intelligence claims.

A merchant correction should map to durable tenant memory/override where the CEI contract allows it.

## Onboarding experience

Long-running onboarding must be resumable and based on real backend checkpoints.

Desired interaction qualities:

- one primary next action;
- minimal infrastructure terminology;
- real product/source counts when available;
- ability to leave/return safely;
- early private preview when the tenant is genuinely healthy enough;
- clear blockers/attention states.

## Theme / white-label contract

Themes are controlled software, not arbitrary uploaded customer code.

Tenant configuration may eventually control supported values such as:

- logo;
- colors;
- approved typography;
- density/radius choices;
- hero/banners;
- supported home sections/order;
- public CTA/contact data.

Public storefronts should feel merchant-branded while continuing to receive Catalog Engine responsive/accessibility/product updates.

## Accessibility baseline

Customer-facing product must target robust accessible interaction.

At minimum:

- visible focus;
- semantic controls;
- associated form labels;
- meaningful alt behavior for product media;
- accessible dialogs/menus/drawers;
- keyboard operation for applicable components;
- sufficient text/action contrast;
- reduced-motion support;
- no color-only critical status;
- touch targets suitable for phones.

Automated accessibility tests are necessary but not sufficient; important interactive flows need manual keyboard/focus review.

## Browser E2E

Browser E2E is a quality tool, not supplier-scraping architecture.

Playwright or an equivalent maintained E2E tool may be approved for testing even though browser automation remains fallback-only for provider extraction.

E2E should eventually cover major storefront and portal journeys on Chromium/WebKit/Firefox-equivalent engines where practical.

## Performance

Visual quality includes perceived and measured performance.

Protect:

- stable layout;
- fast initial content;
- responsive input;
- image/media efficiency;
- bounded initial JavaScript;
- intentional prefetch/lazy loading;
- no animation-induced interaction delay.

Performance budgets/Core Web Vitals targets should be recorded once real-browser instrumentation is active and reviewed as the storefront design evolves.

## Final design decision rule

Before shipping a customer-facing change ask:

> Does this remain clear, fast, accessible and intentional on a phone with touch, on desktop with keyboard/pointer, during loading, with no data and when something fails?

If the answer is unknown, the feature is not finished.
