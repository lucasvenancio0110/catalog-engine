# Isolated tenant data planes

Status: **Normative implementation contract**  
Scope: tenant-isolated catalog databases, Workers for Platforms runtime binding and tenant schema migration behavior.

## Decision

Catalog Engine's target SaaS data-plane model is **one isolated D1 catalog database per tenant, attached only to that tenant's Worker inside a shared Workers for Platforms dispatch namespace**.

The platform Worker remains the hostname/control-plane boundary. It resolves the merchant hostname and, once the tenant data plane is ready, dynamically dispatches catalog/API/media requests to the correct tenant Worker. Shared storefront code can remain platform-owned while merchant-specific catalog state stays isolated.

Do not collapse all merchant catalogs into one public D1 and rely only on a `tenant_id` predicate in every storefront product query.

## Workers for Platforms model

Production uses one shared dispatch namespace:

`catalog-engine-production`

A tenant such as `t_0123456789abcdefabcd` receives deterministic provider resources such as:

- User Worker: `ce-0123456789abcdefabcd`;
- D1 database: deterministic tenant database name;
- one logical Catalog Engine data-plane identity in the control plane.

Provider IDs such as D1 UUIDs and Worker versions remain private control-plane state.

A merchant never uploads Worker code. Catalog Engine owns tenant runtime code and uses Workers for Platforms as the isolation/dispatch primitive.

## Control-plane provider state

`tenant_data_plane_provider_state` records safe locator/status information including:

- tenant;
- provider;
- dispatch namespace;
- Worker script name/status/version;
- D1 name/UUID/status;
- last provider check;
- safe error code.

`tenant_data_plane_jobs` records resumable infrastructure work.

`tenant_data_plane_migration_jobs` separately records schema migration attempts so infrastructure retry and database-schema retry cannot corrupt each other.

Migration jobs distinguish two lifecycles:

- `provisioning` — schema work that belongs to an active onboarding/provisioning checkpoint;
- `maintenance` — additive schema upgrade for an already-ready tenant data plane.

Historical migration jobs created before this distinction retain `provisioning` as the backward-compatible default.

Bounded maintenance discovery considers only tenants that do not already have a deterministic migration job for the current target schema, regardless of that job's status. Existing failed jobs remain owned by the due/retry processor and keep their recorded backoff; they must not repeatedly consume discovery slots or starve unrelated ready tenants. Within the same lifecycle priority, newly pending work is selected before failed retries that are due, so an older failure cannot monopolize every bounded processing slot.

## Provisioning lifecycle

A merchant connects a supported private source before Catalog Engine allocates the isolated catalog data plane in the normal self-service flow.

The provisioner:

1. derives deterministic tenant provider identities;
2. verifies the production dispatch namespace;
3. looks up/reuses an already-created deterministic tenant D1 after interrupted attempts;
4. creates the D1 only when necessary;
5. stores the D1 UUID privately;
6. uploads the tenant bootstrap/runtime Worker;
7. binds exactly that tenant D1 as `CATALOG_DB`;
8. binds only safe opaque tenant context;
9. marks the physical data-plane checkpoint complete;
10. advances onboarding to tenant schema migration.

Provisioning is idempotent. Retrying the same intended tenant must not create duplicate D1 databases or tenant runtimes.

## Tenant-only schema migration

Tenant schema migration is version-ledgered and idempotent.

The migration runner installs the current tenant data-plane schema through bounded D1 batch queries and verifies the tenant identity/source boundary before advancing onboarding or closing a maintenance upgrade. It plans from the recorded current version: fresh provisioning applies one transactional batch per schema version, while an existing v5 tenant receives only the idempotent v6 delta instead of replaying the cumulative v1-v6 schema in one remote request. Maintenance inspection, additive schema application and final verification use the tenant's existing `TENANT_DISPATCH`/D1 binding path.

The ordinary v1 internal batch command continues to reject DDL and caller-supplied multi-statement SQL. Maintenance DDL uses a separate versioned internal command whose request contains only opaque tenant identity and the current target schema version. The User Worker owns the immutable per-version statement map, validates its bound tenant and contiguous schema ledger, applies one transactional D1 binding batch per version, and verifies the final ledger before returning. A caller cannot provide SQL or select an unrecognized target. Before an existing maintenance tenant becomes scheduler-eligible, the trusted-main deployment idempotently republishes the same catalog runtime from CI and promotes the durable `migration_command_version` marker only after that Workers for Platforms upload succeeds. Public storefront/runtime verification state and the old LKG remain unchanged.

The schema line is additive:

```text
v1 -> base tenant catalog/source/media schema
v2 -> later tenant catalog/runtime additions
v3 -> versioned classification state + durable merchant overrides
v4 -> detailed domain-neutral CEI intelligence state
v5 -> private staged incremental-sync state
v6 -> private relational candidate detail/media/CEI/merchandising state
```

### Active code target and production boundary

The active code migration target is schema v6:

`TENANT_DATA_PLANE_SCHEMA_VERSION = 6`

New/in-flight tenants are migrated to v6 through the normal provisioning migration path. Already-ready tenants below v6 are discovered as bounded maintenance work instead of being sent back through onboarding.

Schema v6 activation does **not** itself enable recurring incremental sync or populate candidate rows. The candidate tables become available fleet-wide first; the recurring scheduler remains independently gated until the later M7 consumer/detail/verification/promotion slices are proven.

Each version extends previous versions rather than destructively replacing them.

The tenant D1 contains high-volume/private catalog structures such as:

- tenant/data-plane identity and migration ledger;
- normalized products/categories/catalog metadata;
- merchandising entities/facets;
- media registry and product/media mapping;
- private source configuration/index/fingerprints;
- sync runs/events and detail state;
- classification state;
- durable merchant classification overrides;
- detailed CEI product intelligence state;
- private staged sync runs/observations/events/categories used before LKG promotion.
- run-owned candidate products, media, taxonomy/entities/facets, CEI state and catalog metadata used only before verified promotion.

It deliberately does **not** contain SaaS control-plane tables such as memberships, subscriptions, customer domains, account billing state, platform audit history or provisioning runs.

## CEI intelligence persistence in v4

Schema v4 adds:

`catalog_product_intelligence_state`

The persistence model is retail-domain-neutral.

The table indexes operational facts such as:

- classifier/evidence/CEI contract versions;
- Knowledge Pack identity;
- domain and confidence;
- knowledge state;
- override/review/research flags;
- conflict count.

The canonical bounded `state_json` contains generic CEI claims and separates automatic inference from effective merchant-corrected state.

The schema must not require a migration merely because a future Knowledge Pack introduces fields such as:

- Sports: team/league/season;
- Automotive: make/model/fitment/bolt pattern;
- Dental: component/platform/connection.

Domain code owns claim meaning. CEI Core owns validation/persistence.

## M7C3 private staged sync state in v5

Schema v5 adds private, run-scoped staging structures for Intelligent Sync:

- `supplier_sync_stage_runs`;
- `supplier_sync_stage_observations`;
- `supplier_sync_stage_events`;
- `supplier_sync_stage_categories`.

The purpose of staging is to ensure a new supplier observation cannot partially overwrite the canonical `supplier_album_index` while a large run is still being assembled.

The stage run persists:

- opaque run/tenant/source identity;
- opaque `scope_id` and bounded `scope_kind`;
- safety outcome/policy version;
- complete/incomplete scan evidence;
- previous known-good and current observed counts;
- expected/staged event/detail/category counts;
- verification and safe error codes;
- lifecycle state such as `staging`, `planned`, `details_pending`, `verified`, `promoting`, `promoted`, `preserved` or `quarantined`.

Provider-private source URLs/IDs may exist in the stage observation table because it is an isolated private data-plane structure. They are not public storefront truth.

### LKG authority boundary

Staging is not canonical state.

```text
canonical supplier_album_index (LKG)
        ↓ remains serving/unchanged
new normalized scan + safety/delta
        ↓
private run-scoped staging
        ↓
detail/CEI work where required
        ↓
verification
        ↓
set-based promotion
        ↓
new canonical LKG
```

Interrupted staging may leave partial **stage rows**, but it must not leave the canonical LKG half-promoted. A retry can reset/rebuild the same run-scoped stage before verification.

Promotion must be fail-closed at SQL authority boundaries: only a matching stage run explicitly transitioned from verified state into `promoting` may mutate canonical private source-index state.

The M7C3 foundation initially permits verification/promotion only when `expected_detail_count = 0`. Runs containing NEW/CHANGED/RESTORED work remain `details_pending` until the later detail/CEI staging slice implements and verifies those affected products.

This conservative boundary is deliberate; schema presence alone must not imply that an incomplete detail pipeline is safe to publish.

## M7D1 relational candidate state in v6

Schema v6 keeps the v5 listing-stage tables intact and adds twelve private tables for candidate catalog categories, leagues, teams, facets, media, affected product detail, product relationships, classification, intelligence and catalog metadata. The model mirrors the relational boundaries required for later verification/promotion without creating a second public catalog or writing candidate data into canonical tables.

Ownership and cleanup are explicit:

- `supplier_sync_stage_runs.run_id` is the root of every candidate row;
- staged product identity must match both the v5 observation and event for the same run/album/public-product tuple;
- candidate product/media/category/facet and classification/intelligence references use foreign keys rather than an opaque whole-catalog document;
- normalized evidence and CEI/meta documents are valid JSON with byte bounds, remain private and do not become storefront payloads;
- candidate classification records the merchant-override version used, while the durable override itself remains canonical and outside the candidate tree;
- deleting one exact stage run cascades its listing/candidate rows only; it cannot delete canonical products, media, supplier LKG or merchant overrides.

Migration v6 is storage-only and creates no candidate rows. It advances identity/ledger in the same transactional version batch as its additive tables/indexes. Failure rolls the version batch back to complete v5 authority. Runtime readers continue serving the canonical LKG and do not query `supplier_sync_stage_*`.

The migration-command capability marker advances to v2 because a v5-capable User Worker does not contain the immutable v6 statement map. Trusted CI must upload the v6-capable Worker before promoting marker v2; maintenance discovery requires that marker and therefore cannot hand target 6 to stale runtime code.

## Private source handling

Raw supplier URLs are never embedded in static migration SQL.

The source connection is supplied as a bound runtime query parameter and remains private tenant data.

Provider-private source identifiers, locators and media origins remain inside the tenant data plane or minimal private queue processing. They are not public storefront fields.

## Migration verification

After a migration batch, the runner verifies at minimum:

- the expected tenant identity;
- the expected schema version;
- the expected active source boundary.

Only after verification does the control plane record the new tenant schema version.

For a provisioning migration, the runner then resumes the owning onboarding checkpoint. For a maintenance migration, it closes only the maintenance job and updates schema metadata; it must not replay or mutate a historical provisioning run.

Schema generation is idempotent through constructs such as:

- `CREATE TABLE IF NOT EXISTS`;
- `CREATE INDEX IF NOT EXISTS`;
- conflict-safe upserts;
- migration-ledger inserts.

Each version batch records its identity version and ledger row in the same D1 transaction as that version's additive statements. Before maintenance, the runner reads the isolated D1 identity and requires a contiguous migration ledger; it fails closed if D1 is behind the control-plane claim. A later-version failure can therefore leave only an earlier complete schema version, never a half-committed version batch. The control plane remains on the previous version until final identity/source verification succeeds. If D1 is safely ahead because that final control-plane write was interrupted, the next attempt verifies and reconciles it without replaying completed schema DDL.

Transport aborts are persisted separately from unreachable transport. Trusted-CI preparation records a bounded `tenant_migration_command_prepare_*` code without changing serving state or schema authority. The cron runner phase-qualifies bounded binding-native `inspect`, `apply` and `verify` codes so retained evidence identifies whether failure occurred before DDL, during an idempotent version batch or during final verification. Retryable dispatch-transport failures receive at most three in-run attempts with exponential backoff and jitter; the durable job retry remains the outer recovery boundary. The binding migration command may also be retried because its version batches are transactional and replay-safe. Non-transport/schema-state errors are not retried. None of these codes exposes provider response text or credentials.

## Existing tenants and maintenance upgrades

New tenant provisioning must reach the current required schema before dependent stages run.

Already-ready tenants are eligible for additive maintenance upgrade only when:

- the tenant and private source remain active;
- the isolated D1 and tenant Worker provider state are active;
- the catalog instance is currently `ready`;
- its schema version is below the current target;
- trusted CI has promoted the required `migration_command_version` capability marker;
- no import/incremental/recovery job is actively mutating that tenant catalog;
- no current-version migration job is already pending/running.

Maintenance upgrades preserve availability. They do not set a ready catalog back to `provisioning`, do not replay historical onboarding steps and do not replace commercial catalog data. A maintenance failure records a safe migration error/retry state while the previous last-known-good storefront continues serving.

Production activation of a new fleet schema target requires a dedicated trusted-main maintenance canary, not only a fresh-tenant provisioning canary. The current fleet canary starts from isolated ready v5 fixtures, prepares only the eligible success fixture through the same trusted-CI helper, and then lets the deployed cron discover the work without inserting migration jobs or Queue messages. The controlled namespace-mismatch fixture already carries command capability v2 so it reaches the intended safe failure, while the active-import fixture remains unprepared and undiscovered. The proof covers trusted capability promotion, successful binding-native v5→v6 upgrade, controlled failure with LKG preservation, active-import exclusion, unchanged historical onboarding and v5 stage evidence, exact schema ledger/candidate tables, zero candidate rows created by migration, merchant override preservation and unrelated-tenant isolation. Unexpected failure retains opaque fixture evidence plus the bounded migration job code/attempt count for diagnosis; cleanup happens only after the complete proof passes. Runtime or preparation changes require the normal successful-deploy trigger.

This distinction is part of the M7 safety model: internal schema readiness may advance independently from catalog publication authority.

Schema deployment and commercial catalog replacement remain separate responsibilities according to `DEPLOYMENT-PIPELINES.md`.

## Tenant Worker readiness

A bootstrap/provisioning tenant Worker must not present an empty or partially prepared catalog as a healthy published store.

Catalog/runtime readiness is established only after the relevant migration, import, CEI/classification and verification checkpoints succeed.

Detailed CEI state is operational/private by default; the ordinary public storefront does not gain access to private provenance/research/conflict internals merely because schema v4 stores them.

Likewise, v5 staged supplier observations and all v6 candidate rows are operational/private and are not storefront payloads. Public runtime readers do not query `supplier_sync_stage_*` tables.

## Runtime dispatch

Public routing follows:

```text
hostname
-> trusted tenant resolution
-> server-owned tenant runtime identity
-> TENANT_DISPATCH
-> tenant User Worker
-> isolated tenant CATALOG_DB
```

Routing fails closed.

A client-provided Worker name or tenant identifier is never sufficient authority to select another tenant's data plane.

The private internal D1 command path used by Queue workers remains inaccessible through ordinary public merchant routing.

## Idempotency and crash recovery

D1 creation and Worker upload cannot be treated as one-shot operations.

A Worker can fail after the provider resource exists but before the control plane records success. Deterministic resource names and idempotent updates therefore allow retries to reuse the intended resource rather than duplicate it.

Provider jobs and migration jobs use independent bounded attempts, retry delays and stale-running reclamation. Provider errors are reduced to safe codes before persistence.

Incremental staging follows the same principle: stage writes are run-scoped and rebuildable, while canonical promotion is a separately gated operation after verification.

Maintenance schema upgrades also remain resumable. If the isolated D1 reaches the new additive schema but the control-plane completion write is interrupted, the next attempt re-applies the idempotent schema batch and then reconciles the control-plane version rather than rebuilding catalog data.

## Runtime configuration

Physical provisioning/migration requires dedicated platform configuration such as:

- `CLOUDFLARE_PLATFORM_ACCOUNT_ID`;
- `CLOUDFLARE_PLATFORM_API_TOKEN`;
- `CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE`.

The credential should be scoped to required provisioning/migration responsibilities. Do not expose it to merchant browsers or ordinary untrusted PR validation.

The trusted-main application pipeline uploads the account ID and API token as Worker secrets in the same Wrangler deployment as the exact tested code SHA, then verifies only the two `secret_text` binding names through the read-only Worker Script Settings API. Those runtime secrets remain limited to physical provider operations and fresh-provisioning work. Existing-tenant User Worker preparation is a trusted-CI operation using Actions secrets after the exact Worker SHA is deployed; the helper selects only ready/idle tenants, excludes retained fleet fixtures, uploads the current deterministic User Worker, and conditionally promotes `migration_command_version` plus the opaque Worker version. A changed eligibility boundary after upload prevents marker promotion. Maintenance D1 inspection/application/verification, import, classification and verification use `TENANT_DISPATCH` and must not fall back to administrative D1 REST access.

With required privileged configuration absent, provisioning/migration code fails closed before production provider mutation.

## Import/classification integration

After provisioning migration, onboarding advances through:

```text
import
-> CEI/classify
-> verify/private preview readiness
-> domain/runtime readiness
-> publish
```

A maintenance migration for an already-ready tenant does not restart this sequence.

The tenant data plane preserves:

- bounded supplier concurrency;
- private raw source state;
- normalized evidence;
- canonical Catalog Engine merchandising relationships;
- safe media registry;
- durable merchant overrides;
- detailed CEI state;
- future incremental sync from private fingerprints rather than repeated full crawls.

## Cost boundary

The isolated model intentionally creates one D1 and one tenant Workers-for-Platforms script per active merchant/store under the current architecture.

Plans/quotas should account for real platform usage. Resource allocation must remain entitlement/onboarding controlled and normal provisioning must be automatic rather than owner-operated.

## Final decision rule

For every tenant data-plane change ask:

> Does this preserve one-tenant isolation, idempotent migration, private source state, application-vs-catalog separation, and a path to future Knowledge Packs without turning the shared CEI Core into a vertical-specific schema?

If not, redesign before merge.
