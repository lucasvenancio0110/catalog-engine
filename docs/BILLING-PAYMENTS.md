# Catalog Engine — Billing & Payments

Status: **Normative product/architecture contract**  
Scope: Catalog Engine's own SaaS billing, recurring subscription state, entitlements, payment UX and suspension/reactivation behavior.  
Non-goal: merchant end-customer checkout/payment processing.

## Boundary

Catalog Engine has two completely different payment domains:

1. **Catalog Engine SaaS billing** — the merchant pays Catalog Engine for platform access;
2. **Merchant commerce** — the merchant sells products/services to their own customers.

This document owns only the first.

Do not mix Catalog Engine subscription billing records with merchant-store orders or customer payment data.

## Provider abstraction

Catalog Engine should use a specialized payment provider for recurring checkout, payment-method handling, retries, invoices/receipts and billing-customer management.

The provider may change over time. Core product logic therefore uses normalized internal objects rather than provider-specific fields everywhere.

A provider decision (for example Stripe, Mercado Pago, Pagar.me or another service) requires current commercial/technical evaluation and does not alter the product contract below.

## Billing source of truth

The payment provider is authoritative for transaction/subscription facts.

Catalog Engine stores a normalized local billing mirror to make fast, auditable product decisions.

The local mirror must be updated from trusted server-side events/reconciliation, not from browser claims.

Never trust fields such as:

- `subscription=active` from a client request;
- a checkout success query parameter;
- a manually edited frontend state.

## Webhook/event processing

Provider events must be:

- signature-verified according to the provider contract;
- idempotent;
- stored/audited sufficiently to diagnose state transitions;
- safe to receive more than once;
- tolerant of out-of-order delivery where the provider contract permits it;
- reconciled periodically if webhooks can be missed.

Processing one tenant/account's billing event must not block unrelated customers.

## Normalized billing entities

The control plane should support concepts equivalent to:

### Billing customer

Connects a Catalog Engine account to the provider customer identity.

### Subscription

Represents recurring commercial access.

Useful normalized fields include:

- account ID;
- provider key;
- provider customer reference;
- provider subscription reference;
- plan/product/price key;
- normalized status;
- current period start/end;
- cancel-at-period-end flag;
- canceled timestamp;
- last successful billing timestamp;
- grace/suspension metadata;
- synchronized-at timestamp.

### Entitlements

Derived capabilities consumed by product code, such as:

- maximum active stores;
- allowed source connectors;
- sync tier/frequency;
- team seat count;
- advanced feature access.

Product code should ask the entitlement layer what is allowed instead of repeatedly interpreting raw provider subscription data.

## Store-creation gate

Current invariant:

> An account cannot provision a new tenant/store unless its evaluated entitlement allows it.

For the first self-service store this normally requires an `active` subscription.

The server must re-check entitlement during the store-creation mutation. A hidden/disabled frontend button is not security.

## Normalized subscription states

Catalog Engine should support at least:

- `pending` — checkout/payment not fully confirmed;
- `active` — valid recurring entitlement;
- `past_due` — payment issue requiring retry/grace policy;
- `grace` — temporary continued service under Catalog Engine policy;
- `canceled` — renewal canceled; paid-through period may remain active;
- `suspended` — service disabled by billing/administrative policy;
- `expired` — entitlement period ended.

Provider-specific state mappings must be tested.

## Grace period

A failed charge must not immediately erase or destroy a tenant.

Desired lifecycle:

`active -> payment failure -> past_due -> grace/retries -> active OR suspended`

Exact grace duration is configurable commercial policy and must be documented when chosen.

During grace:

- the app should clearly warn the account owner;
- billing recovery should be easy;
- destructive data-plane actions must not occur merely because a payment failed.

## Suspension

Suspension is a reversible access state, not deletion.

A billing suspension may restrict:

- customer portal actions;
- creation of new stores;
- publication/access to storefront according to chosen policy;
- sync/background work according to chosen policy.

The exact customer-facing suspension behavior must be decided deliberately before launch and tested. Do not silently delete D1/runtime/media resources on first suspension.

## Reactivation

Normal reactivation is automatic:

`trusted successful billing state -> normalized subscription active -> entitlements restored -> eligible services/reactivation resumes`

Do not require the Catalog Engine owner to manually unlock a paid customer under ordinary circumstances.

## Cancellation

Support cancellation at period end unless a different legal/commercial flow is required.

Cancellation must track:

- whether renewal is disabled;
- paid-through date;
- when entitlement actually ends;
- retention/deletion schedule if later implemented.

`cancel renewal` is not the same event as `delete account`.

## Data retention after subscription end

Current safe default:

- do not immediately delete catalog/tenant data when access expires;
- move the account/store into a restricted state;
- retention/deletion policy must be explicitly defined before automated destruction is implemented;
- legal/LGPD/customer-requested deletion workflows are separate governed processes.

## Billing UI in `app.catalogoengine.com`

The portal should have a customer-facing section such as **Plano e cobrança**.

It should show merchant concepts, not provider internals:

- current plan;
- monthly/annual billing period;
- next renewal date;
- subscription status;
- store allowance/usage;
- key included features;
- payment-method management entry;
- invoices/receipts when available;
- change plan;
- cancel/manage subscription;
- billing alerts/recovery CTA.

Do not expose raw webhook IDs, provider status codes or Cloudflare costs to ordinary customers.

## Billing banner behavior

The app can show contextual banners:

### Active

No warning needed.

### Past due / grace

Clear warning + fix-payment CTA + grace information.

### Canceled at period end

Explain access-through date and reactivation option.

### Suspended/expired

Explain why access is restricted and provide a recovery path when allowed.

## Plan changes

Upgrades/downgrades are provider/billing operations followed by entitlement recalculation.

Important invariant:

> A downgrade may restrict future actions, but must not silently destroy existing tenants/resources to force plan compliance.

Over-limit state needs a deliberate UX/policy.

## Multiple stores

Entitlements govern store count.

Example:

- plan allows 1 store;
- account has 1 active store;
- `Criar nova loja` is unavailable until upgrade/add-on entitlement is active.

If the plan changes to 3 stores, the capability becomes available after trusted billing confirmation.

## Admin overrides

If Catalog Engine later needs complimentary/internal/pilot access, implement explicit auditable entitlement grants.

Never use hard-coded customer email/domain bypasses.

Admin grants should have:

- reason;
- authorizing principal;
- start/end date when appropriate;
- capabilities granted;
- audit trail.

## Security/privacy

Do not store raw card data in Catalog Engine when the payment provider can own it.

Billing APIs must require authenticated account context and authorization.

Tenant/store APIs must not accept provider billing references as authorization proof.

## Observability

Track operational metrics such as:

- active subscriptions;
- checkout success/failure;
- webhook failure/retry;
- past-due accounts;
- recovered payments;
- suspensions;
- reactivations;
- subscription-to-store activation time;
- churn/cancellation reason when legitimately collected.

Sensitive payment information must not appear in general application logs.

## Automation-first rule

The normal monthly lifecycle must be automatic:

`charge/renew -> provider event -> billing mirror -> entitlement -> continue`

or

`failed charge -> retry/grace -> suspension if necessary -> automatic reactivation after recovery`

The owner of Catalog Engine should manage exceptions and business policy, not manually check every payment.

## Final billing decision rule

Product code should never ask:

> Did the frontend say the user paid?

It should ask:

> What does trusted normalized billing state say this account is entitled to do right now?