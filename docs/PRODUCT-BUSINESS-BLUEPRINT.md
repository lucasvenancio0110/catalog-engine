# Catalog Engine — Product & Business Blueprint

Status: **Overview / cross-reference document**  
Purpose: summarize the current product direction. Detailed rules live in the focused normative documents listed below.

## Read the focused documents first

Before implementing a change, follow `DOCUMENT-GOVERNANCE.md` and `DOCUMENT-MAP.md`.

The durable product contracts are split by subject:

- `BUSINESS-MODEL.md` — what Catalog Engine sells and the recurring SaaS model;
- `SALES-SUBSCRIPTIONS.md` — purchase funnel and subscription entitlement;
- `LANDING-PAGE.md` — `catalogoengine.com` commercial experience;
- `BILLING-PAYMENTS.md` — recurring billing, entitlement, suspension/reactivation;
- `CUSTOMER-PORTAL.md` — `app.catalogoengine.com` merchant experience;
- `TENANCY.md` — account/store/tenant isolation and lifecycle;
- `CEI.md` — Catalog Engine Intelligence;
- `SAAS-ARCHITECTURE.md` — control plane/data plane implementation architecture.

If this overview ever conflicts with an owning normative document, the owning document wins and this overview should be corrected.

## Product in one sentence

> Catalog Engine transforms product catalogs from supported sources into professional, white-label stores that are understood, organized and kept current automatically.

Yupoo is the first major connector, not the permanent product boundary.

## Business model

Catalog Engine is a recurring B2B SaaS service.

The customer pays for ongoing access to:

- source ingestion;
- Catalog Engine Intelligence (CEI);
- catalog organization/merchandising;
- isolated store/tenant infrastructure;
- controlled storefront themes;
- custom-domain publication;
- synchronization;
- customer portal/operations;
- future analytics/integrations according to plan.

The customer does not receive Catalog Engine source code, GitHub repository, Cloudflare credentials or ownership of the CEI platform.

## Current commercial funnel

The current self-service contract is:

`catalogoengine.com -> choose plan -> recurring checkout -> trusted billing confirmation -> app.catalogoengine.com -> create store -> connect source -> CEI/import -> private preview -> connect domain -> publish -> recurring sync`

A real store/tenant is not provisioned until the account has a valid store-creation entitlement.

A free trial before payment is not currently part of the normative flow unless explicitly reintroduced through a documented product decision.

## Platform surfaces

Current domain roles:

- `catalogoengine.com` — marketing, plans and commercial entry;
- `app.catalogoengine.com` — authenticated customer portal;
- `edge.catalogoengine.com` — stable technical SaaS CNAME target;
- `origin.catalogoengine.com` — internal/fallback origin;
- customer-owned custom domain — public merchant storefront.

The public merchant experience is white-label and should not require a Catalog Engine public subdomain.

## Tenant model

A tenant is one merchant store.

The account/subscription relationship is:

`account -> subscription/entitlements -> one or more tenants/stores`

Each tenant owns its own profile, source connections, CEI tenant memory, catalog data plane, runtime/provider state, domain and synchronization state.

High-volume tenant catalog data is intentionally isolated instead of relying only on a tenant predicate in one shared public catalog database.

## Catalog Engine Intelligence

CEI is the proprietary intelligence layer that:

- normalizes source data;
- detects catalog domain/context;
- resolves known entities/attributes;
- measures confidence and knowledge coverage;
- detects semantic conflicts;
- researches unknown concepts when justified;
- records evidence/provenance;
- learns reusable Knowledge Packs;
- preserves tenant-specific memory separately;
- classifies products;
- creates domain-appropriate merchandising structures.

CEI must not require a paid token-based generative AI API for normal operation. Optional models may be escalation tools only.

## Source independence

The source-adapter boundary allows the platform to support sources such as:

- Yupoo;
- Shopify;
- WooCommerce;
- CSV/Excel;
- PDF;
- APIs;
- ordinary websites;
- JSON/XML;
- future ERP/PIM/catalog systems.

After normalization, CEI reasons about products/evidence rather than provider-specific objects.

## Automation-first operation

Catalog Engine is designed for **autopilot + exception handling**.

Normal customer lifecycle operations should eventually be automatic:

- subscription activation;
- tenant provisioning;
- isolated data-plane/runtime creation;
- source import;
- CEI classification/research;
- private preview;
- domain verification;
- publication;
- incremental synchronization;
- billing grace/suspension/reactivation.

The owner of Catalog Engine should manage exceptions and product/business policy, not manually operate each store.

## Intelligent Sync

Routine synchronization is incremental:

1. lightweight source scan;
2. compare fingerprints/private index;
3. create delta queue;
4. fetch detail only for relevant changes;
5. reclassify affected items when needed;
6. update catalog safely;
7. verify health;
8. promote state only after success.

Partial scans never imply deletion. See `AGENTS.md` synchronization rules and tenant import documents.

## Storefront direction

The storefront is not one fixed catalog layout for all domains.

CEI can produce domain-specific merchandising models, for example:

- sports: league/team/season/product type;
- fashion: category/style/material/color/size;
- automotive: system/part plus evidence-backed vehicle fitment;
- dental: domain-specific component/line/platform structures with stronger evidence for compatibility/technical claims.

Themes remain controlled components/presets so Catalog Engine can maintain quality, responsiveness and upgrades.

## Customer portal direction

The merchant sees business concepts such as:

- Minhas lojas;
- Visão geral;
- Catálogo;
- revisão/attention queue;
- Aparência;
- Fonte/Integrações;
- Domínio;
- Plano e cobrança;
- Conta.

They should not need to understand tenant IDs, D1, Workers, dispatch namespaces or CI/CD.

## Initial go-to-market

Sports/football sellers using supplier catalogs remain a strong first vertical because the existing catalog/classification work provides immediate product evidence.

This is a market-entry focus, not a permanent architecture restriction.

## Pricing

Plan names/prices are hypotheses to validate commercially. Product logic must use plan/entitlement identifiers rather than scattered hard-coded price values.

Differentiation should come from capabilities/scale rather than making the core white-label experience artificially weak.

## Customer vs Catalog Engine responsibility

Catalog Engine owns the SaaS platform, isolation, automation, CEI, supported ingestion, synchronization, portal, themes and platform infrastructure.

The merchant remains responsible for their supplier relationship, legality of goods, rights to product images/trademarks/content, their brand/domain, merchant commerce and their own legal/fiscal obligations.

Catalog Engine subscription billing is separate from merchant end-customer payments.

## Current roadmap principle

The immediate product direction is to turn the already-proven Cloudflare tenant infrastructure into a self-service SaaS:

1. formalize product/architecture contracts in focused docs;
2. build `app.catalogoengine.com` account/store onboarding;
3. enforce recurring billing/entitlements before tenant creation;
4. automate tenant provisioning using the existing isolation architecture;
5. connect source/import/CEI progress to the portal;
6. private preview + appearance;
7. self-service custom-domain publication;
8. build `catalogoengine.com` commercial landing/checkout around the functioning product;
9. evolve CEI/storefront merchandising across domains;
10. add fleet-level automation/observability as customer count grows.

Exact sequencing can change through documented decisions, but tenant isolation, recurring entitlement and automation-first principles must not be bypassed silently.

## Final decision rule

For any feature ask:

> Does this strengthen an automated, recurring, source-independent, multi-tenant catalog platform, or does it hard-code one supplier/store and create manual work?

Prefer the platform.