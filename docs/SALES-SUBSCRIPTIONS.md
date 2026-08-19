# Catalog Engine — Sales & Subscriptions

Status: **Normative commercial/product contract**  
Scope: acquisition funnel, plan selection, recurring subscription entitlement, cancellation/suspension principles and sales-to-product handoff.

## Commercial objective

Catalog Engine should convert a visitor into a paying SaaS customer and then hand that customer into an automated onboarding flow with minimal operator involvement.

The canonical self-service funnel is:

`landing -> plan selection -> recurring checkout -> billing confirmation -> account/app access -> create store -> connect source -> CEI -> preview -> domain -> publish -> recurring sync/value`

## Current gating decision

The first store is not provisioned before the recurring subscription is confirmed as valid.

The authoritative gate is backend billing state, not a frontend "payment successful" screen.

A successful redirect from checkout is not sufficient proof by itself. Catalog Engine waits for trusted provider state/webhook reconciliation before granting provisioning entitlement.

## Account vs store

A customer account can exist as an identity/billing object before it owns a store.

Subscription entitlements belong to the account. Stores are tenants created under those entitlements.

This enables plans such as:

- one-store account;
- multi-store account;
- agency/reseller account in the future;
- additional store add-ons in the future.

Do not couple the core model to `one login = one store`.

## Plan design

Plans should communicate merchant value, not Cloudflare/resource internals.

Good differentiators include:

- allowed store count;
- source count/type;
- catalog scale/usage;
- sync frequency;
- advanced CEI/research features;
- analytics;
- teams/roles;
- theme/features;
- support level.

Do not sell plans based on terms such as D1 databases, Worker requests or dispatch namespace.

## Pricing

Prices remain a business hypothesis until validated.

The application must store stable plan/product identifiers separately from display price so pricing can change for new customers without breaking existing subscriptions.

Support concepts such as:

- monthly billing;
- future annual billing;
- coupons/promotions;
- grandfathered/legacy price references;
- plan upgrades/downgrades;
- store-count add-ons if commercially useful.

Do not hard-code monetary values throughout product logic.

## Checkout principles

Checkout must be simple and trustworthy.

The landing page should send the visitor into a provider-backed recurring checkout or equivalent secure payment flow.

Catalog Engine should not collect raw card data itself when a payment provider can own PCI-sensitive collection.

After checkout:

1. provider creates/updates billing customer;
2. provider creates subscription/payment state;
3. trusted webhook/reconciliation updates Catalog Engine billing mirror;
4. entitlement engine evaluates access;
5. customer enters the app with the correct capabilities.

## Billing truth

The payment provider is authoritative for monetary transaction/subscription state. Catalog Engine maintains a normalized local mirror for product decisions.

The local mirror must be idempotent and auditable.

Never grant access solely from client-supplied subscription fields.

## Subscription states

The normalized model should support states such as:

- `pending` — checkout/payment not yet confirmed;
- `active` — entitlement granted;
- `past_due` — payment problem; grace policy may apply;
- `grace` — temporary continued access under Catalog Engine policy;
- `canceled` — recurring renewal ended; access depends on paid-through date/policy;
- `suspended` — service intentionally unavailable;
- `expired` — entitlement ended.

Provider-specific states are mapped into this normalized contract.

## Failed payment

A single payment failure should not delete a store or tenant data.

Desired policy shape:

`payment failure -> past_due -> provider retry/grace -> unresolved -> controlled suspension`

The exact number of days is a commercial policy/hypothesis and should be configurable/documented when selected.

During suspension, tenant resources/data are preserved unless separate retention policy later authorizes deletion.

## Reactivation

When trusted billing state returns to a valid entitlement:

`provider confirmation -> billing mirror active -> entitlement restored -> eligible store(s) reactivate automatically`

Normal reactivation should not require owner intervention.

## Cancellation

Cancellation should distinguish:

- cancel at period end;
- immediate cancellation when explicitly supported/required;
- suspension for nonpayment;
- account/data deletion request.

These are not the same event.

Canceling future renewal must not immediately erase tenant data unless the paid access period has ended and retention rules say so.

## Upgrades/downgrades

Plan changes must be entitlement-driven.

Examples:

- upgrade from 1 to 3 stores: new store creation becomes available after trusted billing state confirms the entitlement;
- downgrade from 3 to 1 stores: do not silently destroy 2 stores. Product policy must require the merchant to resolve over-limit stores or enter a controlled restricted state.

## Sales-assisted exceptions

Early pilot customers may require manual commercial handling, but exceptions must still end in normalized billing/entitlement state.

Do not create hidden permanent bypasses such as `if customerEmail === ...`.

Use explicit administrative entitlement/grant records if a legitimate exception becomes necessary.

## Trial policy

Current self-service contract is payment before store provisioning.

A free trial is **not currently part of the normative funnel**. If introduced later, update this document, `BUSINESS-MODEL.md`, `LANDING-PAGE.md`, `BILLING-PAYMENTS.md` and relevant entitlement tests together.

## Landing-to-app handoff

After confirmed purchase, the customer should experience a continuous transition:

1. payment confirmed;
2. account/session established or account creation completed;
3. redirect to `app.catalogoengine.com`;
4. entitlement check;
5. first-store onboarding CTA.

The user should not need to re-enter plan/payment data inside the app.

## Sales messaging

Sell outcomes:

- professional own-brand catalog/store;
- organized products;
- automatic updates;
- own domain;
- less manual catalog work;
- multiple source possibilities over time;
- CEI intelligence/organization;
- ongoing operation.

Avoid positioning the product as "we scrape Yupoo".

## Conversion proof

The strongest demonstration is transformation:

`raw supplier catalog -> Catalog Engine -> organized branded storefront`

The commercial site should make this before/after obvious.

## Metrics

The business should eventually measure:

- landing visitor -> plan click;
- plan click -> checkout started;
- checkout started -> paid subscription;
- paid -> first store created;
- store created -> source connected;
- source connected -> preview ready;
- preview -> domain published;
- first month -> renewal;
- churn/cancellation reasons;
- payment failure recovery;
- time-to-first-value.

These metrics should not leak private tenant catalog data.

## Automation-first sales operations

Successful payment, entitlement activation, suspension and reactivation should be event-driven and automatic.

The Catalog Engine owner should not manually verify each customer payment.

## Final decision rule

A commercial feature is aligned when it makes this path simpler and more reliable:

> Pay for recurring access, receive the entitled product automatically, and keep receiving visible value every month.