# Catalog Engine — Customer Portal

Status: **Normative product/UX contract**  
Primary surface: `https://app.catalogoengine.com`  
Scope: authenticated customer experience after the account has a trusted entitlement to use the applicable portal capability.

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

The normal public self-service contract remains:

`recurring checkout -> trusted billing confirmation -> app entitlement -> first-store onboarding`

A customer can authenticate into account/billing recovery flows when necessary, but store provisioning is gated by trusted server-side entitlements.

### First real merchant beta exception

The owner-authorized PB0–PB12 campaign may admit an invited pilot account through an **explicit, auditable, server-side beta entitlement grant** instead of a completed recurring subscription. This is a bounded sales-assisted exception, not a public free trial and not a browser claim.

For the initial beta policy:

- the grant may permit one store;
- the portal consumes only the evaluated entitlement projection;
- `POST /api/admin/stores` must enforce the allowance server-side;
- the grant must not be implemented as a hard-coded email/name/provider-subject bypass;
- grant expiry/revocation restricts future capability but must not silently destroy tenant data;
- billing remains the default entitlement source for the future public funnel.

The detailed temporary execution order and proof gates are owned by `PORTAL-BETA-EXECUTION.md`.

## First-login experience

A newly entitled customer should not land in a dense empty dashboard.

Preferred first state:

- welcome message;
- plan/store allowance summary appropriate to the current entitlement source;
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

The PB campaign may place bounded branding inputs before source connection when that improves the first merchant flow, provided the durable backend lifecycle and publication gates are unchanged.

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

A label is permitted only when the backend state/counter used to support it has been explicitly mapped. If the current backend can prove only a coarser step, show the coarser truth rather than inventing an intermediate state.

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

- must require authorized app context;
- must resolve membership and the effective tenant server-side;
- must not accept a client-supplied Worker/runtime locator as authority;
- must not accidentally become the permanent public merchant URL;
- should use the same effective tenant catalog/theme behavior that will be published;
- should clearly show publication/domain status;
- must fail closed rather than falling back to the default tenant when preview authority is missing or invalid.

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

The first real merchant beta is allowed to implement only the minimum creation/import/progress/preview/home surfaces. That bounded work does not declare the full Customer Portal milestone complete.

## Multi-store behavior

An account may own/manage more than one store according to entitlements.

The portal should therefore have:

- a **Minhas lojas** entry/home;
- clear current-store context;
- a store selector when more than one store exists;
- per-store data scoped server-side;
- `Criar nova loja` governed by entitlements.

Do not implement client-only tenant switching where the server trusts the UI's selected tenant without membership checks.

The initial pilot grant can deliberately limit `maxStores=1`; that beta policy does not change the multi-store architecture.

## Visão geral

The overview should quickly answer:

> Minha loja está funcionando e o Catalog Engine está trabalhando por mim?

Useful information:

- store status (`configurando`, `pronta`, `online`, `atenção`, `suspensa`);
- product count;
- catalog/domain health;
- last successful sync when recurring sync is actually active for that tenant;
- new/updated/removed counts only when a production-safe activity authority exists;
- items needing review;
- domain status;
- major onboarding blockers.

Avoid decorative charts that do not help a merchant take action.

Do not describe recurring Intelligent Sync as active for a beta tenant while the global recurring-sync authority remains disabled.

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

The UI must not fabricate this feed before the safe tenant-scoped event/review-feed authority is delivered.

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

Uploaded tenant assets require validated ownership/storage, MIME/size/decoding boundaries and safe public identifiers. Large base64 assets do not belong in D1. SVG upload must remain disabled until an explicit active-content sanitization/security decision exists.

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

Custom-domain publication is not required for the first PB private-preview acceptance test.

## Plano e cobrança

Follow `BILLING-PAYMENTS.md`.

The customer should be able to understand:

- current plan/entitlement state in merchant language;
- status;
- next renewal when billing exists;
- store allowance/usage;
- payment recovery when billing exists;
- invoice/receipt access when supported;
- upgrade/downgrade/cancel entry points when implemented.

Do not expose raw webhook IDs, provider status codes or Cloudflare costs to ordinary customers.

A pilot grant must not be presented as a paid subscription or a fabricated renewal date.

## Authentication and roles

Identity/authentication is external/provider-neutral according to `SAAS-ARCHITECTURE.md`.

Catalog Engine authorizes access using opaque principals/account entitlements and tenant memberships/roles.

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

A beta grant may be expired/revoked without deleting the merchant's tenant; exact restricted behavior is governed by the entitlement implementation and later billing policy.

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

Do not surface raw stack traces/provider responses, supplier URLs, D1 UUIDs, Worker locators or Cloudflare IDs.

## Automation-first rule

The portal should orchestrate self-service automation.

A successful customer journey should not require the Catalog Engine owner to manually create a tenant, D1 database, Worker, source import, domain route or recurring sync.

A bounded operator-created beta entitlement grant is a commercial access decision, not a per-tenant infrastructure shortcut. After the grant exists, the normal tenant lifecycle must still be automated.

Admin/operator intervention is for exceptions.

## Final portal decision rule

Whenever a screen exposes an implementation detail, ask:

> Does the merchant need this to run their store, or are we making them operate our infrastructure?

If it is infrastructure, keep it behind Catalog Engine.
