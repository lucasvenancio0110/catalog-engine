# Catalog Engine — Development Continuity

Status: **Normative execution-continuity contract**  
Scope: milestone decomposition, evidence labels, AI/contributor startup, execution tracking and handoff updates.  
Purpose: let a new human or AI continue development from live truth without inventing scope, repeating completed work or advancing an unproven milestone.

## Authority model

This document governs **how continuity is maintained**. It does not replace the document that owns a product or technical behavior.

Use this authority order:

1. safety, security and contribution rules in `AGENTS.md`;
2. `docs/DOCUMENT-GOVERNANCE.md`;
3. the focused owner document identified by `docs/DOCUMENT-MAP.md`;
4. narrower subsystem contracts;
5. `docs/CURRENT-STATE.md` for mutable implementation and production evidence;
6. `docs/DEVELOPMENT-ROADMAP.md` for approved execution order and slice status;
7. closure documents and handoffs as historical evidence.

A handoff is a portable transfer snapshot. It must help the next contributor restart safely, but it never outranks live GitHub, current code or normative owner documents.

## Evidence labels

Every operational status report or handoff must use these exact labels, even when the surrounding report is written in another language:

- **CONFIRMADO NO CÓDIGO** — exists and was inspected in the referenced checkout;
- **CONFIRMADO NO GITHUB** — obtained from the connected GitHub repository;
- **COMPROVADO EM PRODUÇÃO** — the exact trusted-main code has an applicable successful privileged proof;
- **DOCUMENTADO, MAS NÃO COMPROVADO** — written as a contract or claim without reopened operational proof;
- **HISTÓRICO** — explains a previous state and cannot govern the current execution point;
- **HIPÓTESE** — inference or proposal requiring validation;
- **PENDENTE** — not implemented, connected or proven;
- **DECISÃO DE PRODUTO** — requires explicit product approval and must not be silently hard-coded.

Tool silence, an empty status response, a skipped privileged job, a preview deploy or a secret-free validation is never equivalent to production success.

## Slice status vocabulary

The roadmap uses these execution states:

- **PROPOSED** — candidate decomposition that is not yet approved by a merged roadmap change;
- **PLANNED** — approved, ordered and not started;
- **IN PROGRESS** — active branch or PR exists for the slice;
- **CODE GREEN** — code, tests and documentation passed the required non-production gates;
- **PRODUCTION GREEN** — exact integrated code passed trusted-main deployment and every applicable privileged canary;
- **BLOCKED** — a named technical or operational blocker prevents safe continuation;
- **DECISION REQUIRED** — product, architecture or operational authority is required before implementation;
- **HISTORICAL** — completed or superseded context retained only as evidence.

`CURRENT-STATE.md` may claim production success only with exact SHA, workflow/run evidence and applicable canary scope. If no privileged canary applies yet, use code/CI evidence and say so.

## Mandatory startup protocol

Before responding with a new execution plan, creating a branch or changing code, every new AI or contributor must:

1. query connected GitHub and re-read the current `main` HEAD, including SHA, parent, author, date and message;
2. list open pull requests and relevant active branches;
3. inspect statuses, workflow runs, deployments and applicable canaries for the current HEAD, opening the first real failure log when anything is red;
4. compare live `main` with the SHA recorded by the latest state document or handoff;
5. treat automated default-catalog changes separately from tenant Intelligent Sync;
6. create or refresh a clean checkout of latest `main`;
7. read `AGENTS.md`, governance, document map, this continuity contract, current state, roadmap and every owner document for the intended slice;
8. inventory current Markdown documents and inspect any new governing document;
9. inspect the live code, migrations, configuration, workflows and tests that can invalidate the recorded conclusion;
10. confirm activation flags without exposing secret values;
11. state the exact current point, evidence limitations and the single small slice proposed next;
12. stop if live evidence conflicts with the documented execution point until that conflict is reconciled.

Immediately before branch creation, revalidate `main` again. Automated commits may advance it between initial inspection and implementation.

## Mandatory milestone decomposition

A macro milestone such as M8 or M9 does not implicitly contain approved `A`, `B` or numbered sub-slices.

Before implementation begins, a planning/documentation PR must decompose the milestone when it cannot safely fit in one small PR. Each proposed slice must record:

- stable name and order;
- customer/business outcome;
- bounded technical outcome and explicit non-goals;
- owner documents and affected components;
- migrations and compatibility boundary, if any;
- contracts and invariants;
- unit and integration proof;
- required workflows and privileged canary;
- rollback/recovery path;
- Definition of Done;
- dependencies and decisions required.

Sub-slice names remain **PROPOSED** until that planning PR is merged. A future AI may not invent, rename, remove or reorder them silently. Material changes require a documentation PR and explicit user decision when product, risk, commercial scope or architecture changes.

## Slice execution protocol

For every approved slice:

1. revalidate latest `main` and create a new small branch from it;
2. implement one bounded claim only;
3. change code, tests and owner documentation together when behavior changes;
4. keep destructive or global activation disabled until its dedicated activation slice;
5. run local required and subsystem-specific gates;
6. open a PR that records risk, migration, rollback, invariants and evidence;
7. inspect every gate and fix the first real cause without weakening the contract;
8. integrate latest `main` again before merge and preserve unrelated automated catalog changes;
9. merge only the exact tested head SHA;
10. inspect trusted-main deployment and applicable privileged canary on the integrated code;
11. retain failed evidence and clean only exact audited fixtures;
12. update `CURRENT-STATE.md` only to the level actually proven.

No contributor may mark a slice complete, begin the next slice or describe a milestone as production-green while the corresponding state/roadmap update is missing. If evidence and documentation cannot be updated together, stop at the lower proven status.

### Explicit continuous-campaign exception

The owner may explicitly authorize one conversation to execute a named, ordered range of already approved slices and formally decomposed macro milestones. This changes only the conversation stop boundary. It never permits a multi-milestone PR, parallel unproven slices, skipped revalidation, weakened CI, untrusted deployment, premature activation or advancement past a slice that is not honestly **PRODUCTION GREEN**.

The campaign authorized on 2026-08-30 is `M7D10 -> M7D11 -> M7E -> M8 -> M9 -> M10 -> M11`. Each slice keeps its own branch, bounded PR, exact tested head, merge, trusted-main proof, applicable production canaries and rollback boundary. Between Green slices, a compact GitHub/roadmap evidence checkpoint is sufficient; consolidated closures and handoff refresh are deferred until the owner requests `FAÇA O SAVE`. Formal decomposition remains mandatory before M8 and any later macro milestone that cannot fit safely in one small PR. This exception ends at M11 and is not reusable by a future conversation without fresh owner authorization.

## Handoff update protocol

Create or refresh a handoff when responsibility is intentionally transferred, after a material production closure or when context size makes a new execution session necessary. Routine PRs do not need a new giant handoff.

Every handoff must begin by ordering the next contributor to revalidate live GitHub before acting and must include:

- civil date/timezone and capture time;
- repository, branch, HEAD metadata and comparison baseline;
- open PRs and relevant branches;
- exact code delta since the prior baseline;
- current milestone/slice ledger;
- what is confirmed in code, GitHub and production;
- latest exact trusted deploy, canaries, cleanup and their scope;
- tool limitations and facts not proven;
- activation flags and decisions still required, without secret values;
- remaining work, invariants, risks and rollback boundaries;
- exact next approved slice and its Definition of Done;
- documents that govern the next work;
- local/CI gates and operational proof required.

The transfer author must update `CURRENT-STATE.md` and the roadmap first when their truth changed. A handoff must link to those authorities rather than duplicating a contradictory execution plan.

## Conflict and decision boundary

When code, GitHub evidence, current state, roadmap or an owner document disagree:

1. label the conflict explicitly;
2. preserve the safest existing behavior and Last Known Good state;
3. do not activate, delete, migrate destructively or advance the milestone;
4. resolve implementation-detail conflicts in a focused PR;
5. ask the user when the resolution changes product, risk, commercial scope or a material architecture decision.

The final continuity check is:

> Could a new AI with no prior conversation identify live truth, preserve every invariant and execute only the next approved slice safely?

If the answer is not yes, the state, roadmap, owner contract or handoff is incomplete.
