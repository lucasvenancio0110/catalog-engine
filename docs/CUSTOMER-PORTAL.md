# Catalog Engine — Customer Portal

Status: **Normative product/UX contract**  
Primary surface: `https://app.catalogoengine.com`  
Scope: authenticated customer experience after subscription entitlement is valid.

## Purpose

The customer portal is the merchant's operational home for Catalog Engine.

It must translate complex infrastructure into simple merchant concepts. The customer should feel that they are creating/managing a store, not operating Cloudflare infrastructure.

## Language rule

Ordinary customer UI must not expose implementation terms such as:

- tenant;
- D1;
- Worker;
- namespace;
- dispatch;
- Cloudflare for SaaS;
- provisioning job;
- database ID;
- migration number;
- internal source locator.

Use merchant language:

- loja;
- catálogo;
- produtos;
- fornecedor/fonte;
- sincronização;
- aparência;
- domínio;
- publicação;
- plano e cobrança.

## Entry condition

Current self-service contract:

`recurring checkout -> trusted billing confirmation -> app entitlement -> first-store onboarding`

A customer can authenticate into account/billing recovery flows when necessary, but store provisioning is gated by valid entitlements.

## First-login experience

A newly paid customer should not land in a dense empty dashboard.

Preferred first state:

- welcome message;
- plan/store allowance summary;
- one clear CTA: **Criar minha primeira loja**.

The shortest path to first value is more important than exposing every setting immediately.

## Store creation flow

The initial onboarding should be short, progressive and resumable.

Suggested stages:

1. **Identidade da loja** — name, optional logo, public contacts;
2. **Adicionar produtos/fonte** — initially Yupoo, later other connectors;
3. **Análise** — source validated/scanned;
4. **CEI** — domain/structure/classification processing;
5. **Primeira versão pronta** — private preview;
6. **Aparência** — controlled theme/brand settings;
7. **Domínio** — customer-owned hostname connection;
8. **Publicação** — only after health/domain checks pass.

The exact screen count can evolve, but the durable provisioning state must remain resumable.

## Source-selection UX

The product-level label should be broader than Yupoo even if only Yupoo is initially enabled.

Example:

**Adicionar produtos** / **Conectar catálogo**

Possible connectors over time:

- Yupoo;
- Shopify;
- WooCommerce;
- CSV/Excel;
- PDF;
- API;
- site/catalog URL.

Disabled/unreleased connectors must not pretend to work. They may be omitted or explicitly labeled as future/waitlist only when commercially useful.

## Analysis/progress UX

Do not show fake percentages.

Use real durable stages/checkpoints such as:

- fonte encontrada;
- estrutura analisada;
- produtos detectados;
- entendendo o segmento;
- organizando catálogo;
- preparando preview;
- aguardando domínio;
- publicando.

If a stage is long-running, the customer can leave the page and return without losing progress.

## CEI explanation

The portal may present merchant-friendly CEI results such as:

- detected segment/domain;
- number of products;
- categories/facets/entities found;
- products automatically organized;
- items needing merchant attention;
- new concepts learned/researched when appropriate.

Do not expose unverifiable "AI magic" claims or raw internal reasoning.

## Review queue

The merchant must not be asked to review thousands of products by default.

The portal should surface only exceptions such as:

- low-confidence classification;
- ambiguous entity;
- conflicting source evidence;
- merchant-specific naming decision;
- technical claim requiring confirmation.

A confirmed merchant override becomes durable tenant memory according to `CEI.md`.

## Private preview

Before a custom domain is active, the merchant can view the store through an authenticated/private preview.

The preview:

- must not accidentally become the permanent public merchant URL;
- must not expose another tenant;
- should use the same effective tenant catalog/theme behavior that will be published;
- should clearly show publication/domain status.

## Main portal information architecture

The initial sellable portal should remain compact.

Recommended primary areas:

- **Visão geral**
- **Catálogo**
- **Aparência**
- **Domínio**
- **Integrações / Fonte**
- **Plano e cobrança**
- **Conta**

As capabilities grow, navigation can evolve without exposing infrastructure.

## Multi-store behavior

An account may own/manage more than one store according to entitlements.

The portal should therefore have:

- a **Minhas lojas** entry/home;
- clear current-store context;
- a store selector when more than one store exists;
- per-store data scoped server-side;
- `Criar nova loja` governed by entitlements.

Do not implement client-only tenant switching where the server trusts the UI's selected tenant without membership checks.

## Visão geral

The overview should quickly answer:

> Minha loja está funcionando e o Catalog Engine está trabalhando por mim?

Useful information:

- store status (`configurando`, `pronta`, `online`, `atenção`, `suspensa`);
- product count;
- catalog/domain health;
- last successful sync;
- new/updated/removed counts;
- items needing review;
- domain status;
- major onboarding blockers.

Avoid decorative charts that do not help a merchant take action.

## Activity/feed

A high-value recurring feature is a simple activity feed:

- new products added;
- products updated;
- confirmed removals;
- newly learned/organized groups;
- sync completed;
- domain activated;
- review needed;
- billing action required.

This helps the merchant see monthly recurring value.

## Catálogo

The catalog area is a merchandising tool, not only a CRUD table.

Capabilities can include:

- search;
- filters/facets;
- canonical categories;
- domain-specific entities (teams, brands, vehicle relationships, etc.);
- new/updated/review/hidden/manual-override views;
- product detail/edit where merchant changes are allowed;
- bulk safe actions when justified.

Manual overrides must survive source sync unless the merchant explicitly clears them.

## Aparência

Catalog Engine should provide controlled quality, not arbitrary customer code execution.

Customers may configure supported items such as:

- logo;
- primary/secondary colors;
- controlled theme/preset;
- supported home sections/order;
- banners/brand assets;
- public contacts.

Do not allow arbitrary uploaded JS/HTML in the storefront.

## Domínio

The domain experience should simplify Cloudflare for SaaS behavior into merchant steps.

Desired flow:

1. merchant enters customer-owned domain;
2. Catalog Engine creates/records domain connection state;
3. portal shows exact DNS instruction when customer action is required;
4. automatic checks detect DNS;
5. certificate/hostname/routing health is checked;
6. storefront smoke test runs;
7. publish becomes available/automatic according to policy.

Customer-facing statuses can include:

- aguardando configuração;
- verificando DNS;
- emitindo certificado;
- conectado;
- erro/ação necessária.

Technical target such as `edge.catalogoengine.com` may appear only when it is genuinely needed as the DNS value the merchant must copy.

## Plano e cobrança

Follow `BILLING-PAYMENTS.md`.

The customer should be able to understand:

- current plan;
- status;
- next renewal;
- store allowance;
- payment recovery;
- invoice/receipt access when supported;
- upgrade/downgrade/cancel entry points.

## Authentication and roles

Identity/authentication is external/provider-neutral according to `SAAS-ARCHITECTURE.md`.

Catalog Engine authorizes access using account/tenant memberships and roles.

Potential roles:

- owner;
- admin;
- editor;
- viewer.

Sensitive actions require appropriate roles and audit events.

## Billing-restricted states

The portal must remain useful for recovery when a subscription has a payment issue.

Do not lock the merchant out of the only screen where they can fix billing.

Past-due/suspended accounts should receive clear explanation and recovery CTA according to `BILLING-PAYMENTS.md`.

## Mobile UX

The portal must be fully usable on mobile. Many merchants may administer the service from phones.

Do not simply shrink a desktop sidebar. Use mobile navigation patterns appropriate to the number of primary areas and maintain clear current-store context.

## Accessibility/performance

The portal should have:

- keyboard/accessibility semantics where applicable;
- readable contrast;
- robust loading/error/empty states;
- no fake progress;
- responsive layouts;
- fast navigation;
- resilient long-running job status polling/event updates.

## Error philosophy

Customer-facing errors should answer:

- what happened;
- whether Catalog Engine will retry automatically;
- whether the customer needs to do anything;
- what action is required when there is one.

Do not surface raw stack traces/provider responses.

## Automation-first rule

The portal should orchestrate self-service automation.

A successful customer journey should not require the Catalog Engine owner to manually create a tenant, D1 database, Worker, source import, domain route or recurring sync.

Admin/operator intervention is for exceptions.

## Final portal decision rule

Whenever a screen exposes an implementation detail, ask:

> Does the merchant need this to run their store, or are we making them operate our infrastructure?

If it is infrastructure, keep it behind Catalog Engine.