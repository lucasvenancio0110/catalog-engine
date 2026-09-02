# Catalog Engine — Business Model

Status: **Normative product/business contract**  
Scope: what Catalog Engine is, what it sells, who the customer is, responsibilities and durable commercial principles.

## Product category

Catalog Engine is a **B2B SaaS platform for catalog transformation, organization, publication and synchronization**.

It is not primarily:

- a website agency;
- a marketplace;
- a reseller of customer products;
- a supplier catalog mirror;
- a hosting reseller;
- a one-time website delivery;
- a payment processor for the merchant's end customers;
- a "Yupoo importer" as the final product definition.

The product may start with Yupoo and sports catalogs, but its architecture and positioning must support many catalog sources and retail domains.

## Core promise

> Connect a product source and Catalog Engine turns it into a professional, organized, white-label store that stays synchronized automatically.

The durable value is not extraction alone. It is the combination of:

- source ingestion;
- CEI understanding and classification;
- merchandising structure;
- automation;
- isolated tenant runtime/data;
- controlled storefront quality;
- custom-domain publication;
- continuous synchronization;
- operational maintenance.

## What the customer buys

The customer buys a recurring right to use the Catalog Engine service while the subscription/entitlement is active.

The service can include, according to plan:

- one or more stores;
- source connectors;
- automated import;
- Catalog Engine Intelligence processing;
- incremental synchronization;
- private preview;
- controlled themes/branding;
- custom-domain storefront;
- catalog review tools;
- analytics/operational information;
- team access;
- support/automation features.

The customer does not buy:

- the Catalog Engine source code;
- ownership of the platform Worker/runtime implementation;
- the GitHub repository;
- a copy of the platform database schema;
- ownership of CEI global knowledge;
- Cloudflare infrastructure credentials.

## Revenue model

Primary revenue is **recurring subscription revenue**.

Plans can differentiate by capabilities such as:

- number of stores/tenants allowed;
- number/type of connected sources;
- catalog scale/usage limits;
- synchronization frequency;
- advanced CEI/research features;
- analytics;
- team seats/roles;
- premium themes;
- support/SLA level;
- future integrations.

Pricing values are hypotheses until commercially validated. Architecture must support changing prices without rewriting tenant/product logic.

## Entitlement model

A subscription normally grants entitlements to an **account**. An account may own/manage one or more stores according to its entitlement.

Do not hard-code:

`one user = one tenant`

The intended relationship is:

`account -> trusted entitlements -> stores (tenants)`

For the public commercial path, trusted entitlements normally derive from normalized subscription/billing state. A store may only be provisioned when the server-side entitlement layer allows it.

Product code consumes normalized entitlement authority rather than treating a payment-provider field, browser state or identity-provider claim as direct store authorization.

## Payment gate

Current default product decision:

> The normal public self-service flow requires a successful recurring subscription before the customer can provision their first store.

The commercial sequence is:

`landing page -> plan -> checkout -> payment/subscription confirmed -> customer account/app access -> create store -> tenant provisioning`

A visitor may have a checkout/customer identity before payment, but **normal public tenant/store provisioning is not unlocked until trusted entitlement truth allows it**.

### Bounded first-merchant beta exception

On 2026-09-02 the owner authorized the PB0–PB12 first real merchant campaign before the billing milestone is implemented. During that bounded campaign, an invited pilot account may receive an **explicit, auditable, server-side beta entitlement grant**.

This exception:

- is not a public free trial or freemium launch;
- does not change recurring subscription revenue as the primary business model;
- does not allow anonymous/self-asserted store provisioning;
- must not be implemented as a hard-coded customer email/name/identity-provider subject bypass;
- may initially allow exactly one store/source/private preview;
- must be represented through the normalized entitlement boundary so future billing can become another trusted entitlement source;
- does not authorize recurring Intelligent Sync while the M7E activation authority remains off;
- does not itself authorize public custom-domain publication or claim a paid subscription exists.

The implementation sequence/proof belongs to `PORTAL-BETA-EXECUTION.md`. Broad/public trial strategy remains a separate future commercial decision.

## Automation-first business model

Catalog Engine must scale revenue faster than owner workload.

Default principle:

> Normal customer operations are automated; people handle exceptions.

The Catalog Engine owner should not need to perform a recurring manual action for each customer to:

- create D1/runtime resources;
- import the catalog;
- classify products;
- run sync;
- validate ordinary domains;
- reactivate after successful payment;
- monitor normal background jobs.

Manual owner intervention is acceptable for rare incidents, support or temporary early-stage gaps, but should be visible as technical debt rather than treated as the permanent product workflow.

Creating/revoking an explicit pilot entitlement is a bounded commercial admission decision, not permission to manually provision that pilot's tenant infrastructure.

## White-label contract

The public merchant storefront belongs to the merchant's brand experience.

Current domain roles:

- `catalogoengine.com` — Catalog Engine commercial/marketing site;
- `app.catalogoengine.com` — authenticated customer portal;
- `edge.catalogoengine.com` — stable technical SaaS CNAME target;
- `origin.catalogoengine.com` — internal/fallback origin infrastructure;
- customer-owned domain — public merchant storefront.

Paid public stores should not require mandatory `*.catalogoengine.com` branding/subdomains.

Private previews can exist inside the authenticated app before the merchant domain is ready.

## Source independence

Yupoo is the first important source connector, not the product boundary.

The source layer should support/future-proof:

- Yupoo;
- Shopify;
- WooCommerce;
- CSV/Excel;
- PDF;
- APIs;
- ordinary websites;
- JSON/XML;
- future ERP/PIM/provider connectors.

Catalog Engine owns the normalized internal catalog/merchandising model. The connected source is evidence/input.

## Market strategy

Initial go-to-market can focus on a narrow segment where the product already has a strong advantage, such as sports/football resellers using supplier catalogs.

This is a **go-to-market focus**, not a permanent architecture limitation.

The platform must be capable of expanding into fashion, automotive, dental and other catalog-heavy businesses through CEI Knowledge Packs and source adapters.

## Customer responsibilities

The merchant remains responsible for:

- their business and sales operation;
- legality of goods/services they sell;
- authorization/right to use supplier content, product imagery and trademarks;
- supplier relationship;
- brand data they upload;
- their customer communications;
- their domain registration/renewal;
- taxes/fiscal/legal obligations related to their own commerce;
- accuracy of merchant-provided overrides/claims.

Catalog Engine's white-label implementation does not create intellectual-property rights the merchant does not have.

## Catalog Engine responsibilities

Catalog Engine owns responsibility for the SaaS service it provides, including:

- platform code;
- CEI engine and platform knowledge;
- tenant isolation/security boundaries;
- provisioning automation;
- supported source ingestion;
- sync orchestration;
- controlled storefront software/themes;
- customer portal;
- billing/entitlement enforcement;
- domain routing integration;
- platform observability/reliability;
- product updates.

## Seller-of-record boundary

Unless a future product explicitly changes this contract, Catalog Engine charges the merchant for SaaS access but is **not the seller of record for products sold in the merchant storefront**.

Merchant storefront sales/contact/checkout integrations are merchant commerce behavior, separate from Catalog Engine's own subscription billing.

Do not mix:

- Catalog Engine subscription payments; and
- the merchant's end-customer payments.

They are different domains with different responsibilities.

## Retention logic

Recurring value must remain visible every month. Retention should be driven by ongoing automation, not merely the initial website creation.

Persistent value includes:

- new products discovered automatically when the applicable sync authority is active;
- supplier changes synchronized under the applicable safe sync contract;
- CEI categorization/merchandising updates;
- domain/storefront operation;
- catalog health;
- review exceptions;
- future analytics and integrations.

The product should make it obvious that Catalog Engine continues working after launch, but customer-facing copy must not claim recurring sync is active for a tenant when the operational authority is disabled.

## Commercial hypotheses

Plan names, price points, public trial length, discounts and onboarding fees remain hypotheses until validated.

These may change without changing the fundamental business model provided that:

- access remains entitlement-driven;
- tenant provisioning remains controlled;
- recurring service remains the primary model;
- tenant isolation and white-label rules remain intact.

The bounded PB pilot grant is an explicitly authorized test mechanism, not evidence that a broad trial policy has been adopted.

## Legal readiness

Before broad commercial launch in Brazil, obtain appropriate professional guidance for:

- SaaS Terms of Use;
- Privacy Policy/LGPD;
- recurring billing/cancellation;
- invoicing/fiscal obligations;
- acceptable-use/content rules;
- data retention/deletion;
- merchant responsibility for third-party catalogs/trademarks/media;
- suspension and account termination;
- processor/payment-provider terms.

## Final business decision rule

When evaluating a feature, ask:

> Does this increase the value of a recurring, automated, multi-tenant catalog SaaS, or does it accidentally turn Catalog Engine into manual agency work?

Prefer the former.
