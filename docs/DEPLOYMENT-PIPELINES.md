# Catalog Engine — Deployment and Publication Pipelines

Status: **Normative implementation contract**  
Scope: application deployment, default catalog publication, provider sync/recovery and production mutation boundaries.

## Core rule

Application deployment and catalog-data publication are separate responsibilities.

A UI/Worker-only change must not rebuild or replace the live business catalog merely because application code was deployed.

## Application deployment

Owned by `.github/workflows/deploy-catalog-api.yml`.

Target flow:

`checkout main -> install -> quality -> build -> build:verify -> schema migrations -> Worker/assets deploy -> smoke existing catalog`

Rules:

- build and public-artifact verification happen before the first production mutation;
- the workflow may apply required D1 **schema migrations** while that remains the current release model;
- it does not generate public catalog SQL;
- it does not replace catalog product/category/team/league/facet data;
- it does not run supplier crawling/sync;
- it smoke-tests the already-published catalog for application compatibility after deploy;
- because schema migrations share the production D1, the workflow remains serialized with other production D1 mutation jobs.

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

This workflow is transitional. Long-term tenant sync moves to durable tenant jobs/Queues according to the roadmap.

## Full recovery

`import-yupoo.yml` remains manual recovery tooling, not routine application deployment.

It can perform a complete provider crawl and rebuild the default catalog under explicit operator control.

Full recovery must not become the normal daily synchronization path.

## Repository snapshot

`data/catalog.json` is currently retained as a sanitized compatibility/recovery/debug snapshot.

It is not the long-term primary multi-tenant datastore.

Current sync/recovery workflows can still persist a sanitized snapshot to Git for compatibility. Removing direct bot pushes to `main` and defining a better snapshot/archive strategy remain separate M1/M7 debt items.

## Production serialization

Jobs that mutate the shared/default production D1 currently use the `catalog-engine-production-d1` concurrency group with `cancel-in-progress: false`.

This prevents application migrations, catalog publication and default sync/recovery from racing each other.

As tenant-isolated Queue processing becomes primary, per-tenant concurrency/locking must replace unnecessary global serialization for tenant data planes.

## Regression protection

`tests/deployment-pipeline-boundary.test.mjs` protects the key separation:

- application deploy cannot call `sync-public-catalog-d1.mjs` or own the public catalog SQL directory;
- application build/verify occurs before remote migrations/deploy;
- default snapshot publication remains manual;
- default snapshot publication cannot deploy the Worker or apply remote migrations.

## Final decision rule

For every production workflow change ask:

> Is this changing application code/schema, or is it changing commercial catalog data?

If both happen only because one workflow historically did both, split the responsibilities unless an explicit transactional release requirement proves they must remain coupled.
