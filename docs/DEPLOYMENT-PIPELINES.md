# Catalog Engine — Deployment and Publication Pipelines

Status: **Normative implementation contract**  
Scope: application deployment, default catalog publication, provider sync/recovery and production mutation boundaries.

## Core rule

Application deployment and catalog-data publication are separate responsibilities.

A UI/Worker-only change must not rebuild or replace the live business catalog merely because application code was deployed.

## Application deployment

Owned by `.github/workflows/deploy-catalog-api.yml`.

Target flow:

`checkout exact main SHA -> install -> quality -> build -> build:verify -> schema migrations -> build bounded runtime-secret bundle -> Worker/assets deploy -> verify binding names -> prepare eligible tenant migration-command capability from trusted CI -> smoke existing catalog`

Rules:

- build and public-artifact verification happen before the first production mutation;
- trusted-main deploy and post-deploy canaries check out the exact triggering/deployed SHA rather than a moving `main`, because catalog-data automation may advance the branch concurrently;
- the workflow may apply required D1 **schema migrations** while that remains the current release model;
- the same trusted-main deployment uploads required Worker `secret_text` bindings alongside code by using Wrangler's `--secrets-file` boundary; the temporary file is permission-restricted and deleted by an exit trap;
- Workers for Platforms always requires `CLOUDFLARE_PLATFORM_ACCOUNT_ID` and `CLOUDFLARE_PLATFORM_API_TOKEN` in that bundle;
- portal OIDC runtime configuration is represented by exactly four deployment bindings: `ADMIN_AUTH_ISSUER`, `ADMIN_AUTH_AUDIENCE`, `ADMIN_AUTH_JWKS_URL` and `PORTAL_AUTH_CLIENT_ID`;
- those four portal-auth bindings are **all-or-none**: zero keeps the portal authentication path deliberately fail-closed, four enables the configured path, and a partial one-to-three binding configuration fails before Worker deployment;
- the deployment source for those values is trusted GitHub Actions secrets. No client secret or customer password is part of the portal-auth bundle;
- `scripts/build-worker-runtime-secrets.mjs` constructs the temporary bundle without printing values and reports only safe binding names/configured state;
- after deploy, only binding names/types are read through Cloudflare's read-only Worker Script Settings API. Secret values and unrelated binding identifiers are never emitted, committed or exposed to pull-request validation;
- post-deploy verification requires the two Workers for Platforms names and also proves either zero portal-auth names when fail-closed or all four names when auth configuration was supplied;
- existing-tenant Workers for Platforms script preparation runs from trusted CI after the exact main Worker SHA is deployed. It is bounded, idempotent, excludes active imports and retained fleet fixtures, persists only safe capability errors, and promotes the durable command marker only after upload succeeds;
- account-level Worker bindings belong only to physical tenant provisioning and fresh-provisioning schema work. Maintenance schema inspection/application/verification, tenant import, CEI classification and verification use the isolated `TENANT_DISPATCH` path;
- application deployment does not generate public catalog SQL, replace catalog product/category/team/league/facet data or run supplier crawling/sync;
- it smoke-tests the already-published catalog for application compatibility after deploy;
- it verifies the M7 activation boundary keeps `TENANT_SYNC_AUTOMATION_ENABLED=0`, `TENANT_SYNC_ACTIVE_COHORT` empty and the technical per-tick cap at `1` until recurring sync is deliberately proven and enabled;
- after applying the additive M7D2 control-plane migration, it performs a read-only bounded D1 aggregate proving that no tenant/source is enrolled. It emits counts only, never tenant/source IDs or supplier evidence;
- because schema migrations share the production D1, the workflow remains serialized with other production D1 mutation jobs.

### Portal-auth runtime configuration boundary

The Portal Beta authentication implementation is intentionally fail-closed until an external OIDC application/API exists and all four required runtime bindings are supplied through trusted Actions secrets.

The deployment workflow must never manufacture placeholders or fall back to browser-provided identity configuration. It must never write an IdP client secret into the SPA. `PORTAL_AUTH_CLIENT_ID` is the public SPA client identifier; backend token validation remains owned by issuer/audience/JWKS configuration and `worker/admin-auth.js`.

Removing one or more of the trusted configuration secrets causes the next trusted deployment to either deploy with **zero** portal-auth bindings when all four are absent, or fail before deployment when configuration is partial. This prevents stale or half-configured identity authority from surviving unnoticed.

A successful application deployment with four binding names proves only that runtime configuration was delivered. PB1/PB3 still require real browser identity/session and merchant tenant-creation evidence before their customer-facing Definition of Done can be marked Production Green.

### Tenant fleet and canary boundaries

After a trusted-main deploy that changes the tenant fleet schema target, preparation boundary or fleet-proof implementation, `.github/workflows/cloudflare-tenant-data-plane-fleet-canary.yml` owns the production maintenance proof. The current target is schema v8: isolated v7 fixtures are prepared with migration-command capability v4 and upgraded through scheduler-owned binding-native v7→v8 maintenance while LKG, merchant overrides, existing stage evidence and unrelated-tenant isolation remain safe. Recurring tenant Intelligent Sync remains disabled throughout the fleet proof. The canary does not enqueue tenant import work manually or replace catalog data. On unexpected failure it reports only bounded migration evidence and retains isolated fixtures. Changes to the fleet-canary workflow, script or tests are owned by the application-deploy path filter and reach the proof only through the successful deploy's `workflow_run`; the fleet workflow must not start a competing direct-push run in the shared production-D1 concurrency group.

The fleet workflow's secret-free pull-request validation uses a PR-scoped concurrency group and may run alongside production. Only the privileged trusted-main canary uses `catalog-engine-production-d1`; validation must not occupy or replace the single pending production slot.

Fixtures retained by failed fleet proofs are cleanup evidence, not permanent tenant resources. After a newer trusted-main fleet canary passes completely, `.github/workflows/cloudflare-cleanup-retained-fleet-canaries.yml` may remove only the audited opaque fixture IDs. The cleanup preflights every present row against deterministic fleet-only tenant/source/Worker/D1 identity before any deletion, tolerates already-absent historical fixtures, never sends or purges Queue messages, and remains serialized in the production-D1 concurrency group. Any identity mismatch fails closed and preserves the remaining evidence.

When the automatic tenant import canary retains a fixture, `.github/workflows/cloudflare-retained-canary-diagnostic.yml` owns read-only diagnosis for the exact opaque tenant ID on trusted `main`. It may report bounded job/provisioning/CEI state, tenant schema/counts, foreign-key findings and Queue/DLQ backlogs. It must not emit supplier URLs, raw error payloads or private metadata, and it must not enqueue, purge, retry, update or delete evidence.

When the fleet-maintenance canary retains its isolated success/failure/blocked trio, `.github/workflows/cloudflare-tenant-data-plane-fleet-diagnostic.yml` owns read-only diagnosis for those exact opaque tenant IDs on trusted `main`. A trusted-main dispatch may retarget only the three validated, distinct opaque IDs; the diagnostic must preserve fixtures, report bounded migration/LKG/schema/onboarding/isolation evidence, and perform no D1, Worker, Queue or DLQ mutation.

M7D10 production recovery evidence is owned by `.github/workflows/cloudflare-m7d10-recovery-canary.yml`. Pull requests receive only the secret-free quality job. The privileged canary resolves the exact successful application-deploy SHA, then requires Queue activation, schema-v8 fleet, D7 promotion, D8 finalization, D9 removal and automatic import/CEI statuses on that same SHA. It verifies migration `0022` read-only in production, reads all four Queue/DLQ metrics and mutates only isolated ephemeral Cloudflare D1 fixtures. The proof covers expired-owner token/revision CAS, bounded cross-tenant recovery, strict durable replay and redacted operational projection while recurring tenant sync remains off. Successful fixtures are removed only after every assertion; failed isolated evidence is retained without printing resource identifiers.

A future migration architecture may separate schema deployment further, but that is a separate controlled decision.

## Manual default snapshot publication

Owned by `.github/workflows/publish-default-catalog.yml`.

Purpose: deliberately publish the checked-in sanitized `data/catalog.json` snapshot to the default catalog D1 without deploying application code.

Safety contract:

- manual `workflow_dispatch` only;
- explicit `PUBLISH` confirmation;
- quality gate before production mutation;
- generate exactly one atomic public-catalog SQL artifact;
- exercise that exact artifact against local D1 first;
- do not run remote migrations from the publication workflow;
- execute the single artifact against remote D1;
- compare remote counts to generation output;
- smoke the existing live catalog API;
- do not deploy Worker/static assets.

If the remote schema is not compatible, publication should fail safely and application/schema deployment must be handled separately.

## Provider sync

`sync-yupoo-incremental.yml` remains, for the default/legacy source path, the owner of source-driven incremental changes while the tenant Queue architecture is not yet the normal production path.

Its responsibilities include:

- source scan;
- delta planning;
- detail fetch for changed candidates;
- private media/source state changes;
- atomic public catalog publication when catalog output changed;
- cursor promotion only after public verification;
- sync success/failure state.

This workflow is transitional. It is a distinct default-catalog automation and is **not** the M7 tenant Intelligent Sync scheduler governed by `TENANT_SYNC_AUTOMATION_ENABLED` / active-cohort controls. It may still advance the sanitized compatibility snapshot `data/catalog.json` through its catalog bot while tenant recurring sync remains off. Long-term tenant sync moves to durable tenant jobs/Queues according to the roadmap.

## Full recovery

`import-yupoo.yml` remains manual recovery tooling, not routine application deployment.

It can perform a complete provider crawl and rebuild the default catalog under explicit operator control.

Full recovery must not become the normal daily synchronization path.

## Repository snapshot

`data/catalog.json` is currently retained as a sanitized compatibility/recovery/debug snapshot.

It is not the long-term primary multi-tenant datastore.

Current sync/recovery workflows can still persist a sanitized snapshot to Git for compatibility. Removing direct bot pushes to `main` and defining a better snapshot/archive strategy remain separate M1/M7 debt items.

## Production serialization

Jobs that mutate the shared/default production D1 currently use the `catalog-engine-production-d1` concurrency group with `cancel-in-progress: false`. The tenant import Queue-consumer activation workflow shares this group because deploying its Worker consumers and inspecting/attaching Queue control-plane resources must not overlap the application Worker deploy or trusted production canaries using those Queues.

This prevents application migrations, Worker/Queue deployments, catalog publication, default sync/recovery and trusted production canaries from racing each other. M7D9 hardened the exact-SHA proof graph so application deploy completes before Queue activation; fleet and automatic-import prerequisite waiters observe required exact-SHA statuses outside the mutation lock and only their actual privileged canary jobs enter `catalog-engine-production-d1`. This avoids pending-job cancellation/deadlock without weakening exact-SHA gates for D7/D8/D9.

As tenant-isolated Queue processing becomes primary, per-tenant concurrency/locking must replace unnecessary global serialization for tenant data planes.

## Regression protection

`tests/deployment-pipeline-boundary.test.mjs`, `tests/worker-runtime-secrets.test.mjs` and `tests/worker-platform-bindings.test.mjs` protect the key separation:

- application deploy cannot call `sync-public-catalog-d1.mjs` or own the public catalog SQL directory;
- application build/verify occurs before remote migrations/deploy;
- default snapshot publication remains manual and cannot deploy the Worker or apply remote migrations;
- runtime secret bundling requires both Workers for Platforms values;
- portal auth is zero-or-four and any partial OIDC configuration fails before deploy;
- post-deploy verification observes binding names/types only and never secret values;
- the deployment workflow does not use ad-hoc `wrangler secret put/list/bulk` mutation paths.

## Final decision rule

For every production workflow change ask:

> Is this changing application code/schema/runtime configuration, or is it changing commercial catalog data?

If both happen only because one workflow historically did both, split the responsibilities unless an explicit transactional release requirement proves they must remain coupled.
