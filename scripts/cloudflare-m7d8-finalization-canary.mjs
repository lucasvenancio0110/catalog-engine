import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createD1Database, queryD1Batch } from '../worker/cloudflare-platform.js';
import { runDueTenantIncrementalFinalizations } from '../worker/ingestion/incremental-finalization-runner.js';
import { processTenantIncrementalPromotion } from '../worker/ingestion/incremental-promotion.js';
import { incrementalTenantImportId } from '../worker/tenant-import-queue.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  tenantDataPlaneCurrentBatch
} from '../worker/tenant-data-plane-schema-v7.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const SOURCE_KEY = 'm7d8-canary';
const PRODUCT_ID = 'p_m7d8canary000000001';
const ALBUM_ID = 'alb_m7d8_canary';

if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('m7d8_canary_account_unconfigured');
if (API_TOKEN.length < 20) throw new Error('m7d8_canary_token_unconfigured');
if (TENANT_DATA_PLANE_SCHEMA_VERSION !== 7) throw new Error('m7d8_canary_schema_contract_changed');

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const PRODUCTION_CONTROL_DB_ID = String(
  wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
).trim();
if (!/^[a-f0-9-]{32,40}$/i.test(PRODUCTION_CONTROL_DB_ID)) {
  throw new Error('m7d8_canary_control_database_invalid');
}
if (String(wrangler.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') !== '0') {
  throw new Error('m7d8_canary_recurring_sync_must_remain_off');
}
if (String(wrangler.vars?.TENANT_SYNC_ACTIVE_COHORT || '') !== '') {
  throw new Error('m7d8_canary_active_cohort_must_remain_empty');
}
if (String(wrangler.vars?.TENANT_SYNC_MAX_JOBS_PER_TICK || '') !== '1') {
  throw new Error('m7d8_canary_sync_cap_must_remain_one');
}

function platformConfig() {
  return {
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    dispatchNamespace: DISPATCH_NAMESPACE
  };
}

async function cloudflareRequest(path, { method = 'GET', allowNotFound = false } = {}) {
  const response = await fetch(new URL(path, API_ORIGIN), {
    method,
    redirect: 'error',
    headers: { authorization: `Bearer ${API_TOKEN}`, accept: 'application/json' }
  });
  if (allowNotFound && response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const providerCode = Number(payload?.errors?.[0]?.code);
    const code = Number.isFinite(providerCode) ? String(providerCode) : String(response.status || 'unknown');
    throw new Error(`m7d8_canary_cloudflare_${code}`);
  }
  return payload.result ?? null;
}

async function d1Batch(databaseId, batch) {
  return queryD1Batch({ ...platformConfig(), databaseId, batch });
}

class RestStatement {
  constructor(databaseId, sql, params = []) {
    this.databaseId = databaseId;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new RestStatement(this.databaseId, this.sql, params);
  }

  async all() {
    const result = await d1Batch(this.databaseId, [{ sql: this.sql, params: this.params }]);
    return { results: result[0]?.results || [] };
  }

  async first() {
    const result = await this.all();
    return result.results[0] || null;
  }

  async run() {
    const result = await d1Batch(this.databaseId, [{ sql: this.sql, params: this.params }]);
    return result[0] || { success: false, meta: { changes: 0 } };
  }
}

class RestD1Adapter {
  constructor(databaseId) {
    this.databaseId = databaseId;
  }

  prepare(sql) {
    return new RestStatement(this.databaseId, sql);
  }

  async batch(statements) {
    return d1Batch(
      this.databaseId,
      statements.map((statement) => ({ sql: statement.sql, params: statement.params || [] }))
    );
  }
}

function fixtureIdentity() {
  const seed = `${process.env.GITHUB_RUN_ID || Date.now()}:${process.env.GITHUB_RUN_ATTEMPT || '1'}`;
  const suffix = createHash('sha256').update(`m7d8:${seed}`).digest('hex').slice(0, 20);
  return {
    tenantId: `t_${suffix}`,
    controlDatabaseName: `cem7d8-control-${suffix}`,
    tenantDatabaseName: `cem7d8-tenant-${suffix}`,
    sourceUrl: `https://m7d8-${suffix}.x.yupoo.com/albums/`
  };
}

function sqlTimestamp(minutesAgo) {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

async function createEphemeralDatabase(name) {
  const result = await createD1Database({ ...platformConfig(), databaseName: name });
  if (!result?.databaseId) throw new Error('m7d8_canary_database_create_failed');
  return result.databaseId;
}

async function deleteDatabase(databaseId) {
  await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${encodeURIComponent(databaseId)}`,
    { method: 'DELETE', allowNotFound: true }
  );
}

async function initializeControlDatabase(databaseId) {
  await d1Batch(databaseId, [
    {
      sql: `CREATE TABLE supplier_sources (
              tenant_id TEXT NOT NULL, source_key TEXT NOT NULL, provider TEXT NOT NULL,
              source_url TEXT NOT NULL, status TEXT NOT NULL, sync_strategy TEXT NOT NULL,
              removal_miss_threshold INTEGER NOT NULL DEFAULT 3,
              PRIMARY KEY (tenant_id, source_key)
            )`,
      params: []
    },
    {
      sql: `CREATE TABLE tenant_catalog_instances (
              tenant_id TEXT PRIMARY KEY, status TEXT NOT NULL, schema_version INTEGER NOT NULL
            )`,
      params: []
    },
    {
      sql: `CREATE TABLE tenant_data_plane_provider_state (
              tenant_id TEXT PRIMARY KEY, d1_database_id TEXT, database_status TEXT NOT NULL,
              worker_status TEXT NOT NULL, dispatch_namespace TEXT NOT NULL
            )`,
      params: []
    },
    {
      sql: `CREATE TABLE tenant_provisioning_runs (
              provisioning_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, current_step TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`,
      params: []
    },
    {
      sql: `CREATE TABLE tenant_import_jobs (
              import_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, source_key TEXT NOT NULL,
              mode TEXT NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL,
              attempt_count INTEGER NOT NULL DEFAULT 0,
              detail_enqueue_cursor INTEGER NOT NULL DEFAULT 0,
              discovered_count INTEGER NOT NULL DEFAULT 0,
              next_attempt_at TEXT, finished_at TEXT, last_error_code TEXT,
              sync_scheduled_for TEXT, finalize_lease_until TEXT,
              state_revision INTEGER NOT NULL DEFAULT 0,
              recovery_attempt_count INTEGER NOT NULL DEFAULT 0,
              last_failure_phase TEXT,
              phase_lease_kind TEXT, phase_lease_token TEXT, phase_lease_until TEXT,
              last_recovery_at TEXT, last_delivery_at TEXT, candidate_classified_at TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`,
      params: []
    },
    {
      sql: `CREATE TABLE tenant_sync_schedules (
              tenant_id TEXT NOT NULL, source_key TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'active',
              incremental_interval_minutes INTEGER NOT NULL DEFAULT 15,
              next_sync_at TEXT NOT NULL, last_scheduled_at TEXT, last_import_id TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (tenant_id, source_key)
            )`,
      params: []
    }
  ]);
}

async function seedControlIdentity(fixture) {
  await d1Batch(fixture.controlDatabaseId, [
    {
      sql: `INSERT INTO supplier_sources
              (tenant_id,source_key,provider,source_url,status,sync_strategy,removal_miss_threshold)
            VALUES (?1,?2,'yupoo',?3,'active','incremental',3)`,
      params: [fixture.tenantId, SOURCE_KEY, fixture.sourceUrl]
    },
    {
      sql: `INSERT INTO tenant_catalog_instances(tenant_id,status,schema_version)
            VALUES (?1,'ready',7)`,
      params: [fixture.tenantId]
    },
    {
      sql: `INSERT INTO tenant_data_plane_provider_state
              (tenant_id,d1_database_id,database_status,worker_status,dispatch_namespace)
            VALUES (?1,?2,'active','active',?3)`,
      params: [fixture.tenantId, fixture.tenantDatabaseId, DISPATCH_NAMESPACE]
    }
  ]);
}

async function initializeTenantDatabase(fixture) {
  await d1Batch(
    fixture.tenantDatabaseId,
    tenantDataPlaneCurrentBatch({
      tenantId: fixture.tenantId,
      source: {
        provider: 'yupoo',
        sourceKey: SOURCE_KEY,
        sourceUrl: fixture.sourceUrl,
        syncStrategy: 'incremental',
        removalMissThreshold: 3
      }
    })
  );
  await d1Batch(fixture.tenantDatabaseId, [
    {
      sql: `INSERT INTO catalog_products
              (product_id,name,search_text,category_id,category_name,description,
               source_name,display_name,source_category_name,display_category_name,
               classification_status,classification_confidence)
            VALUES (?1,'M7D8 LKG','m7d8 lkg','legacy','Legacy','healthy',
                    'LKG','M7D8 LKG','Legacy','Legacy','automatic',0.99)`,
      params: [PRODUCT_ID]
    },
    {
      sql: `INSERT INTO supplier_album_index
              (tenant_id,source_key,album_source_id,public_product_id,source_url,source_title,
               source_category_id,source_category_path_json,listing_fingerprint,detail_fingerprint,
               status,miss_count,first_seen_at,last_seen_at,last_changed_at,updated_at)
            VALUES (?1,?2,?3,?4,?5,'M7D8 LKG Album','old','["old"]','listing-old',
                    'detail-old','active',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      params: [
        fixture.tenantId,
        SOURCE_KEY,
        ALBUM_ID,
        PRODUCT_ID,
        `${fixture.sourceUrl}${ALBUM_ID}`
      ]
    }
  ]);
}

async function seedVerifiedMovedRun(fixture, { importId, baseRevision, categoryId }) {
  await d1Batch(fixture.tenantDatabaseId, [
    {
      sql: `INSERT INTO supplier_sync_runs
              (run_id,tenant_id,source_key,mode,status,complete_scan,scanned_albums,
               changed_count,moved_count,restored_count,detail_fetch_count)
            VALUES (?1,?2,?3,'incremental','running',1,1,0,1,0,0)`,
      params: [importId, fixture.tenantId, SOURCE_KEY]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_runs
              (run_id,tenant_id,source_key,scope_id,scope_kind,contract_version,state,safety_outcome,
               safety_policy_version,scan_complete,previous_known_good_count,observed_count,
               disqualifying_failure_count,expected_event_count,expected_detail_count,
               staged_observation_count,staged_event_count,staged_category_count,
               verification_code,verified_at)
            VALUES (?1,?2,?3,'catalog','catalog',1,'verified','proceed',1,1,1,1,0,1,0,1,1,1,
                    'sync_candidate_verified_v1',CURRENT_TIMESTAMP)`,
      params: [importId, fixture.tenantId, SOURCE_KEY]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_authority
              (run_id,tenant_id,source_key,contract_version,base_authority_revision)
            VALUES (?1,?2,?3,1,?4)`,
      params: [importId, fixture.tenantId, SOURCE_KEY, baseRevision]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_observations
              (run_id,album_source_id,public_product_id,source_url,source_title,source_category_id,
               source_category_path_json,image_count_hint,listing_fingerprint,sort_order)
            VALUES (?1,?2,?3,?4,'M7D8 Moved Album',?5,?6,0,?7,0)`,
      params: [
        importId,
        ALBUM_ID,
        PRODUCT_ID,
        `${fixture.sourceUrl}${ALBUM_ID}`,
        categoryId,
        JSON.stringify([categoryId]),
        `listing-${categoryId}`
      ]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_events
              (run_id,album_source_id,public_product_id,event_type,needs_detail,reason_code)
            VALUES (?1,?2,?3,'MOVED',0,'sync_listing_moved')`,
      params: [importId, ALBUM_ID, PRODUCT_ID]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_categories
              (run_id,category_source_id,name,depth,sort_order)
            VALUES (?1,?2,'M7D8 Source Category',0,0)`,
      params: [importId, categoryId]
    }
  ]);
}

async function seedControlRun(fixture, { importId, scheduledFor, resetSchedule = false }) {
  const batch = [];
  if (resetSchedule) {
    batch.push({
      sql: `UPDATE tenant_sync_schedules
               SET next_sync_at=?3, updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?1 AND source_key=?2`,
      params: [fixture.tenantId, SOURCE_KEY, scheduledFor]
    });
  } else {
    batch.push({
      sql: `INSERT INTO tenant_sync_schedules
              (tenant_id,source_key,status,incremental_interval_minutes,next_sync_at)
            VALUES (?1,?2,'active',15,?3)`,
      params: [fixture.tenantId, SOURCE_KEY, scheduledFor]
    });
  }
  batch.push({
    sql: `INSERT INTO tenant_import_jobs
            (import_id,tenant_id,source_key,mode,status,phase,sync_scheduled_for)
          VALUES (?1,?2,?3,'incremental','finalizing','finalize',?4)`,
    params: [importId, fixture.tenantId, SOURCE_KEY, scheduledFor]
  });
  await d1Batch(fixture.controlDatabaseId, batch);
}

async function controlState(fixture, importId) {
  const result = await d1Batch(fixture.controlDatabaseId, [
    {
      sql: `SELECT j.status,j.phase,j.sync_scheduled_for,j.finalize_lease_until,j.last_error_code,
                   schedule.next_sync_at,schedule.last_scheduled_at,schedule.last_import_id
              FROM tenant_import_jobs j
              JOIN tenant_sync_schedules schedule
                ON schedule.tenant_id=j.tenant_id AND schedule.source_key=j.source_key
             WHERE j.import_id=?1 AND j.tenant_id=?2 AND j.source_key=?3 LIMIT 1`,
      params: [importId, fixture.tenantId, SOURCE_KEY]
    }
  ]);
  return result[0]?.results?.[0] || null;
}

async function authorityState(fixture) {
  const result = await d1Batch(fixture.tenantDatabaseId, [
    {
      sql: `SELECT revision,last_promoted_run_id,last_promoted_source_key
              FROM catalog_serving_authority WHERE tenant_id=?1 LIMIT 1`,
      params: [fixture.tenantId]
    }
  ]);
  return result[0]?.results?.[0] || null;
}

function promotionContext(fixture, importId) {
  return {
    importId,
    tenantId: fixture.tenantId,
    sourceKey: SOURCE_KEY,
    mode: 'incremental',
    schemaVersion: 7,
    dataPlane: {
      databaseId: fixture.tenantDatabaseId,
      dispatchNamespace: DISPATCH_NAMESPACE
    }
  };
}

async function productionMigrationProof() {
  const result = await d1Batch(PRODUCTION_CONTROL_DB_ID, [
    {
      sql: `SELECT name FROM pragma_table_info('tenant_import_jobs')
             WHERE name IN ('sync_scheduled_for','finalize_lease_until') ORDER BY name`,
      params: []
    }
  ]);
  return (result[0]?.results || []).map((row) => String(row.name || '')).sort();
}

const identity = fixtureIdentity();
const fixture = {
  ...identity,
  controlDatabaseId: null,
  tenantDatabaseId: null
};

try {
  fixture.controlDatabaseId = await createEphemeralDatabase(identity.controlDatabaseName);
  fixture.tenantDatabaseId = await createEphemeralDatabase(identity.tenantDatabaseName);
  await initializeControlDatabase(fixture.controlDatabaseId);
  await initializeTenantDatabase(fixture);
  await seedControlIdentity(fixture);

  const migrationColumns = await productionMigrationProof();
  if (migrationColumns.join(',') !== 'finalize_lease_until,sync_scheduled_for') {
    throw new Error('m7d8_canary_production_migration_missing');
  }

  const controlDb = new RestD1Adapter(fixture.controlDatabaseId);
  const runnerEnv = {
    CATALOG_DB: controlDb,
    CLOUDFLARE_PLATFORM_ACCOUNT_ID: ACCOUNT_ID,
    CLOUDFLARE_PLATFORM_API_TOKEN: API_TOKEN,
    CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: DISPATCH_NAMESPACE,
    TENANT_SYNC_AUTOMATION_ENABLED: '0'
  };

  const firstScheduledFor = sqlTimestamp(20);
  const firstImportId = await incrementalTenantImportId({
    tenantId: fixture.tenantId,
    sourceKey: SOURCE_KEY,
    scheduledFor: firstScheduledFor
  });
  await seedVerifiedMovedRun(fixture, {
    importId: firstImportId,
    baseRevision: 0,
    categoryId: 'moved-a'
  });
  await seedControlRun(fixture, {
    importId: firstImportId,
    scheduledFor: firstScheduledFor
  });

  const firstBefore = await controlState(fixture, firstImportId);
  if (
    firstBefore?.status !== 'finalizing' ||
    firstBefore?.phase !== 'finalize' ||
    firstBefore?.next_sync_at !== firstScheduledFor ||
    firstBefore?.last_import_id != null
  ) {
    throw new Error('m7d8_canary_first_precondition_invalid');
  }

  const firstResult = await runDueTenantIncrementalFinalizations(runnerEnv, { limit: 1 });
  const firstAfter = await controlState(fixture, firstImportId);
  const firstAuthority = await authorityState(fixture);
  if (
    firstResult.succeeded !== 1 ||
    firstResult.promoted !== 1 ||
    firstResult.resumedAfterPromotion !== 0 ||
    firstAfter?.status !== 'success' ||
    firstAfter?.phase !== 'complete' ||
    firstAfter?.last_import_id !== firstImportId ||
    !(String(firstAfter?.next_sync_at || '') > firstScheduledFor) ||
    Number(firstAuthority?.revision || -1) !== 1 ||
    firstAuthority?.last_promoted_run_id !== firstImportId
  ) {
    throw new Error('m7d8_canary_fresh_finalization_failed');
  }

  const secondScheduledFor = sqlTimestamp(10);
  const secondImportId = await incrementalTenantImportId({
    tenantId: fixture.tenantId,
    sourceKey: SOURCE_KEY,
    scheduledFor: secondScheduledFor
  });
  await seedVerifiedMovedRun(fixture, {
    importId: secondImportId,
    baseRevision: 1,
    categoryId: 'moved-b'
  });
  await seedControlRun(fixture, {
    importId: secondImportId,
    scheduledFor: secondScheduledFor,
    resetSchedule: true
  });

  const manualPromotion = await processTenantIncrementalPromotion(
    runnerEnv,
    promotionContext(fixture, secondImportId)
  );
  if (
    manualPromotion.outcome !== 'success' ||
    manualPromotion.alreadyComplete !== false ||
    Number(manualPromotion.authorityRevision || -1) !== 2
  ) {
    throw new Error('m7d8_canary_crash_gap_promotion_failed');
  }

  const crashGapControl = await controlState(fixture, secondImportId);
  const crashGapAuthority = await authorityState(fixture);
  if (
    crashGapControl?.status !== 'finalizing' ||
    crashGapControl?.phase !== 'finalize' ||
    crashGapControl?.next_sync_at !== secondScheduledFor ||
    crashGapControl?.last_import_id !== firstImportId ||
    Number(crashGapAuthority?.revision || -1) !== 2 ||
    crashGapAuthority?.last_promoted_run_id !== secondImportId
  ) {
    throw new Error('m7d8_canary_crash_gap_ordering_invalid');
  }

  const replayResult = await runDueTenantIncrementalFinalizations(runnerEnv, { limit: 1 });
  const replayAfter = await controlState(fixture, secondImportId);
  const replayAuthority = await authorityState(fixture);
  if (
    replayResult.succeeded !== 1 ||
    replayResult.promoted !== 0 ||
    replayResult.resumedAfterPromotion !== 1 ||
    replayAfter?.status !== 'success' ||
    replayAfter?.phase !== 'complete' ||
    replayAfter?.last_import_id !== secondImportId ||
    !(String(replayAfter?.next_sync_at || '') > secondScheduledFor) ||
    Number(replayAuthority?.revision || -1) !== 2 ||
    replayAuthority?.last_promoted_run_id !== secondImportId
  ) {
    throw new Error('m7d8_canary_replay_finalization_failed');
  }

  const committedNextSync = replayAfter.next_sync_at;
  const duplicateResult = await runDueTenantIncrementalFinalizations(runnerEnv, { limit: 1 });
  const duplicateAfter = await controlState(fixture, secondImportId);
  const duplicateAuthority = await authorityState(fixture);
  if (
    duplicateResult.selected !== 0 ||
    duplicateAfter?.next_sync_at !== committedNextSync ||
    duplicateAfter?.last_import_id !== secondImportId ||
    Number(duplicateAuthority?.revision || -1) !== 2
  ) {
    throw new Error('m7d8_canary_duplicate_finalization_changed_authority');
  }

  const summary = {
    m7d8FinalizationCanaryPassed: true,
    productionControlMigrationColumns: migrationColumns,
    recurringSyncEnabled: false,
    activeCohortEmpty: true,
    manualQueueMessagesProduced: false,
    productionControlMutated: false,
    ephemeralControlPlane: true,
    freshPromotionFinalized: true,
    firstAuthorityRevision: Number(firstAuthority.revision),
    scheduleAdvancedOnlyAfterFreshPromotion: true,
    crashGapPromotedBeforeControlCommit: true,
    crashGapAuthorityRevision: Number(crashGapAuthority.revision),
    replayObservedAlreadyPromoted: true,
    authorityAdvancedAgainOnReplay: false,
    replayControlCommittedOnce: true,
    duplicateFinalizationNoop: true,
    finalAuthorityRevision: Number(duplicateAuthority.revision)
  };
  console.log(JSON.stringify(summary, null, 2));

  await deleteDatabase(fixture.tenantDatabaseId);
  await deleteDatabase(fixture.controlDatabaseId);
  fixture.tenantDatabaseId = null;
  fixture.controlDatabaseId = null;
} catch (error) {
  console.error(
    JSON.stringify({
      m7d8FinalizationCanaryPassed: false,
      retainedEvidence: true,
      retainedControlDatabaseName: fixture.controlDatabaseName,
      retainedControlDatabaseId: fixture.controlDatabaseId,
      retainedTenantDatabaseName: fixture.tenantDatabaseName,
      retainedTenantDatabaseId: fixture.tenantDatabaseId,
      error: /^[a-z0-9_]+$/i.test(String(error?.message || ''))
        ? String(error.message)
        : 'm7d8_canary_failed'
    })
  );
  throw error;
}
