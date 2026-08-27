import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createD1Database,
  queryD1Batch,
  uploadTenantCatalogWorker
} from '../worker/cloudflare-platform.js';
import { TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION } from '../worker/tenant-data-plane-command.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION as PREVIOUS_SCHEMA_VERSION,
  TENANT_SYNC_CANDIDATE_TABLES,
  tenantDataPlaneCurrentBatch as tenantDataPlaneV6Batch
} from '../worker/tenant-data-plane-schema-v6.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION as CURRENT_SCHEMA_VERSION
} from '../worker/tenant-data-plane-schema-v7.js';
import { prepareTenantMigrationCommandCapability } from './cloudflare-tenant-data-plane-fleet-prepare.mjs';

const API_ORIGIN = 'https://api.cloudflare.com';
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const POLL_MS = 5_000;
const COMPLETION_TIMEOUT_MS = 22 * 60_000;
const HISTORICAL_TIMESTAMP = '2000-01-01T00:00:00Z';
const HISTORICAL_CONTEXT = '{"fleetCanary":"historical"}';
const HISTORICAL_MIGRATION_METADATA = '{"schemaVersion":6,"sentinel":"unchanged"}';
const EXPECTED_FAILURE_CODE = 'tenant_dispatch_namespace_mismatch';
const LISTING_STAGE_TABLES = [
  'supplier_sync_stage_runs',
  'supplier_sync_stage_observations',
  'supplier_sync_stage_events',
  'supplier_sync_stage_categories'
];

class FleetCanaryError extends Error {
  constructor(code, migrationFailureEvidence = null) {
    super(code);
    this.name = 'FleetCanaryError';
    this.migrationFailureEvidence = migrationFailureEvidence;
  }
}

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const CONTROL_DB_ID = String(
  wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
).trim();
function validateRuntime() {
  if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('fleet_canary_account_unconfigured');
  if (API_TOKEN.length < 20) throw new Error('fleet_canary_token_unconfigured');
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(DISPATCH_NAMESPACE)) {
    throw new Error('fleet_canary_dispatch_namespace_invalid');
  }
  if (PREVIOUS_SCHEMA_VERSION !== 6 || CURRENT_SCHEMA_VERSION !== 7) {
    throw new Error('fleet_canary_schema_contract_mismatch');
  }
  if (!/^[a-f0-9-]{32,40}$/i.test(CONTROL_DB_ID)) {
    throw new Error('fleet_canary_control_database_invalid');
  }
  if (String(wrangler.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') !== '0') {
    throw new Error('fleet_canary_requires_recurring_sync_off');
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function platformConfig() {
  return {
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    dispatchNamespace: DISPATCH_NAMESPACE
  };
}

export function fixtureIdentity(kind, seedOverride = '') {
  if (!['success', 'failure', 'blocked'].includes(kind)) {
    throw new Error('fleet_canary_fixture_kind_invalid');
  }
  const seed =
    seedOverride ||
    `${process.env.GITHUB_RUN_ID || Date.now()}:${process.env.GITHUB_RUN_ATTEMPT || '1'}:${kind}`;
  const suffix = createHash('sha256').update(`fleet-canary:${seed}`).digest('hex').slice(0, 20);
  return {
    kind,
    tenantId: `t_${suffix}`,
    sourceKey: 'fleet-canary',
    workerScriptName: `ce-${suffix}`,
    databaseName: `cefm-${suffix}`,
    dispatchNamespace: DISPATCH_NAMESPACE,
    dataPlaneKey: `fleet-canary-${suffix}`,
    provisioningId: `p_${suffix}`,
    idempotencyKey: `fleet-canary:${suffix}`,
    importId: `imp_${suffix}`,
    categoryId: `cat_${suffix}`,
    productId: `prd_${suffix}`,
    mediaId: `med_${suffix}`,
    stageRunId: `sync_${suffix}`,
    stageCategoryId: `stage_cat_${suffix}`,
    albumSourceId: `alb_${suffix}`,
    listingFingerprint: createHash('sha256').update(`lkg:${suffix}`).digest('hex'),
    overrideJson: JSON.stringify({ displayName: `Fleet Canary ${kind}` }),
    sourceUrl: 'https://fleet-canary.invalid/catalog',
    databaseId: null,
    workerCreated: false,
    controlCreated: false,
    initialWorkerVersion: null
  };
}

async function cloudflareRequest(path, { method = 'GET', allowNotFound = false } = {}) {
  let response;
  try {
    response = await fetch(new URL(path, API_ORIGIN), {
      method,
      redirect: 'error',
      headers: {
        authorization: `Bearer ${API_TOKEN}`,
        accept: 'application/json'
      }
    });
  } catch {
    throw new Error('fleet_canary_cloudflare_unreachable');
  }
  if (allowNotFound && response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    throw new Error('fleet_canary_cloudflare_request_failed');
  }
  return payload.result ?? null;
}

async function controlBatch(batch) {
  return queryD1Batch({ ...platformConfig(), databaseId: CONTROL_DB_ID, batch });
}

async function tenantBatch(fixture, batch) {
  return queryD1Batch({ ...platformConfig(), databaseId: fixture.databaseId, batch });
}

async function defaultCatalogCount() {
  const result = await controlBatch([
    { sql: 'SELECT COUNT(*) AS total FROM catalog_products', params: [] }
  ]);
  return Number(result[0]?.results?.[0]?.total || 0);
}

async function assertControlSchemaReady() {
  const result = await controlBatch([
    { sql: "PRAGMA table_info('tenant_data_plane_migration_jobs')", params: [] },
    { sql: "PRAGMA table_info('tenant_data_plane_provider_state')", params: [] }
  ]);
  const jobColumns = new Set((result[0]?.results || []).map((row) => String(row.name || '')));
  const providerColumns = new Set((result[1]?.results || []).map((row) => String(row.name || '')));
  if (!jobColumns.has('migration_kind') || !providerColumns.has('migration_command_version')) {
    throw new Error('fleet_canary_control_schema_not_ready');
  }
}

export function initialDataPlaneSeed(fixture) {
  return [
    {
      sql: `INSERT INTO catalog_categories
              (category_id, name, depth, sort_order, product_count, updated_at)
            VALUES (?1, 'Fleet Canary Category', 0, 0, 1, CURRENT_TIMESTAMP)`,
      params: [fixture.categoryId]
    },
    {
      sql: `INSERT INTO media_sources
              (media_id, provider, source_url, display_source_url, thumbnail_source_url,
               referer_url, active, created_at, updated_at)
            VALUES (?1, 'yupoo', ?2, ?2, ?2, ?3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.mediaId, 'https://fleet-canary.invalid/image.jpg', fixture.sourceUrl]
    },
    {
      sql: `INSERT INTO catalog_products
              (product_id, name, search_text, category_id, category_name, description,
               image_count, primary_media_id, sort_order, classification_status, updated_at)
            VALUES (?1, 'Verified LKG Product', 'verified lkg product', ?2,
                    'Fleet Canary Category', 'Verified tenant LKG', 1, ?3, 0,
                    'known', CURRENT_TIMESTAMP)`,
      params: [fixture.productId, fixture.categoryId, fixture.mediaId]
    },
    {
      sql: `INSERT INTO catalog_product_categories (product_id, category_id)
            VALUES (?1, ?2)`,
      params: [fixture.productId, fixture.categoryId]
    },
    {
      sql: `INSERT INTO product_media (product_id, media_id, position)
            VALUES (?1, ?2, 0)`,
      params: [fixture.productId, fixture.mediaId]
    },
    {
      sql: `INSERT INTO supplier_album_index
              (tenant_id, source_key, album_source_id, public_product_id, source_url,
               source_title, source_category_id, source_category_path_json,
               listing_fingerprint, detail_fingerprint, status, miss_count,
               first_seen_at, last_seen_at, last_changed_at, last_detail_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, 'Private LKG Evidence', ?6, '[]',
                    ?7, 'detail-lkg-v1', 'active', 0, CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [
        fixture.tenantId,
        fixture.sourceKey,
        fixture.albumSourceId,
        fixture.productId,
        fixture.sourceUrl,
        fixture.categoryId,
        fixture.listingFingerprint
      ]
    },
    {
      sql: `INSERT INTO catalog_product_classification_overrides
              (product_id, override_json, override_version, created_at, updated_at)
            VALUES (?1, ?2, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.productId, fixture.overrideJson]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_runs
              (run_id, tenant_id, source_key, scope_id, scope_kind, state,
               safety_outcome, safety_policy_version, scan_complete,
               previous_known_good_count, observed_count, verification_code)
            VALUES (?1, ?2, ?3, 'catalog', 'catalog', 'preserved',
                    'preserve_last_known_good', 1, 0, 1, 0, 'historical_preserved')`,
      params: [fixture.stageRunId, fixture.tenantId, fixture.sourceKey]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_categories
              (run_id, category_source_id, name, depth, sort_order)
            VALUES (?1, ?2, 'Historical private category', 0, 0)`,
      params: [fixture.stageRunId, fixture.stageCategoryId]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_catalog_categories
              (run_id, category_id, name, parent_id, depth, sort_order, product_count)
            VALUES (?1, ?2, 'Historical v6 candidate category', NULL, 0, 0, 0)`,
      params: [fixture.stageRunId, fixture.stageCategoryId]
    }
  ];
}

export function controlPlaneSeed(fixture, workerVersion) {
  const dispatchNamespace =
    fixture.kind === 'failure' ? 'fleet-canary-namespace-mismatch' : DISPATCH_NAMESPACE;
  const statements = [
    {
      sql: `INSERT INTO catalog_tenants
              (tenant_id, slug, display_name, status, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [
        fixture.tenantId,
        `fleet-canary-${fixture.tenantId.slice(2)}`,
        `Fleet Migration Canary ${fixture.kind}`
      ]
    },
    {
      sql: `INSERT INTO tenant_store_profiles
              (tenant_id, store_name, theme_key, setup_status, published_at,
               created_at, updated_at)
            VALUES (?1, ?2, 'premium-dark', 'published', CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.tenantId, `Fleet Canary ${fixture.kind}`]
    },
    {
      sql: `INSERT INTO tenant_catalog_instances
              (tenant_id, data_plane_key, status, schema_version,
               last_migration_at, last_error, created_at, updated_at)
            VALUES (?1, ?2, 'ready', ?3, ?4, NULL,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [
        fixture.tenantId,
        fixture.dataPlaneKey,
        PREVIOUS_SCHEMA_VERSION,
        HISTORICAL_TIMESTAMP
      ]
    },
    {
      sql: `INSERT INTO supplier_sources
              (tenant_id, source_key, provider, source_url, status, sync_strategy,
               removal_miss_threshold, created_at, updated_at)
            VALUES (?1, ?2, 'yupoo', ?3, 'active', 'incremental', 3,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.tenantId, fixture.sourceKey, fixture.sourceUrl]
    },
    {
      sql: `INSERT INTO tenant_data_plane_provider_state
              (tenant_id, provider, dispatch_namespace, worker_script_name,
               d1_database_name, d1_database_id, worker_status, database_status,
               worker_version, migration_command_version, migration_command_prepared_at,
               last_checked_at, created_at, updated_at)
            VALUES (?1, 'cloudflare_wfp', ?2, ?3, ?4, ?5, 'active', 'active', ?6, ?7,
                    CASE WHEN CAST(?7 AS INTEGER)>0 THEN CURRENT_TIMESTAMP ELSE NULL END,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [
        fixture.tenantId,
        dispatchNamespace,
        fixture.workerScriptName,
        fixture.databaseName,
        fixture.databaseId,
        workerVersion || 'fleet-canary',
        fixture.kind === 'failure' ? TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION : 0
      ]
    },
    {
      sql: `INSERT INTO tenant_provisioning_runs
              (provisioning_id, tenant_id, idempotency_key, status, current_step,
               context_json, started_at, finished_at, last_error, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'success', 'complete', ?4, ?5, ?5, NULL, ?5, ?5)`,
      params: [
        fixture.provisioningId,
        fixture.tenantId,
        fixture.idempotencyKey,
        HISTORICAL_CONTEXT,
        HISTORICAL_TIMESTAMP
      ]
    },
    {
      sql: `INSERT INTO tenant_provisioning_steps
              (provisioning_id, step_key, status, attempt_count, started_at,
               finished_at, last_error, metadata_json, updated_at)
            VALUES (?1, 'migrations', 'success', 1, ?2, ?2, NULL, ?3, ?2)`,
      params: [fixture.provisioningId, HISTORICAL_TIMESTAMP, HISTORICAL_MIGRATION_METADATA]
    }
  ];

  if (fixture.kind === 'blocked') {
    statements.push({
      sql: `INSERT INTO tenant_import_jobs
              (import_id, tenant_id, source_key, mode, status, phase, attempt_count,
               next_attempt_at, started_at, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'incremental', 'scanning', 'scan', 1,
                    NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [fixture.importId, fixture.tenantId, fixture.sourceKey]
    });
  }
  return statements;
}

async function migrationJob(fixture) {
  const result = await controlBatch([
    {
      sql: `SELECT target_schema_version, migration_kind, status, attempt_count,
                   last_error_code, created_at, started_at, finished_at
              FROM tenant_data_plane_migration_jobs
             WHERE tenant_id=?1 AND target_schema_version=?2
             ORDER BY created_at DESC
             LIMIT 1`,
      params: [fixture.tenantId, CURRENT_SCHEMA_VERSION]
    }
  ]);
  return result[0]?.results?.[0] || null;
}

export function retainedMigrationFailureEvidence(kind, job) {
  const safeCode = String(job?.last_error_code || '');
  return {
    kind,
    status: String(job?.status || 'unknown').slice(0, 24),
    attemptCount: Number(job?.attempt_count || 0),
    safeErrorCode: /^[a-z0-9_]{1,120}$/i.test(safeCode)
      ? safeCode
      : 'fleet_canary_migration_error_invalid'
  };
}

async function waitForSchedulerOwnedOutcomes(fixtures) {
  const successFixture = fixtures.find((fixture) => fixture.kind === 'success');
  const failureFixture = fixtures.find((fixture) => fixture.kind === 'failure');
  const blockedFixture = fixtures.find((fixture) => fixture.kind === 'blocked');
  const started = Date.now();

  while (Date.now() - started < COMPLETION_TIMEOUT_MS) {
    const [successJob, failureJob, blockedJob] = await Promise.all([
      migrationJob(successFixture),
      migrationJob(failureFixture),
      migrationJob(blockedFixture)
    ]);

    if (blockedJob) throw new Error('fleet_canary_active_import_was_not_excluded');
    if (successJob?.status === 'failed') {
      throw new FleetCanaryError(
        'fleet_canary_upgrade_failed',
        retainedMigrationFailureEvidence('success', successJob)
      );
    }
    if (failureJob?.status === 'success') throw new Error('fleet_canary_expected_failure_missing');
    if (
      failureJob?.status === 'failed' &&
      String(failureJob.last_error_code || '') !== EXPECTED_FAILURE_CODE
    ) {
      throw new FleetCanaryError(
        'fleet_canary_failure_code_unexpected',
        retainedMigrationFailureEvidence('failure', failureJob)
      );
    }

    if (successJob?.status === 'success' && failureJob?.status === 'failed') {
      return { successJob, failureJob };
    }
    await sleep(POLL_MS);
  }
  throw new Error('fleet_canary_scheduler_timeout');
}

async function controlState(fixture) {
  const result = await controlBatch([
    {
      sql: `SELECT i.status AS catalog_status, i.schema_version, i.last_migration_at,
                   i.last_error,
                   p.setup_status, d.worker_status, d.database_status, d.worker_version,
                   d.migration_command_version, d.migration_command_last_error_code
              FROM tenant_catalog_instances i
              JOIN tenant_store_profiles p ON p.tenant_id=i.tenant_id
              JOIN tenant_data_plane_provider_state d ON d.tenant_id=i.tenant_id
             WHERE i.tenant_id=?1
             LIMIT 1`,
      params: [fixture.tenantId]
    },
    {
      sql: `SELECT status, current_step, context_json, started_at, finished_at,
                   last_error, created_at, updated_at
              FROM tenant_provisioning_runs
             WHERE provisioning_id=?1 AND tenant_id=?2
             LIMIT 1`,
      params: [fixture.provisioningId, fixture.tenantId]
    },
    {
      sql: `SELECT status, attempt_count, started_at, finished_at, last_error,
                   metadata_json, updated_at
              FROM tenant_provisioning_steps
             WHERE provisioning_id=?1 AND step_key='migrations'
             LIMIT 1`,
      params: [fixture.provisioningId]
    },
    {
      sql: `SELECT mode, status, phase, attempt_count
              FROM tenant_import_jobs
             WHERE tenant_id=?1 AND source_key=?2
             ORDER BY created_at DESC`,
      params: [fixture.tenantId, fixture.sourceKey]
    }
  ]);
  return {
    catalog: result[0]?.results?.[0] || null,
    provisioning: result[1]?.results?.[0] || null,
    migrationStep: result[2]?.results?.[0] || null,
    imports: result[3]?.results || []
  };
}

async function dataPlaneState(fixture) {
  const listingStagePlaceholders = LISTING_STAGE_TABLES.map(() => '?').join(',');
  const candidateStagePlaceholders = TENANT_SYNC_CANDIDATE_TABLES.map(() => '?').join(',');
  const result = await tenantBatch(fixture, [
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
             WHERE type='table' AND name IN (${listingStagePlaceholders})`,
      params: LISTING_STAGE_TABLES
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM sqlite_master
             WHERE type='table' AND name IN (${candidateStagePlaceholders})`,
      params: TENANT_SYNC_CANDIDATE_TABLES
    },
    {
      sql: `SELECT r.state, r.safety_outcome, r.verification_code,
                   COUNT(c.category_source_id) AS categories
              FROM supplier_sync_stage_runs r
              LEFT JOIN supplier_sync_stage_categories c ON c.run_id=r.run_id
             WHERE r.run_id=?1
             GROUP BY r.run_id`,
      params: [fixture.stageRunId]
    },
    {
      sql: `SELECT p.name, p.description, p.classification_status,
                   a.listing_fingerprint, a.detail_fingerprint, a.status, a.miss_count,
                   o.override_json, o.override_version
              FROM catalog_products p
              JOIN supplier_album_index a
                ON a.public_product_id=p.product_id
               AND a.tenant_id=?1 AND a.source_key=?2 AND a.album_source_id=?3
              JOIN catalog_product_classification_overrides o ON o.product_id=p.product_id
             WHERE p.product_id=?4
             LIMIT 1`,
      params: [fixture.tenantId, fixture.sourceKey, fixture.albumSourceId, fixture.productId]
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM sqlite_master
             WHERE type='table'
               AND name IN ('catalog_serving_authority','supplier_sync_stage_authority')`,
      params: []
    },
    { sql: 'PRAGMA foreign_key_check', params: [] }
  ]);
  const candidateStageTableCount = Number(result[3]?.results?.[0]?.total || 0);
  let candidateRowCount = 0;
  if (candidateStageTableCount === TENANT_SYNC_CANDIDATE_TABLES.length) {
    const candidateRows = await tenantBatch(
      fixture,
      TENANT_SYNC_CANDIDATE_TABLES.map((table) => ({
        sql: `SELECT COUNT(*) AS total FROM ${table}`,
        params: []
      }))
    );
    candidateRowCount = candidateRows.reduce(
      (total, entry) => total + Number(entry?.results?.[0]?.total || 0),
      0
    );
  }
  const authorityTableCount = Number(result[6]?.results?.[0]?.total || 0);
  let servingAuthority = null;
  let stageAuthorityRows = 0;
  if (authorityTableCount === 2) {
    const authority = await tenantBatch(fixture, [
      {
        sql: `SELECT tenant_id, contract_version, revision
                FROM catalog_serving_authority
               WHERE tenant_id=?1
               LIMIT 1`,
        params: [fixture.tenantId]
      },
      {
        sql: 'SELECT COUNT(*) AS total FROM supplier_sync_stage_authority WHERE run_id=?1',
        params: [fixture.stageRunId]
      }
    ]);
    servingAuthority = authority[0]?.results?.[0] || null;
    stageAuthorityRows = Number(authority[1]?.results?.[0]?.total || 0);
  }
  return {
    identity: result[0]?.results?.[0] || null,
    ledger: String(result[1]?.results?.[0]?.versions || ''),
    listingStageTableCount: Number(result[2]?.results?.[0]?.total || 0),
    candidateStageTableCount,
    candidateRowCount,
    historicalStage: result[4]?.results?.[0] || null,
    lkg: result[5]?.results?.[0] || null,
    authorityTableCount,
    servingAuthority,
    stageAuthorityRows,
    foreignKeyFindings: (result[7]?.results || []).length
  };
}

function assertHistoricalOnboardingPreserved(state) {
  const run = state.provisioning;
  const step = state.migrationStep;
  if (
    !run ||
    run.status !== 'success' ||
    run.current_step !== 'complete' ||
    run.context_json !== HISTORICAL_CONTEXT ||
    run.started_at !== HISTORICAL_TIMESTAMP ||
    run.finished_at !== HISTORICAL_TIMESTAMP ||
    run.created_at !== HISTORICAL_TIMESTAMP ||
    run.updated_at !== HISTORICAL_TIMESTAMP ||
    run.last_error !== null
  ) {
    throw new Error('fleet_canary_historical_onboarding_changed');
  }
  if (
    !step ||
    step.status !== 'success' ||
    Number(step.attempt_count) !== 1 ||
    step.started_at !== HISTORICAL_TIMESTAMP ||
    step.finished_at !== HISTORICAL_TIMESTAMP ||
    step.updated_at !== HISTORICAL_TIMESTAMP ||
    step.last_error !== null ||
    step.metadata_json !== HISTORICAL_MIGRATION_METADATA
  ) {
    throw new Error('fleet_canary_historical_migration_step_changed');
  }
}

function assertLkgPreserved(fixture, state, expectedSchemaVersion) {
  const expectedLedger =
    expectedSchemaVersion === CURRENT_SCHEMA_VERSION ? '1,2,3,4,5,6,7' : '1,2,3,4,5,6';
  const expectedCandidateStageTables = TENANT_SYNC_CANDIDATE_TABLES.length;
  const expectedAuthorityTableCount = expectedSchemaVersion === CURRENT_SCHEMA_VERSION ? 2 : 0;
  if (
    state.identity?.tenant_id !== fixture.tenantId ||
    Number(state.identity?.schema_version) !== expectedSchemaVersion ||
    state.ledger !== expectedLedger ||
    state.listingStageTableCount !== LISTING_STAGE_TABLES.length ||
    state.candidateStageTableCount !== expectedCandidateStageTables ||
    state.candidateRowCount !== 1 ||
    state.authorityTableCount !== expectedAuthorityTableCount ||
    state.foreignKeyFindings !== 0
  ) {
    throw new Error('fleet_canary_data_plane_schema_invalid');
  }
  if (expectedSchemaVersion === CURRENT_SCHEMA_VERSION) {
    if (
      state.servingAuthority?.tenant_id !== fixture.tenantId ||
      Number(state.servingAuthority?.contract_version) !== 1 ||
      Number(state.servingAuthority?.revision) !== 0 ||
      state.stageAuthorityRows !== 0
    ) {
      throw new Error('fleet_canary_authority_model_invalid');
    }
  } else if (state.servingAuthority !== null || state.stageAuthorityRows !== 0) {
    throw new Error('fleet_canary_authority_model_leaked_backward');
  }
  if (
    state.historicalStage?.state !== 'preserved' ||
    state.historicalStage?.safety_outcome !== 'preserve_last_known_good' ||
    state.historicalStage?.verification_code !== 'historical_preserved' ||
    Number(state.historicalStage?.categories) !== 1
  ) {
    throw new Error('fleet_canary_historical_stage_changed');
  }
  if (
    !state.lkg ||
    state.lkg.name !== 'Verified LKG Product' ||
    state.lkg.description !== 'Verified tenant LKG' ||
    state.lkg.classification_status !== 'known' ||
    state.lkg.listing_fingerprint !== fixture.listingFingerprint ||
    state.lkg.detail_fingerprint !== 'detail-lkg-v1' ||
    state.lkg.status !== 'active' ||
    Number(state.lkg.miss_count) !== 0 ||
    state.lkg.override_json !== fixture.overrideJson ||
    Number(state.lkg.override_version) !== 1
  ) {
    throw new Error('fleet_canary_last_known_good_changed');
  }
}

async function verifyFixture(fixture) {
  const [control, dataPlane, job] = await Promise.all([
    controlState(fixture),
    dataPlaneState(fixture),
    migrationJob(fixture)
  ]);
  assertHistoricalOnboardingPreserved(control);

  if (
    control.catalog?.catalog_status !== 'ready' ||
    control.catalog?.setup_status !== 'published' ||
    control.catalog?.worker_status !== 'active' ||
    control.catalog?.database_status !== 'active' ||
    control.catalog?.migration_command_last_error_code !== null
  ) {
    throw new Error('fleet_canary_serving_state_changed');
  }

  if (fixture.kind === 'success') {
    if (
      !job ||
      job.migration_kind !== 'maintenance' ||
      job.status !== 'success' ||
      Number(job.target_schema_version) !== CURRENT_SCHEMA_VERSION ||
      Number(job.attempt_count) < 1 ||
      job.last_error_code !== null ||
      Number(control.catalog.schema_version) !== CURRENT_SCHEMA_VERSION ||
      control.catalog.last_migration_at === HISTORICAL_TIMESTAMP ||
      control.catalog.last_error !== null ||
      Number(control.catalog.migration_command_version) !==
        TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION ||
      !fixture.initialWorkerVersion ||
      control.catalog.worker_version === fixture.initialWorkerVersion ||
      control.imports.length !== 0
    ) {
      throw new Error('fleet_canary_success_state_invalid');
    }
    assertLkgPreserved(fixture, dataPlane, CURRENT_SCHEMA_VERSION);
  } else if (fixture.kind === 'failure') {
    if (
      !job ||
      job.migration_kind !== 'maintenance' ||
      job.status !== 'failed' ||
      Number(job.target_schema_version) !== CURRENT_SCHEMA_VERSION ||
      Number(job.attempt_count) < 1 ||
      job.last_error_code !== EXPECTED_FAILURE_CODE ||
      Number(control.catalog.schema_version) !== PREVIOUS_SCHEMA_VERSION ||
      control.catalog.last_migration_at !== HISTORICAL_TIMESTAMP ||
      control.catalog.last_error !== EXPECTED_FAILURE_CODE ||
      Number(control.catalog.migration_command_version) !==
        TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION ||
      control.catalog.worker_version !== fixture.initialWorkerVersion ||
      control.imports.length !== 0
    ) {
      throw new Error('fleet_canary_failure_state_invalid');
    }
    assertLkgPreserved(fixture, dataPlane, PREVIOUS_SCHEMA_VERSION);
  } else {
    const activeImport = control.imports[0];
    if (
      job !== null ||
      Number(control.catalog.schema_version) !== PREVIOUS_SCHEMA_VERSION ||
      control.catalog.last_migration_at !== HISTORICAL_TIMESTAMP ||
      control.catalog.last_error !== null ||
      Number(control.catalog.migration_command_version) !== 0 ||
      control.catalog.worker_version !== fixture.initialWorkerVersion ||
      control.imports.length !== 1 ||
      activeImport.mode !== 'incremental' ||
      activeImport.status !== 'scanning' ||
      activeImport.phase !== 'scan' ||
      Number(activeImport.attempt_count) !== 1
    ) {
      throw new Error('fleet_canary_active_import_boundary_invalid');
    }
    assertLkgPreserved(fixture, dataPlane, PREVIOUS_SCHEMA_VERSION);
  }

  return {
    kind: fixture.kind,
    catalogStatus: control.catalog.catalog_status,
    schemaVersion: Number(control.catalog.schema_version),
    migrationStatus: job?.status || 'not_created',
    migrationKind: job?.migration_kind || null,
    migrationAttempts: Number(job?.attempt_count || 0),
    safeErrorCode: job?.last_error_code || null,
    lkgPreserved: true,
    merchantOverridePreserved: true,
    historicalOnboardingPreserved: true,
    runtimeCapabilityRefreshed: fixture.kind === 'success',
    listingStageTableCount: dataPlane.listingStageTableCount,
    candidateStageTableCount: dataPlane.candidateStageTableCount,
    candidateRowsPreserved: dataPlane.candidateRowCount,
    authorityTableCount: dataPlane.authorityTableCount,
    authorityRevision: dataPlane.servingAuthority?.revision ?? null,
    historicalRunAuthorityBackfilled: dataPlane.stageAuthorityRows > 0,
    foreignKeyFindings: dataPlane.foreignKeyFindings
  };
}

async function deleteWorker(scriptName) {
  await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/workers/dispatch/namespaces/${encodeURIComponent(DISPATCH_NAMESPACE)}/scripts/${encodeURIComponent(scriptName)}`,
    { method: 'DELETE', allowNotFound: true }
  );
}

async function deleteDatabase(databaseId) {
  if (!databaseId) return;
  await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${encodeURIComponent(databaseId)}`,
    { method: 'DELETE', allowNotFound: true }
  );
}

async function cleanupFixtures(fixtures) {
  const externalFailures = [];
  for (const fixture of fixtures) {
    if (fixture.workerCreated) {
      await deleteWorker(fixture.workerScriptName).catch(() => externalFailures.push('worker'));
    }
    if (fixture.databaseId) {
      await deleteDatabase(fixture.databaseId).catch(() => externalFailures.push('database'));
    }
  }
  if (externalFailures.length) throw new Error('fleet_canary_cleanup_failed');

  const controlDeletes = fixtures
    .filter((fixture) => fixture.controlCreated)
    .map((fixture) => ({
      sql: 'DELETE FROM catalog_tenants WHERE tenant_id=?1',
      params: [fixture.tenantId]
    }));
  if (controlDeletes.length) await controlBatch(controlDeletes);
}

function safeErrorCode(error) {
  const message = String(error?.message || '');
  return /^fleet_canary_[a-z0-9_]+$/i.test(message) ? message : 'fleet_canary_failed';
}

function retainedFixtureEvidence(fixtures) {
  return fixtures.map((fixture) => ({
    kind: fixture.kind,
    tenantId: fixture.tenantId,
    workerScriptName: fixture.workerScriptName,
    databaseName: fixture.databaseName,
    controlCreated: fixture.controlCreated,
    workerCreated: fixture.workerCreated,
    databaseCreated: Boolean(fixture.databaseId)
  }));
}

async function main() {
  const fixtures = [];
  try {
    validateRuntime();
    const baselineCatalogProducts = await defaultCatalogCount();
    await assertControlSchemaReady();
    for (const kind of ['success', 'failure', 'blocked']) {
      const fixture = fixtureIdentity(kind);
      fixtures.push(fixture);

      const database = await createD1Database({
        ...platformConfig(),
        databaseName: fixture.databaseName
      });
      fixture.databaseId = database.databaseId;
      await tenantBatch(
        fixture,
        tenantDataPlaneV6Batch({
          tenantId: fixture.tenantId,
          source: {
            provider: 'yupoo',
            sourceKey: fixture.sourceKey,
            sourceUrl: fixture.sourceUrl,
            syncStrategy: 'incremental',
            removalMissThreshold: 3
          }
        })
      );
      await tenantBatch(fixture, initialDataPlaneSeed(fixture));
      const worker = await uploadTenantCatalogWorker(
        {
          ...platformConfig(),
          scriptName: fixture.workerScriptName,
          databaseId: fixture.databaseId,
          tenantId: fixture.tenantId
        },
        { includeSchemaMigration: fixture.kind === 'failure' }
      );
      fixture.workerCreated = true;
      fixture.initialWorkerVersion = worker.versionId;
      await controlBatch(controlPlaneSeed(fixture, worker.versionId));
      fixture.controlCreated = true;
    }

    const successFixture = fixtures.find((fixture) => fixture.kind === 'success');
    const preparation = await prepareTenantMigrationCommandCapability(successFixture, {
      platform: platformConfig(),
      controlBatch,
      allowFleetCanary: true
    });
    if (preparation.outcome !== 'prepared') {
      throw new Error('fleet_canary_trusted_preparation_failed');
    }

    await waitForSchedulerOwnedOutcomes(fixtures);
    const evidence = [];
    for (const fixture of fixtures) evidence.push(await verifyFixture(fixture));

    const finalCatalogProducts = await defaultCatalogCount();
    if (finalCatalogProducts !== baselineCatalogProducts) {
      throw new Error('fleet_canary_default_catalog_changed');
    }

    await cleanupFixtures(fixtures);
    console.log(
      JSON.stringify(
        {
          tenantDataPlaneFleetCanaryPassed: true,
          schedulerOwnedMaintenance: true,
          trustedCiOwnedWorkerPreparation: true,
          manualQueueMessagesProduced: false,
          recurringSyncAutomationEnabled: false,
          previousSchemaVersion: PREVIOUS_SCHEMA_VERSION,
          currentSchemaVersion: CURRENT_SCHEMA_VERSION,
          defaultCatalogCountUnchanged: true,
          unrelatedTenantIsolationVerified: true,
          fixtures: evidence,
          cleanupComplete: true
        },
        null,
        2
      )
    );
  } catch (error) {
    const code = safeErrorCode(error);
    console.error(
      JSON.stringify({
        tenantDataPlaneFleetCanaryPassed: false,
        error: code,
        ...(error instanceof FleetCanaryError && error.migrationFailureEvidence
          ? { migrationFailureEvidence: error.migrationFailureEvidence }
          : {}),
        fleetCanaryFixturesRetained: true,
        fixtures: retainedFixtureEvidence(fixtures)
      })
    );
    throw new Error(code);
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) await main();
