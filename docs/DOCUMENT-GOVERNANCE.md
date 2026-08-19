# Catalog Engine — Document Governance

Status: **Normative**  
Applies to: product, business, architecture, UX, billing, intelligence and operations  
Purpose: keep implementation and product decisions aligned as Catalog Engine evolves.

## Core rule

Documentation is part of the product contract, not optional project notes.

Before changing or adding behavior, every human or AI contributor must:

1. identify the affected product/technical area;
2. read `AGENTS.md`;
3. read `docs/DOCUMENT-MAP.md`;
4. read every normative document mapped to that area;
5. inspect adjacent implementation documents when the change crosses boundaries;
6. compare the proposed change with documented invariants;
7. change code only after that comparison;
8. update the relevant document in the same PR when the intended behavior changes;
9. run the required quality gates and inspect CI results before merge.

A change is incomplete when the code and the documents disagree.

## No silent contradiction

Do not knowingly implement behavior that contradicts a normative document.

If a new decision should replace an existing instruction:

1. update the owning document explicitly;
2. explain the changed decision in the PR body;
3. update cross-references or dependent documents when required;
4. add/adjust tests for the new contract;
5. only then merge the implementation.

The correct action is **change the instruction deliberately**, not ignore it.

## Document ownership

Each normative document owns one bounded subject. Avoid creating a single giant document that becomes the authority for unrelated areas.

Current product-level documents include:

- `CEI.md` — Catalog Engine Intelligence;
- `BUSINESS-MODEL.md` — what the company/product sells and does not sell;
- `SALES-SUBSCRIPTIONS.md` — sales funnel, plans and recurring access contract;
- `LANDING-PAGE.md` — commercial site experience and conversion rules;
- `BILLING-PAYMENTS.md` — billing state, recurring payments and billing UI;
- `CUSTOMER-PORTAL.md` — `app.catalogoengine.com` customer experience;
- `TENANCY.md` — account/store/tenant boundaries and isolation contract.

Existing architecture/implementation documents remain authoritative for their narrower technical areas, including `SAAS-ARCHITECTURE.md`, `CUSTOM-DOMAINS.md`, `TENANT-DATA-PLANES.md`, `TENANT-IMPORT-PIPELINE.md`, `TENANT-CLASSIFY-VERIFY.md`, `TENANT-PUBLISH.md` and related documents.

## Normative hierarchy

Use this order when interpreting instructions:

1. security, privacy and safety invariants in `AGENTS.md`;
2. this governance document;
3. the document that explicitly owns the affected product area;
4. narrower implementation documents for the affected subsystem;
5. historical/overview documents such as `PRODUCT-BUSINESS-BLUEPRINT.md`.

A lower-level document may be more technically specific, but it may not silently overturn a higher-level business/security invariant. If two current normative documents genuinely conflict, stop the implementation and resolve the documentation conflict in the same PR.

## Product decisions vs implementation details

Documents must distinguish between:

- **Invariant** — must remain true unless explicitly changed by product/architecture decision;
- **Current decision** — selected approach for the current product stage;
- **Hypothesis** — subject to commercial/user validation;
- **Implementation option** — technology that may be replaced without changing the product contract.

Do not accidentally turn a hypothesis into a permanent technical restriction.

## Documentation update triggers

Update the owning document whenever a change affects any of these:

- business model or customer responsibility;
- subscription or entitlement rules;
- tenant lifecycle or isolation boundary;
- customer onboarding order;
- payment/suspension/reactivation behavior;
- public domain/white-label behavior;
- CEI learning, confidence, research or memory behavior;
- source types or ingestion contract;
- customer portal navigation/permissions;
- landing-page promise, plan presentation or checkout flow;
- public API/data contract;
- irreversible operational behavior.

Pure refactors that preserve documented behavior do not require rewriting the product contract, but the contributor still must read the relevant documents first.

## Documentation metadata

New normative documents should state at minimum:

- title;
- status;
- scope/purpose;
- invariants;
- owned decisions;
- boundaries/non-goals;
- cross-document dependencies when relevant.

Do not put secrets, customer credentials, provider tokens or private supplier URLs in documentation.

## PR discipline

Every PR must answer internally:

- Which documents were read?
- Which documented contracts are affected?
- Does the change preserve them?
- If not, which documents were updated and why?

Behavior-changing PRs should mention documentation updates in the PR description.

## Automation-first documentation rule

Catalog Engine is intended to operate with minimal owner intervention. When a proposed feature introduces per-customer manual work for the Catalog Engine owner, the relevant document must explicitly justify why the manual step is temporary or unavoidable.

Default product principle:

> Automate normal operations; surface only exceptions.

## Final rule

Before implementing a new idea, do not ask only “can we build this?”. Ask:

> What existing Catalog Engine contract does this touch, and what do the owning documents require?

That question must remain part of the development process.