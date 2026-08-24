import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { queryD1Batch } from '../worker/cloudflare-platform.js';

const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const WORKER_ACCOUNT_SECRET_PRESENT =
  String(process.env.WORKER_PLATFORM_ACCOUNT_SECRET_PRESENT || '') === 'true';
const WORKER_TOKEN_SECRET_PRESENT =
  String(process.env.WORKER_PLATFORM_TOKEN_SECRET_PRESENT || '') === 'true';
const STAGE_TABLES = [
  'supplier_sync_stage_runs',
  'supplier_sync_stage_observations',
  'supplier_sync_stage_events',
  'supplier_sync_stage_categories'
];

export const RETAINED_FLEET_FIXTURES = [
  { kind: 'success', tenantId: 't_bcbcdba75017bbd7e69b' },
  { kind: 'failure', tenantId: 't_f99926b821ca91baa2bb' },
  { kind: 'blocked', tenantId: 't_4963394770c85357a30f' }
];

const FIXTURE_ENV_BY_KIND = {
  success: 'RETAINED_FLEET_SUCCESS_TENANT_ID',
  failure: 'RETAINED_FLEET_FAILURE_TENANT_ID',
  blocked: 'RETAINED_FLEET_BLOCKED_TENANT_ID'
};

export function resolveRetainedFleetFixtures(env = process.env) {
  const fixtures = RETAINED_FLEET_FIXTURES.map((fixture) => ({
    ...fixture,
    tenantId: String(env[FIXTURE_ENV_BY_KIND[fixture.kind]] || fixture.tenantId).trim()
  }));
  if (fixtures.some((fixture) => !/^t_[a-f0-9]{20}$/i.test(fixture.tenantId))) {
    throw new Error('fleet_diagnostic_tenant_id_invalid');
  }
  if (new Set(fixtures.map((fixture) => fixture.tenantId)).size !== fixtures.length) {
    throw new Error('fleet_diagnostic_tenant_ids_not_unique');
  }
  return fixtures;
}

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const CONTROL_DB_ID = String(
  wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
).trim();

function validateRuntime() {
  if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) {
    throw new Error('fleet_diagnostic_account_unconfigured');
  }
  if (API_TOKEN.length < 20) throw new Error('fleet_diagnostic_token_unconfigured');
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(DISPATCH_NAMESPACE)) {
    throw new Error('fleet_diagnostic_dispatch_namespace_invalid');
  }
  if (!/^[a-f0-9-]{32,40}$/i.test(CONTROL_DB_ID)) {
    throw new Error('fleet_diagnostic_control_database_invalid');
  }
}

function platformConfig() {
  return {
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    dispatchNamespace: DISPATCH_NAMESPACE
  };
}

async function controlBatch(batch) {
  return queryD1Batch({ ...platformConfig(), databaseId: CONTROL_DB_ID, batch });
}

async function tenantBatch(databaseId, batch) {
  return queryD1Batch({ ...platformConfig(), databaseId, batch });
}

function first(result, index) {
  return result[index]?.results?.[0] || null;
}

function rows(result, index) {
  return result[index]?.results || [];
}

function fixtureIds({ tenantId }) {
  const suffix = tenantId.slice(2);
  return {
    sourceKey: 'fleet-canary',
    productId: `prd_${suffix}`,
    provisioningId: `p_${suffix}`
  };
}

async function inspectControlFixture(fixture) {
  const ids = fixtureIds(fixture);
  const result = await controlBatch([
    {
      sql: `SELECT i.status AS catalog_status, i.schema_version, i.last_migration_at,
                   i.last_error, p.setup_status, p.published_at,
                   d.dispatch_namespace, d.worker_status, d.database_status,
                   d.d1_database_id, d.migration_command_version,
                   d.migration_command_prepared_at,
                   d.migration_command_last_error_code
              FROM tenant_catalog_instances i
              JOIN tenant_store_profiles p ON p.tenant_id=i.tenant_id
              JOIN tenant_data_plane_provider_state d ON d.tenant_id=i.tenant_id
             WHERE i.tenant_id=?1
             LIMIT 1`,
      params: [fixture.tenantId]
    },
    {
      sql: `SELECT target_schema_version, migration_kind, status, attempt_count,
                   last_error_code, next_attempt_at, created_at, started_at,
                   finished_at, updated_at
              FROM tenant_data_plane_migration_jobs
             WHERE tenant_id=?1 AND target_schema_version=5
             ORDER BY created_at DESC`,
      params: [fixture.tenantId]
    },
    {
      sql: `SELECT mode, status, phase, attempt_count, last_error_code,
                   created_at, updated_at
              FROM tenant_import_jobs
             WHERE tenant_id=?1 AND source_key=?2
             ORDER BY created_at DESC`,
      params: [fixture.tenantId, ids.sourceKey]
    },
    {
      sql: `SELECT status, current_step, context_json, started_at, finished_at,
                   last_error, created_at, updated_at
              FROM tenant_provisioning_runs
             WHERE provisioning_id=?1 AND tenant_id=?2
             LIMIT 1`,
      params: [ids.provisioningId, fixture.tenantId]
    },
    {
      sql: `SELECT status, attempt_count, started_at, finished_at, last_error,
                   metadata_json, updated_at
              FROM tenant_provisioning_steps
             WHERE provisioning_id=?1 AND step_key='migrations'
             LIMIT 1`,
      params: [ids.provisioningId]
    },
    {
      sql: `SELECT provider, status, sync_strategy, removal_miss_threshold
              FROM supplier_sources
             WHERE tenant_id=?1 AND source_key=?2
             LIMIT 1`,
      params: [fixture.tenantId, ids.sourceKey]
    }
  ]);
  return {
    catalog: first(result, 0),
    migrationJobs: rows(result, 1),
    imports: rows(result, 2),
    provisioning: first(result, 3),
    migrationStep: first(result, 4),
    source: first(result, 5)
  };
}

async function inspectTenantFixture(fixture, databaseId) {
  const ids = fixtureIds(fixture);
  const stagePlaceholders = STAGE_TABLES.map(() => '?').join(',');
  const result = await tenantBatch(databaseId, [
    {
      sql: `SELECT tenant_id, schema_version
              FROM data_plane_identity
             WHERE tenant_id=?1
             LIMIT 1`,
      params: [fixture.tenantId]
    },
    {
      sql: `SELECT GROUP_CONCAT(version, ',') AS versions
              FROM (SELECT version FROM data_plane_schema_migrations ORDER BY version)`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM sqlite_master
             WHERE type='table' AND name IN (${stagePlaceholders})`,
      params: STAGE_TABLES
    },
    {
      sql: `SELECT p.name, p.description, p.classification_status,
                   a.listing_fingerprint, a.detail_fingerprint, a.status, a.miss_count,
                   o.override_json, o.override_version
              FROM catalog_products p
              JOIN supplier_album_index a
                ON a.public_product_id=p.product_id
               AND a.tenant_id=?1 AND a.source_key=?2
              JOIN catalog_product_classification_overrides o ON o.product_id=p.product_id
             WHERE p.product_id=?3
             LIMIT 1`,
      params: [fixture.tenantId, ids.sourceKey, ids.productId]
    },
    { sql: 'SELECT COUNT(*) AS total FROM media_sources', params: [] },
    { sql: 'PRAGMA foreign_key_check', params: [] }
  ]);
  return {
    identity: first(result, 0),
    ledger: String(first(result, 1)?.versions || ''),
    stageTableCount: Number(first(result, 2)?.total || 0),
    lkg: first(result, 3),
    mediaCount: Number(first(result, 4)?.total || 0),
    foreignKeyFindings: rows(result, 5).length
  };
}

function historicalOnboardingPreserved(control) {
  return Boolean(
    control.provisioning?.status === 'success' &&
    control.provisioning?.current_step === 'complete' &&
    control.provisioning?.context_json === '{"fleetCanary":"historical"}' &&
    control.provisioning?.started_at === '2000-01-01T00:00:00Z' &&
    control.provisioning?.finished_at === '2000-01-01T00:00:00Z' &&
    control.provisioning?.created_at === '2000-01-01T00:00:00Z' &&
    control.provisioning?.updated_at === '2000-01-01T00:00:00Z' &&
    control.provisioning?.last_error === null &&
    control.migrationStep?.status === 'success' &&
    Number(control.migrationStep?.attempt_count) === 1 &&
    control.migrationStep?.metadata_json === '{"schemaVersion":4,"sentinel":"unchanged"}' &&
    control.migrationStep?.updated_at === '2000-01-01T00:00:00Z' &&
    control.migrationStep?.last_error === null
  );
}

function lkgPreserved(fixture, tenant, schemaVersion) {
  const expectedLedger = schemaVersion === 5 ? '1,2,3,4,5' : '1,2,3,4';
  const expectedStageTableCount = schemaVersion === 5 ? STAGE_TABLES.length : 0;
  return Boolean(
    tenant.identity?.tenant_id === fixture.tenantId &&
    Number(tenant.identity?.schema_version) === schemaVersion &&
    tenant.ledger === expectedLedger &&
    tenant.stageTableCount === expectedStageTableCount &&
    tenant.foreignKeyFindings === 0 &&
    tenant.mediaCount === 1 &&
    tenant.lkg?.name === 'Verified LKG Product' &&
    tenant.lkg?.description === 'Verified tenant LKG' &&
    tenant.lkg?.classification_status === 'known' &&
    tenant.lkg?.detail_fingerprint === 'detail-lkg-v1' &&
    tenant.lkg?.status === 'active' &&
    Number(tenant.lkg?.miss_count) === 0 &&
    Number(tenant.lkg?.override_version) === 1 &&
    tenant.lkg?.override_json === JSON.stringify({ displayName: `Fleet Canary ${fixture.kind}` })
  );
}

export function classifyFleetDiagnostic({ fixtures, accountSecretPresent, tokenSecretPresent }) {
  const allJobsAbsent = fixtures.every((fixture) => fixture.migrationJobs.length === 0);
  const allV4LkgPreserved = fixtures.every(
    (fixture) =>
      Number(fixture.schemaVersion) === 4 &&
      fixture.lkgPreserved === true &&
      fixture.historicalOnboardingPreserved === true
  );
  const blockedImportPreserved = fixtures.some(
    (fixture) => fixture.kind === 'blocked' && fixture.activeImportPreserved === true
  );
  const platformRuntimeConfigured = accountSecretPresent && tokenSecretPresent;
  let rootCause = 'fleet_scheduler_state_requires_review';
  if (allJobsAbsent && allV4LkgPreserved && blockedImportPreserved && !platformRuntimeConfigured) {
    rootCause = 'worker_platform_runtime_unconfigured';
  } else if (!allJobsAbsent) {
    rootCause = 'scheduler_progressed_after_failed_canary';
  }
  return {
    rootCause,
    allJobsAbsent,
    allV4LkgPreserved,
    blockedImportPreserved,
    workerPlatformRuntimeConfigured: platformRuntimeConfigured
  };
}

async function inspectFixture(fixture) {
  const control = await inspectControlFixture(fixture);
  const databaseId = String(control.catalog?.d1_database_id || '').trim();
  if (!/^[a-f0-9-]{32,40}$/i.test(databaseId)) {
    throw new Error('fleet_diagnostic_database_missing');
  }
  const tenant = await inspectTenantFixture(fixture, databaseId);
  const activeImport = control.imports.some((entry) =>
    ['pending', 'queued', 'scanning', 'details', 'finalizing'].includes(entry.status)
  );
  const schemaVersion = Number(control.catalog?.schema_version || 0);
  return {
    kind: fixture.kind,
    tenantId: fixture.tenantId,
    catalogStatus: control.catalog?.catalog_status || null,
    storeStatus: control.catalog?.setup_status || null,
    schemaVersion,
    safeErrorCode: control.catalog?.last_error || null,
    dispatchNamespaceMatches: control.catalog?.dispatch_namespace === DISPATCH_NAMESPACE,
    workerStatus: control.catalog?.worker_status || null,
    databaseStatus: control.catalog?.database_status || null,
    migrationCommandVersion: Number(control.catalog?.migration_command_version || 0),
    migrationCommandPreparedAt: control.catalog?.migration_command_prepared_at || null,
    migrationCommandSafeError: control.catalog?.migration_command_last_error_code || null,
    source: control.source,
    migrationJobs: control.migrationJobs,
    activeImportPreserved: fixture.kind === 'blocked' ? activeImport : !activeImport,
    historicalOnboardingPreserved: historicalOnboardingPreserved(control),
    lkgPreserved: lkgPreserved(fixture, tenant, schemaVersion),
    merchantOverridePreserved: Boolean(tenant.lkg?.override_json),
    tenantSchemaLedger: tenant.ledger,
    stageTableCount: tenant.stageTableCount,
    foreignKeyFindings: tenant.foreignKeyFindings
  };
}

async function main() {
  validateRuntime();
  const retainedFixtures = resolveRetainedFleetFixtures();
  const fixtures = [];
  for (const fixture of retainedFixtures) fixtures.push(await inspectFixture(fixture));

  const aggregate = await controlBatch([
    {
      sql: `SELECT target_schema_version, migration_kind, status, COUNT(*) AS total
              FROM tenant_data_plane_migration_jobs
             WHERE target_schema_version=5
             GROUP BY target_schema_version, migration_kind, status
             ORDER BY migration_kind, status`,
      params: []
    },
    { sql: 'SELECT COUNT(*) AS total FROM catalog_products', params: [] }
  ]);
  const diagnosis = classifyFleetDiagnostic({
    fixtures,
    accountSecretPresent: WORKER_ACCOUNT_SECRET_PRESENT,
    tokenSecretPresent: WORKER_TOKEN_SECRET_PRESENT
  });

  console.log(
    JSON.stringify(
      {
        tenantDataPlaneFleetDiagnosticCompleted: true,
        readOnly: true,
        recurringSyncAutomationEnabled: false,
        workerPlatformSecrets: {
          accountIdPresent: WORKER_ACCOUNT_SECRET_PRESENT,
          apiTokenPresent: WORKER_TOKEN_SECRET_PRESENT
        },
        diagnosis,
        fixtures,
        fleetMigrationJobAggregate: rows(aggregate, 0),
        defaultCatalogProducts: Number(first(aggregate, 1)?.total || 0)
      },
      null,
      2
    )
  );
}

const isDirectExecution =
  Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) await main();
