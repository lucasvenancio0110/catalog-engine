# Catalog Engine — Autonomous Development Runbook

Status: **Operational execution contract**  
Scope: recurring autonomous development sessions for `lucasvenancio0110/catalog-engine`  
Purpose: let a fresh AI instance continue the project from live truth, make maximum safe progress, persist continuity, and stop deterministically at human-only gates.

> This runbook does not override `AGENTS.md`, `DOCUMENT-GOVERNANCE.md`, focused normative owner documents, or `DEVELOPMENT-CONTINUITY.md`. When they conflict, follow the repository's normative hierarchy and reconcile the conflict before advancing.

## 1. Mission

Continue the real Catalog Engine development from the exact point the previous execution stopped. This is a universal recurring runbook, not a PB-, milestone-, branch-, or PR-specific instruction.

Make the maximum safe, provable, useful progress available in the current execution. Do real work rather than only describing work. The long-term objective is a real, robust, premium, secure, scalable, automated, observable, maintainable product ready for customers.

Normal loop:

`discover live state -> check HUMAN GATE LOCK -> identify delta -> validate governance -> locate active slice -> understand contract/DoD -> implement -> test -> PR/CI -> merge -> migration/deploy when applicable -> canary/smoke/production proof -> fix root cause -> close only when proven -> locate next approved slice -> continue when safe -> persist state/docs -> final revalidation/checkpoint`

If a HUMAN GATE LOCK is active, the normal loop is suspended.

## 2. Live authority and startup

Do not trust this runbook, a previous chat, or a historical handoff to tell you which slice is active. Discover it.

At the beginning of every execution, follow the mandatory startup protocol in `DEVELOPMENT-CONTINUITY.md`. Revalidate, as applicable:

1. current `main` HEAD;
2. open PRs and relevant branches;
3. commits since the previous known checkpoint;
4. Actions/checks and first real failure when red;
5. deployments, migrations, canaries and production proofs;
6. application Production SHA separately from GitHub HEAD;
7. `CURRENT-STATE.md`, roadmap and active execution document;
8. current owner documents and invariants for the affected area.

Before normal development, check whether the durable operational state contains `HUMAN_GATE_LOCK: ACTIVE`. If yes, follow only the Human Gate section.

GitHub/infrastructure are operational truth. Normative documents are contract truth. Historical closures/handoffs are evidence, not authority over current live state.

## 3. Incremental revalidation

Do not perform a full repository audit every hour. Look for delta.

If a known file has not changed and its relevant contract is already understood, do not reread it in full. If it changed, inspect the diff or necessary sections. Re-read broadly only for structural changes, genuine context loss, contradictions, or when the current decision depends on unseen material.

Always inspect changes to `AGENTS.md`, governance, document map, continuity, roadmap, active execution contract, and relevant owner documents before acting on affected behavior.

Central question: **What changed since the previous execution, and what is the next approved action that has not yet been executed?**

## 4. Documentation is part of the code

Documentation is not optional cleanup after coding.

When an execution materially changes behavior, architecture, contract, schema, migration, operational state, root cause, blocker, deployment/proof boundary, slice state, Human Gate, or a non-obvious continuation point, update the owning documentation in the same branch/PR when required by governance.

Never leave essential continuity knowledge only in chat output.

`docs/CURRENT-STATE.md` is mutable operational truth. Together with live GitHub, it should let a fresh instance rapidly determine:

- active slice and proven state;
- relevant branch/PR;
- important implementation already completed;
- what is not yet proven;
- CI/deploy/migration/proof pending;
- current blocker;
- active Human Gate;
- exact next action.

Do not turn `CURRENT-STATE.md` into an hourly diary or commit dump. Closures preserve historical proof; PRs preserve concrete deltas; focused owner documents preserve durable contracts; `CURRENT-STATE.md` preserves current operational truth.

Before ending any execution with material changes, ask: **Can a fresh instance continue exactly from GitHub + CURRENT-STATE + current normative docs/proofs without relying on this chat?** If not, persist the missing information before ending.

Do not create empty commits or hourly Markdown logs merely to prove an execution occurred.

## 5. Execution behavior

When no Human Gate is active:

- continue an existing active branch/PR rather than starting duplicate work;
- if CI fails, diagnose the first real root cause, fix it, add regression coverage when applicable, update the PR and revalidate;
- if CI is green and governance permits merge, advance;
- after merge, complete every required migration, trusted deploy, canary, smoke and production proof before claiming completion;
- if proof fails, fix the root cause in the same slice;
- close a slice only when its Definition of Done and required evidence are satisfied;
- after a slice becomes honestly complete, discover the next officially approved slice and begin it in a new bounded branch/PR if safe and time/capability remain.

Do not leave as “next action” something you can safely execute now, except for a running job, real temporal gate, unavailable tool, governance boundary, or Human Gate.

Do not invent a slice, submilestone, activation, architecture decision or roadmap entry. Follow approved decomposition. If a new material product/risk/architecture decision is required, stop at the appropriate decision boundary.

## 6. Evidence and status

Follow the evidence labels and slice vocabulary defined by `DEVELOPMENT-CONTINUITY.md`. If an external orchestration prompt requires a narrower checkpoint vocabulary, map conservatively without upgrading evidence.

Never equate local tests, PR creation, CI green, merge, preview deploy, tool silence, or skipped privileged jobs with Production Green.

Never confuse GitHub `main` HEAD with application Production SHA. Documentation/proof/workflow-only commits can advance main without changing the deployed application runtime.

Never fabricate evidence.

## 7. Human Gate Lock — absolute stop rule

This section has priority over every instruction to maximize progress, innovate, work in parallel, or begin another slice.

If any mandatory step depends on a human action the available tools genuinely cannot perform or prove, immediately enter `HUMAN GATE LOCK`.

Examples include owner-only authentication, required visual confirmation, mandatory manual/device test, human approval/acceptance, information only the owner can provide, or an external administrative action unavailable to the tools.

At the gate, stop immediately. After the gate it is forbidden to:

- continue implementation;
- begin another slice or parallel task;
- create unrelated continuation work;
- merge, migrate, deploy or run downstream proof that presupposes the intervention;
- promote state or claim success;
- simulate or assume the human action;
- remove the lock because time passed or a new hourly execution started.

Persist the lock in the canonical operational state, preferably `CURRENT-STATE.md` unless current governance defines another owner. Record at least:

```text
HUMAN_GATE_LOCK: ACTIVE
Gate ID: <stable unique ID>
Slice: <blocked slice>
Reason: <why human intervention is mandatory>
Owner action: <exact action>
Expected result: <observable success condition>
Confirmation token: <unique token>
Created at: <timestamp/date when appropriate>
```

Use a specific token; never use generic `OK`, `SIM`, `FEITO`, `CONTINUE` or `DEU CERTO`.

While a lock is active, every later recurring execution must do only the minimum needed to confirm the lock still exists and whether the owner supplied the exact valid confirmation. Do not audit broadly, edit code, create branches/commits/PRs, merge, deploy, migrate, prove, or work in parallel.

Only this exact form releases the active gate:

`CONFIRM HUMAN GATE <TOKEN>`

Vague messages such as “continue”, “já fiz”, “ok”, “sim” or “deu certo” do not release it. Wrong or stale tokens do not release it.

After a valid confirmation: validate the active Gate ID/token, persist the confirmation, deactivate the lock, revalidate live state that may have changed while blocked, and continue from immediately after the gate. Human confirmation proves only that gate; it does not automatically prove CI, deployment, production, or slice completion.

## 8. Product excellence

Do not optimize for the smallest patch that makes a test pass. Within the approved slice, choose the best sustainable solution balancing robustness, security, multi-tenant isolation, UX, maintainability, observability, recovery, performance, cost, extensibility and architectural clarity.

Before material implementation, ask whether the solution:

- fixes root cause rather than symptoms;
- strengthens the product instead of only the current case;
- creates avoidable technical debt or duplicate authority;
- scales to many tenants and large catalogs;
- survives retry, duplicate delivery, crash and re-entry where relevant;
- preserves rollback/LKG;
- handles applicable mobile, desktop, touch, keyboard/focus, loading, empty, error and retry states;
- can eliminate recurring manual work safely;
- improves testability/observability without leaking private state;
- covers obvious edge cases that belong to the same slice.

Think before coding, but do not turn analysis into paralysis. Once the best safe option within the contract is clear, execute it.

## 9. Ambition with discipline

Within the approved contract, prefer complete implementation: happy path plus applicable failure, retry, idempotency, re-entry, isolation, privacy, accessibility, observability, rollback and regression behavior.

Innovate when it objectively reduces risk, friction, cost, latency, support burden or operational complexity, or improves UX, reliability, automation, security, performance or scale. Do not add fashionable technology, unnecessary frameworks, speculative abstractions or rewrites. Material contract/architecture/roadmap changes require the appropriate governance decision.

Treat Catalog Engine as a product, not a demo. Do not ship fake progress/ETA/status, misleading placeholders, dead controls, infrastructure leaks, avoidable manual refresh dependencies, happy-path-only flows, or merchant-specific hacks.

Automate normal repeatable operations; surface exceptions. Automation must be bounded, idempotent, auditable, tenant-safe and fail closed where required.

When real CI, canary, production proof or merchant behavior exposes a defect, do not mask it. Find and fix root cause and add regression coverage when applicable.

## 10. Permanent architectural invariants

Always preserve the current normative contracts, including these critical boundaries:

- real SaaS multi-tenancy and tenant isolation;
- server-side ownership/authorization;
- default tenant is explicit compatibility state, never an implicit fallback;
- application deployment is separate from catalog publication;
- provisioning is idempotent/resumable with durable checkpoints;
- one tenant's failure cannot corrupt another;
- Yupoo is a Provider, not the architecture;
- Provider Engine and CEI remain provider-neutral;
- Sports remains a Knowledge Pack, not the core architecture;
- supplier taxonomy is evidence, not public merchandising truth;
- public identities are opaque and private provider/source/runtime identifiers stay private;
- merchant overrides are durable business data;
- INITIAL TENANT IMPORT and RECURRING TENANT INTELLIGENT SYNC are distinct;
- recurring Intelligent Sync or M7E must never be silently activated;
- partial scan never infers deletion; `not observed != removed`;
- LKG remains until a candidate is safely verified;
- queue/replay behavior remains idempotent, bounded and ownership-safe;
- customer-facing work remains mobile-first, accessible and based on durable real state.

When a focused owner document is stricter or more specific, follow it.

## 11. Quality gates

Run the gates required by `AGENTS.md` and the affected owner documents. Typical baseline:

```bash
npm ci
npm run deps:check
npm run test
npm run lint
```

For storefront/build changes when applicable:

```bash
npm run build
npm run build:verify
```

For provider/import/sync/taxonomy changes, run the relevant audits and tenant/provider isolation gates, including as applicable:

```bash
npm run audit
npm run sync:audit
npm run taxonomy:audit
```

Never weaken a test or invariant merely to make CI pass.

## 12. Campaign and roadmap neutrality

This runbook is intentionally universal. Historical or active campaigns such as PB0–PB12 do not define the runbook itself. Discover the live active campaign/slice from current governance.

If an authorized campaign ends, do not invent the next PB or milestone. Return to the current roadmap/execution authority and continue only the next approved work.

The first known real merchant may be used as real production evidence where current contracts authorize it, but no merchant may become an architectural special case.

## 13. Anti-loop

Do not repeat every hour: full audits, full document rereads, resolved diagnoses, useless documentation commits, unnecessary proofs, or historical explanations.

If no job completed, CI did not change, the blocker remains, and no new safe action exists, do not invent work. Revalidate only what is necessary and state what event must occur next.

Exception: while a Human Gate is active, the only central question is: **Did the owner explicitly provide the exact token for this active gate?** If not, remain locked.

## 14. Final persistence and handoff

Before ending a normal execution, revalidate affected facts:

- main HEAD;
- application Production SHA;
- branch/PR;
- CI;
- migration;
- deploy/canary/proof;
- slice state;
- blocker/Human Gate;
- exact next action.

If material state changed, persist it before ending. GitHub is the primary operational memory; `CURRENT-STATE.md` and the appropriate owner/closure/proof documents must converge with live truth.

The final continuity test is:

> Could a completely fresh AI instance start roughly one hour later, use live GitHub + CURRENT-STATE + normative docs/proofs, preserve every invariant, and continue from the exact correct point without this conversation?

If no, the execution is not ready to end.

## 15. Final response

When no Human Gate is active, keep the response compact and use:

```text
CATALOG ENGINE — CHECKPOINT

Slice:
Estado anterior → Estado atual:
Main HEAD:
Production SHA:
Branch/PR:
CI:
Deploy/Canário:
Feito agora:
Problema/root cause:
O que falta:
Próxima ação exata:
```

When a Human Gate is active, respond only:

```text
CATALOG ENGINE — HUMAN GATE LOCK

Slice:
Gate ID:
Estado: BLOQUEADO — INTERVENÇÃO HUMANA OBRIGATÓRIA
Você precisa fazer:
Resultado esperado:
Para liberar, envie exatamente:
CONFIRM HUMAN GATE <TOKEN>

Nenhum desenvolvimento adicional foi executado após este gate.
```

## 16. Final absolute rule

Discover. Do not restart. Continue from live truth. If work is executable, do it. If CI fails, fix root cause. If merge/deploy/proof is required and authorized, execute it. If a slice is proven complete, document/close it and continue to the next approved slice when safe. Persist material state before ending. Never leave essential continuity only in chat.

Above all: if `HUMAN_GATE_LOCK: ACTIVE`, stop. Do not work in parallel, do not retry development next hour, and do not interpret silence or “continue” as approval. Only `CONFIRM HUMAN GATE <correct active token>` releases development.