# Catalog Engine — Tenant Import Queues

Status: **Normative activation and operations contract**  
Scope: Cloudflare Queue topology, activation gates, delivery/retry policy and failure containment for isolated tenant ingestion.

## Principle

Queue infrastructure must be safe to deploy before automatic customer ingestion is enabled.

The existence of a Queue binding is not authorization to discover/import tenants. Automatic discovery is controlled separately by `TENANT_IMPORT_AUTOMATION_ENABLED` and the only enabled value is the literal string `1`.

The production default is `0` until real one-tenant and simultaneous two-tenant ingestion proofs pass.

## Topology

M5 uses two primary queues and two dead-letter queues:

- `catalog-engine-import-scan`
  - one dedicated scan Worker consumer;
  - serial consumer concurrency initially;
  - produces detail messages to `catalog-engine-import-detail`;
  - DLQ: `catalog-engine-import-scan-dlq`.
- `catalog-engine-import-detail`
  - one dedicated detail/finalize Worker consumer;
  - deliberately low initial concurrency;
  - DLQ: `catalog-engine-import-detail-dlq`.

Scan and detail are separate queues because source discovery/crawling and per-item detail work have different rate/failure/concurrency characteristics.

## Initial delivery policy

### Scan queue

- max batch size: `1`;
- max batch timeout: `5s`;
- max queue delivery retries: `3`;
- max consumer concurrency: `1`;
- default retry delay: `60s`;
- DLQ required.

A full source listing scan is intentionally serialized at first because it can create large upstream request bursts and thousands of downstream detail messages.

### Detail queue

- max batch size: `4`;
- max batch timeout: `5s`;
- max queue delivery retries: `5`;
- max consumer concurrency: `2`;
- default retry delay: `120s`;
- DLQ required.

These are conservative launch values, not permanent scale limits. Increase concurrency only after measuring upstream rate behavior, D1 write pressure, queue age and failure rate.

Application-level retry/deferred state inside tenant import jobs remains distinct from Cloudflare delivery retries. Queue delivery retry protects message execution; durable import state protects product/business recovery.

## Producer activation boundary

The main platform Worker's cron already invokes the tenant import dispatcher every five minutes.

Therefore:

1. M5A adds the explicit automation gate and consumer configuration only;
2. the main Worker has **no Queue producer bindings** during M5A;
3. M5B replaces the high-volume tenant D1 HTTP-admin hot path with internal tenant data-plane dispatch/native D1 writes;
4. M5C creates/deploys Cloudflare Queue resources/consumers;
5. only after consumers/resources are verified are main producer bindings added;
6. `TENANT_IMPORT_AUTOMATION_ENABLED` remains `0` during manual proofs;
7. one test tenant is imported intentionally;
8. two simultaneous isolated test tenants are imported intentionally;
9. only after isolation/recovery/white-label/count checks pass may the flag change to `1`.

No PR validation workflow may receive production Cloudflare credentials merely to prove Queue code/configuration.

## Tenant data-plane write path

The old ingestion implementation can write an arbitrary tenant D1 by using Cloudflare's administrative D1 HTTP API plus a runtime API token.

That is not the target high-volume Queue hot path.

Before producer activation, M5B must route ingestion data-plane operations through the already-isolated tenant User Worker/Workers for Platforms dispatch boundary so the selected User Worker executes the write through its native `CATALOG_DB` binding.

Target:

`Queue consumer -> TENANT_DISPATCH.get(worker_script_name) -> internal tenant command -> tenant CATALOG_DB binding`

This keeps per-tenant physical isolation, removes the need for a broad D1 administrative token in every import consumer and avoids treating an administrative REST API as the per-product data path.

The internal tenant command must not be reachable through the public merchant `/api` or `/media` routing surface and must validate tenant identity plus bounded statement/query shape.

## DLQ policy

A primary queue may not launch without a DLQ.

DLQ messages are operational evidence, not a substitute for durable import state. Before automatic ingestion is enabled, operators need a documented way to:

- inspect queue/consumer health;
- identify the import/tenant/source key from the minimal message;
- compare with `tenant_import_jobs` and tenant detail state;
- fix the underlying cause;
- retry/replay through a controlled recovery path;
- purge only after the durable state proves the message is obsolete.

Do not copy raw source URLs or credentials into DLQ messages for convenience.

## Fail-closed rules

Automatic discovery must return without querying control-plane D1 when the feature gate is disabled.

When the gate is enabled, dispatch still fails closed if:

- control-plane D1 is unbound;
- scan/detail producer bindings are incomplete;
- tenant/data-plane/source state is not ready;
- provider is unsupported;
- tenant dispatch/data-plane identity does not match;
- normalized provider evidence fails its contract.

## M5 acceptance gates

### M5A — safe queue foundation

Required:

- explicit default-OFF automation gate;
- no main producer binding;
- scan/detail Wrangler configs pass dry-run bundling;
- separate DLQs and bounded retry/concurrency config;
- secret-free CI proves the above.

No Cloudflare Queue resource must be created just to pass M5A.

### M5B — native tenant data-plane command path

Required:

- Queue consumers use `TENANT_DISPATCH` to target the exact tenant User Worker;
- tenant internal command writes through native D1 binding;
- public platform routing cannot invoke the internal command;
- tenant mismatch fails closed;
- existing runtime/bootstrap deployment can provide the command before import begins;
- unit/integration tests cover read/write batch behavior and cross-tenant rejection.

### M5C — real Cloudflare activation

Required:

- real scan/detail/DLQ resources exist;
- exactly one consumer Worker is attached to each primary queue;
- consumer configs match repository policy;
- main producer bindings exist while automation remains OFF;
- one controlled tenant import succeeds;
- simultaneous two-tenant import succeeds without crossing D1/source/media state;
- failed/retried/deferred behavior is observed safely;
- no public source/provider leak;
- only then may automatic cron discovery be enabled.

## Rollback

Before automatic launch, disabling `TENANT_IMPORT_AUTOMATION_ENABLED` must stop new cron discovery/dispatch without deleting tenant data or Queue resources.

If consumers are unhealthy:

- disable automatic dispatch first;
- stop/pause producer flow as applicable;
- preserve Queue/DLQ messages and durable job state;
- repair consumer/runtime behavior;
- resume through explicit recovery.

Deleting queues is not the first recovery action.
