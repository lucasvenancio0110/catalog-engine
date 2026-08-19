# Catalog Engine — Landing Page

Status: **Normative product/UX contract**  
Primary surface: `https://catalogoengine.com`  
Scope: marketing site structure, positioning, plan/checkout entry and conversion experience.

## Purpose

The landing page exists to convert the right merchant into a recurring Catalog Engine subscriber.

It is not a generic corporate brochure. It must explain the transformation clearly enough that a merchant understands:

1. what problem Catalog Engine solves;
2. what the result looks like;
3. how little manual work is required;
4. why the service remains valuable every month;
5. how to choose a plan and subscribe.

## Primary message

The landing page should communicate a promise in this family:

> Transforme o catálogo do seu fornecedor em uma loja profissional, organizada, inteligente e atualizada automaticamente.

Do not reduce the product to "Yupoo importer" even if Yupoo is the first supported connector.

## Conversion story

The central visual narrative is:

`catalog source -> Catalog Engine -> CEI organizes -> branded storefront -> automatic sync`

A strong before/after demonstration is preferred over long technical explanations.

The visitor should understand that Catalog Engine converts messy supplier information into a sellable customer-facing catalog/store.

## Audience

Initial acquisition may focus on merchants/resellers that already operate from supplier catalogs, especially sports/football sellers.

The page architecture should not imply that the platform can only ever support sports or Yupoo. Product examples can show multiple future domains once those capabilities are production-ready.

## Required landing sections

The exact visual layout can evolve, but the page should cover these jobs.

### 1. Hero

Must answer immediately:

- what Catalog Engine does;
- who benefits;
- what the result is;
- primary CTA.

Primary CTA should lead toward plan selection/recurring checkout.

Avoid technical language such as Worker, D1, tenant, scraper, dispatch or Cloudflare.

### 2. Transformation demonstration

Show the difference between a raw source and a polished store.

Examples of visual treatment:

- split before/after;
- animated transformation;
- source cards flowing through Catalog Engine;
- interactive demo/store preview;
- product/category reorganization example.

This section should demonstrate actual product value, not decorative animation alone.

### 3. How it works

Simple merchant language, for example:

1. assine seu plano;
2. crie sua loja;
3. conecte seu catálogo;
4. Catalog Engine entende e organiza;
5. personalize sua marca;
6. conecte seu domínio;
7. publique e deixe sincronizando automaticamente.

### 4. CEI value

Explain Catalog Engine Intelligence in business language:

- identifies what the catalog sells;
- organizes products beyond supplier folders;
- detects uncertain information;
- can learn new catalog domains;
- improves from verified knowledge/corrections;
- reduces manual categorization.

Do not market unimplemented capabilities as currently available. The landing content must reflect actual production capability at launch.

### 5. Automation value

Recurring value needs to be obvious:

- ongoing synchronization;
- newly discovered products;
- changes/removals handled safely;
- categorization maintained;
- store/domain/infrastructure maintained;
- exceptions surfaced instead of requiring constant manual work.

This section helps justify monthly pricing.

### 6. White-label/custom domain

Show that the merchant's customer sees the merchant brand and domain.

Current contract:

- Catalog Engine marketing: `catalogoengine.com`;
- customer admin: `app.catalogoengine.com`;
- public merchant store: merchant-owned custom domain.

Do not position a Catalog Engine subdomain as the normal paid public-store experience.

### 7. Example storefronts/use cases

Show real or clearly labeled demo tenants once available.

Examples can include:

- sports/team-first navigation;
- fashion/style-first navigation;
- automotive/vehicle/part navigation;
- other verified domains.

Do not fake client logos/testimonials or present prototypes as live customer stores.

### 8. Plans/pricing

Plan cards should emphasize merchant capabilities and outcomes.

Pricing values are configurable commercial data/hypotheses, not hard-coded product truths.

Each plan should clearly communicate:

- price/billing period;
- store allowance;
- important source/sync/feature limits;
- major included capabilities;
- CTA to recurring checkout.

Do not expose infrastructure quotas in technical vendor terminology unless a merchant genuinely needs them.

### 9. FAQ

Should address real conversion concerns such as:

- supported catalog sources;
- domain ownership;
- automatic updates;
- what happens when supplier changes products;
- whether Catalog Engine appears in the public store;
- whether the customer owns their domain;
- cancellation/payment questions;
- product-content/trademark responsibility;
- setup time expectations;
- supported business categories.

### 10. Final CTA

Repeat the strongest action with low ambiguity: choose a plan/start subscription.

## Purchase-before-store rule

The normal self-service CTA must respect:

`choose plan -> recurring checkout -> trusted payment confirmation -> app entitlement -> create store`

Do not create a public onboarding flow that provisions a tenant before billing entitlement unless the documented commercial model is explicitly changed.

## Visual direction

The landing page should feel like a premium technology product that produces retail outcomes.

Desired traits:

- high visual authority;
- strong typography;
- excellent mobile behavior;
- restrained but memorable motion;
- product-led demonstrations;
- generous spacing;
- no generic SaaS-dashboard stock aesthetic;
- no excessive visual noise;
- fast loading;
- clear conversion hierarchy.

Animation must support comprehension, not hide slow/unclear content.

## Mobile-first requirement

A significant share of merchants may discover/buy from mobile. The landing page must be designed deliberately for phone use, not merely squeezed from desktop.

Critical elements such as hero, demo, plan comparison and checkout CTA must remain usable on narrow screens.

## Trust

Trust elements should be factual and verifiable.

Possible elements when available:

- live demo;
- security/privacy explanation;
- custom-domain explanation;
- real customer outcomes/testimonials;
- transparent plan/cancellation language;
- FAQ/legal links;
- support/contact channel.

Do not create fake counters, fake reviews or unsupported performance/AI claims.

## Performance/SEO

The marketing site should have strong web performance and SEO fundamentals:

- semantic HTML;
- meaningful metadata;
- accessible interaction;
- optimized media;
- stable layout;
- no unnecessary client JS;
- structured data when valid;
- crawlable marketing copy;
- sitemap/canonical rules as appropriate.

Do not expose private tenant/source data for SEO.

## Analytics

Landing analytics should eventually measure funnel behavior while respecting privacy requirements.

Useful events include:

- CTA click;
- plan viewed/selected;
- checkout started;
- checkout completed (from trusted backend/billing event for truth);
- login/app handoff.

Never treat a client-side `checkout_success` event as authoritative billing state.

## Legal footer

Before broad sales, provide approved links/content for Terms, Privacy/LGPD and other required commercial policies.

Marketing claims about supported sources, automation and CEI must match production behavior.

## Non-goals

The landing page must not:

- expose admin functionality;
- expose tenant technical identifiers;
- expose source URLs/customer catalogs without authorization;
- become the merchant storefront;
- contain hidden production provisioning shortcuts.

## Final landing decision rule

Every section should answer one of three questions:

> Why do I need this? What will I receive? Why should I pay for it every month?

If a section does none of those, it should justify its presence.