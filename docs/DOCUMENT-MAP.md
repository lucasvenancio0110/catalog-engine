# Catalog Engine — Document Map

Status: **Normative index**  
Purpose: define which documents must be read before each class of change.

## Always read first

Before any repository change:

1. `AGENTS.md`
2. `docs/DOCUMENT-GOVERNANCE.md`
3. this file

For any material product/architecture change, also inspect:

- `docs/CURRENT-STATE.md` — what is actually implemented/proven now;
- `docs/DEVELOPMENT-ROADMAP.md` — the current execution milestone/order.

The state/roadmap documents do not override focused normative contracts. They prevent a contributor from treating a completed activation as future work or building a future milestone out of order without an explicit decision.

Then read the documents mapped to the affected area below.

## CEI / classification / learning / research

Required:

- `docs/CEI.md`
- `docs/TENANT-CLASSIFY-VERIFY.md`
- `docs/TENANCY.md` when knowledge/memory is tenant-scoped
- `docs/TENANT-IMPORT-PIPELINE.md` when classification is part of ingestion

Also inspect relevant sync/source documents when changing source evidence or reclassification behavior.

## Business model / product positioning

Required:

- `docs/BUSINESS-MODEL.md`
- `docs/SALES-SUBSCRIPTIONS.md`

Also read `docs/PRODUCT-BUSINESS-BLUEPRINT.md` for overview context and `docs/DEVELOPMENT-ROADMAP.md` before turning a long-term capability into launch scope.

## Landing page / marketing / conversion

Required:

- `docs/LANDING-PAGE.md`
- `docs/BUSINESS-MODEL.md`
- `docs/SALES-SUBSCRIPTIONS.md`
- `docs/DESIGN-SYSTEM.md`
- `docs/BILLING-PAYMENTS.md` when checkout/pricing/payment behavior is shown

Marketing claims must be checked against `docs/CURRENT-STATE.md` so future/experimental capabilities are not presented as production features.

## Billing / checkout / subscriptions / entitlements

Required:

- `docs/BILLING-PAYMENTS.md`
- `docs/SALES-SUBSCRIPTIONS.md`
- `docs/TENANCY.md`
- `docs/SAAS-ARCHITECTURE.md`
- `docs/CUSTOMER-PORTAL.md` for customer-facing billing/recovery UX

## Customer portal / `app.catalogoengine.com`

Required:

- `docs/CUSTOMER-PORTAL.md`
- `docs/DESIGN-SYSTEM.md`
- `docs/TENANCY.md`
- `docs/SAAS-ARCHITECTURE.md`

Additionally:

- billing screens → `docs/BILLING-PAYMENTS.md`;
- source onboarding → `docs/TENANT-IMPORT-PIPELINE.md` and source-specific docs;
- catalog review → `docs/CEI.md` and `docs/TENANT-CLASSIFY-VERIFY.md`;
- domains → `docs/CUSTOM-DOMAINS.md` and `docs/TENANT-PUBLISH.md`.

## Tenant / account / store / isolation

Required:

- `docs/TENANCY.md`
- `docs/SAAS-ARCHITECTURE.md`
- `docs/TENANT-DATA-PLANES.md`
- `docs/TENANT-RUNTIME-DISPATCH.md` when runtime routing is affected

## Provisioning / store creation

Required:

- `docs/TENANCY.md`
- `docs/CUSTOMER-PORTAL.md`
- `docs/SAAS-ARCHITECTURE.md`
- `docs/TENANT-DATA-PLANES.md`
- `docs/TENANT-IMPORT-PIPELINE.md`
- `docs/TENANT-PUBLISH.md`

If a domain is touched, also read `docs/CUSTOM-DOMAINS.md`.

If customer-facing progress/onboarding changes, also read `docs/DESIGN-SYSTEM.md`.

## Domains / Cloudflare for SaaS / publication

Required:

- `docs/CUSTOM-DOMAINS.md`
- `docs/TENANT-PUBLISH.md`
- `docs/TENANT-RUNTIME-DISPATCH.md`
- `docs/TENANCY.md`
- `docs/SAAS-ARCHITECTURE.md`
- `docs/CURRENT-STATE.md` for the currently proven production activation boundary

Historical activation/readiness documents may explain how a milestone was reached but must not be used as the source of current production truth.

## Source connectors / importers

Required:

- `docs/CEI.md` for the source-neutral normalization boundary
- `docs/TENANT-IMPORT-PIPELINE.md`
- `docs/TENANT-IMPORT-SCAN.md`
- `docs/TENANT-IMPORT-DETAILS.md`
- `AGENTS.md` scraper/synchronization rules

Source-specific knowledge must not become public taxonomy truth.

## Synchronization

Required:

- `AGENTS.md` synchronization rules
- `docs/TENANT-IMPORT-PIPELINE.md`
- relevant scan/detail/import documents
- `docs/CEI.md` if sync triggers reclassification/learning
- `docs/CURRENT-STATE.md` when changing a production/default-catalog publication path

## Storefront / themes / merchandising UX

Required:

- `docs/DESIGN-SYSTEM.md`
- `docs/CEI.md` for canonical merchandising output
- `docs/BUSINESS-MODEL.md` for white-label/customer promise
- `docs/CUSTOMER-PORTAL.md` when appearance configuration changes
- `AGENTS.md` Vite/storefront rules

Customer-facing work must meet the responsive/loading/empty/error/touch/keyboard/accessibility Definition of Done defined by `DESIGN-SYSTEM.md`.

## Design system / responsive behavior / interaction

Required:

- `docs/DESIGN-SYSTEM.md`
- `AGENTS.md`
- the focused product contract for the affected surface (`CUSTOMER-PORTAL.md`, `LANDING-PAGE.md`, CEI/storefront docs as applicable)

If the change introduces a new dependency, also follow the dependency/library mapping below.

## Authentication / authorization

Required:

- `docs/SAAS-ARCHITECTURE.md`
- `docs/TENANCY.md`
- `docs/CUSTOMER-PORTAL.md`

## Dependency / library changes

Required:

- `AGENTS.md`
- `docs/JAVASCRIPT_LIBRARIES.md`
- `docs/DESIGN-SYSTEM.md` for customer-facing UI/test-tooling dependencies
- the owning product/technical document for the feature that needs the dependency

A library is approved by responsibility, not because it is fashionable or visually attractive in isolation.

## Roadmap / launch-scope changes

Required:

- `docs/DEVELOPMENT-ROADMAP.md`
- `docs/CURRENT-STATE.md`
- every focused normative document whose product behavior/scope changes

If a roadmap decision changes a durable product contract (for example introducing trial before payment), the focused normative documents must be updated in the same PR. The roadmap alone cannot override them.

## Rule for cross-cutting changes

If a change touches more than one area, read the union of all mapped documents. Do not choose only the most convenient one.

## Rule for new areas

If a new subsystem does not fit this map:

1. decide which existing contract it affects;
2. read those documents;
3. create a focused normative document if the subsystem has durable rules of its own;
4. add it to this map in the same PR.

The document map must evolve together with the architecture.