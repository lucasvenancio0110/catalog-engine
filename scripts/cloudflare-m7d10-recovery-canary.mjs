import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createD1Database, queryD1Batch } from '../worker/cloudflare-platform.js';
import { runDueTenantIncrementalRecoveries } from '../worker/ingestion/incremental-recovery-runner.js';
import {
  claimTenantSyncPhaseLease,
  failTenantSyncPhaseLease,
  reclaimExpiredTenantSyncPhaseLeases,
  releaseTenantSyncPhaseLease
} from '../worker/tenant-sync-phase-lease.js';
import {
  createTenantSyncReplayRequest,
  readTenantSyncOperations,
  runDueTenantSyncReplays
} from '../worker/tenant-sync-replay.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  tenantDataPlaneCurrentBatch
} from '../worker/tenant-data-plane-schema-v8.js';
import { splitD1Batch } from './d1-batch-chunks.mjs';

const API_ORIGIN = 'https://api.cloudflare.com';
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const SOURCE_KEY = 'm7d10';
const QUEUE_NAMES = [
  'catalog-engine-import-scan',
  'catalog-engine-import-detail',
  'catalog-engine-import-scan-dlq',
  'catalog-engine-import-detail-dlq'
];

if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('m7d10_canary_account_unconfigured');
if (API_TOKEN.length < 20) throw new Error('m7d10_canary_token_unconfigured');
if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(DISPATCH_NAMESPACE)) {
  throw new Error('m7d10_canary_dispatch_invalid');
}
if (TENANT_DATA_PLANE_SCHEMA_VERSION !== 8) {
  throw new Error('m7d10_canary_schema_contract_changed');
}

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const PRODUCTION_CONTROL_DB_ID = String(
  wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
).trim();
if (!/^[a-f0-9-]{32,40}$/i.test(PRODUCTION_CONTROL_DB_ID)) {
  throw new Error('m7d10_canary_control_database_invalid');
}
if (String(wrangler.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') !== '0') {
  throw new Error('m7d10_canary_recurring_sync_must_remain_off');
}
if (String(wrangler.vars?.TENANT_SYNC_ACTIVE_COHORT || '') !== '') {
  throw new Error('m7d10_canary_active_cohort_must_remain_empty');
}
if (String(wrangler.vars?.TENANT_SYNC_MAX_JOBS_PER_TICK || '') !== '1') {
  throw new Error('m7d10_canary_sync_cap_must_remain_one');
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
  }).catch(() => null);
  if (!response) throw new Error('m7d10_canary_cloudflare_unreachable');
  if (allowNotFound && response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const providerCode = Number(payload?.errors?.[0]?.code);
    const code = Number.isFinite(providerCode)
      ? String(providerCode)
      : String(response.status || 'unknown');
    throw new Error(`m7d10_canary_cloudflare_${code}`);
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

function identity(kind, ordinal) {
  const seed = `${process.env.GITHUB_RUN_ID || Date.now()}:${process.env.GITHUB_RUN_ATTEMPT || '1'}:${kind}`;
  const suffix = createHash('sha256').update(`m7d10:${seed}`).digest('hex').slice(0, 20);
  const uuid = `${ordinal.repeat(8)}-${ordinal.repeat(4)}-${ordinal.repeat(4)}-${ordinal.repeat(4)}-${ordinal.repeat(12)}`;
  return {
    kind,
    tenantId: `t_${suffix}`,
    importId: `imp_${suffix}`,
    databaseName: `cem7d10-${kind}-${suffix}`,
    sourceUrl: `https://m7d10-${suffix}.x.yupoo.com/albums/`,
    expectedDatabaseId: uuid,
    databaseId: null
  };
}

async function createEphemeralDatabase(name) {
  const result = await createD1Database({ ...platformConfig(), databaseName: name });
  if (!result?.databaseId) throw new Error('m7d10_canary_database_create_failed');
  return result.databaseId;
}

async function deleteDatabase(databaseId) {
  if (!databaseId) return;
  await cloudflareRequest(
    `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${encodeURIComponent(databaseId)}`,
    { method: 'DELETE', allowNotFound: true }
  );
}

async function productionMigrationProof() {
  const result = await d1Batch(PRODUCTION_CONTROL_DB_ID, [
    {
      sql: `SELECT name FROM pragma_table_info('tenant_import_jobs')
             WHERE name IN (
               'state_revision','recovery_attempt_count','last_failure_phase','phase_lease_kind',
               'phase_lease_token','phase_lease_until','last_recovery_at','last_delivery_at',
               'candidate_classified_at'
             ) ORDER BY name`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total FROM sqlite_master
             WHERE type='table' AND name='tenant_sync_replay_requests'`,
      params: []
    }
  ]);
  const columns = (result[0]?.results || []).map((row) => String(row.name || ''));
  if (columns.length !== 9 || Number(result[1]?.results?.[0]?.total || 0) !== 1) {
    throw new Error('m7d10_canary_production_migration_missing');
  }
  return { recoveryColumns: columns.length, replayTable: true };
}

async function queueHealth() {
  const result = await cloudflareRequest(`/client/v4/accounts/${ACCOUNT_ID}/queues?per_page=100`);
  const ids = new Map();
  for (const row of Array.isArray(result) ? result : []) {
    const name = String(row?.queue_name || row?.name || '').trim();
    const id = String(row?.queue_id || row?.id || '').trim();
    if (name && id) ids.set(name, id);
  }
  const snapshot = {};
  for (const name of QUEUE_NAMES) {
    const id = ids.get(name);
    if (!id) throw new Error('m7d10_canary_queue_missing');
    const metrics = await cloudflareRequest(
      `/client/v4/accounts/${ACCOUNT_ID}/queues/${encodeURIComponent(id)}/metrics`
    );
    const values = metrics?.metrics || metrics || {};
    snapshot[name] = Number(values.backlog_count || values.backlogCount || 0);
  }
  if (
    snapshot['catalog-engine-import-scan-dlq'] !== 0 ||
    snapshot['catalog-engine-import-detail-dlq'] !== 0
  ) {
    throw new Error('m7d10_canary_dlq_not_clean');
  }
  return snapshot;
}

async function initializeControl(databaseId) {
  await d1Batch(databaseId, [
    {
      sql: `CREATE TABLE catalog_tenants (
              tenant_id TEXT PRIMARY KEY,slug TEXT NOT NULL,display_name TEXT NOT NULL,
              status TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )`,
      params: []
    },
    {
      sql: `CREATE TABLE supplier_sources (
              tenant_id TEXT NOT NULL,source_key TEXT NOT NULL,provider TEXT NOT NULL,
              source_url TEXT NOT NULL,status TEXT NOT NULL,sync_strategy TEXT NOT NULL,
              removal_miss_threshold INTEGER NOT NULL DEFAULT 3,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (tenant_id,source_key)
            )`,
      params: []
    },
    {
      sql: `CREATE TABLE tenant_catalog_instances (
              tenant_id TEXT PRIMARY KEY,data_plane_key TEXT NOT NULL,status TEXT NOT NULL,
              schema_version INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )`,
      params: []
    },
    {
      sql: `CREATE TABLE tenant_data_plane_provider_state (
              tenant_id TEXT PRIMARY KEY,dispatch_namespace TEXT NOT NULL,
              worker_script_name TEXT,d1_database_name TEXT,d1_database_id TEXT,
              worker_status TEXT NOT NULL,database_status TEXT NOT NULL,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )`,
      params: []
    },
    {
      sql: `CREATE TABLE tenant_provisioning_runs (
              provisioning_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,current_step TEXT,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )`,
      params: []
    },
    {
      sql: `CREATE TABLE tenant_import_jobs (
              import_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,source_key TEXT NOT NULL,
              mode TEXT NOT NULL,status TEXT NOT NULL,phase TEXT NOT NULL,
              attempt_count INTEGER NOT NULL DEFAULT 0,detail_enqueue_cursor INTEGER NOT NULL DEFAULT 0,
              discovered_count INTEGER NOT NULL DEFAULT 0,queued_detail_count INTEGER NOT NULL DEFAULT 0,
              completed_detail_count INTEGER NOT NULL DEFAULT 0,failed_detail_count INTEGER NOT NULL DEFAULT 0,
              deferred_detail_count INTEGER NOT NULL DEFAULT 0,next_attempt_at TEXT,finished_at TEXT,
              last_error_code TEXT,sync_scheduled_for TEXT,scan_lease_until TEXT,
              finalize_lease_until TEXT,state_revision INTEGER NOT NULL DEFAULT 0,
              recovery_attempt_count INTEGER NOT NULL DEFAULT 0,last_failure_phase TEXT,
              phase_lease_kind TEXT,phase_lease_token TEXT,phase_lease_until TEXT,
              last_recovery_at TEXT,last_delivery_at TEXT,candidate_classified_at TEXT,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )`,
      params: []
    },
    {
      sql: `CREATE TABLE tenant_sync_replay_requests (
              replay_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,source_key TEXT NOT NULL,
              import_id TEXT NOT NULL,phase TEXT NOT NULL,expected_job_revision INTEGER NOT NULL,
              expected_authority_revision INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
              attempt_count INTEGER NOT NULL DEFAULT 0,replayed_item_count INTEGER NOT NULL DEFAULT 0,
              next_attempt_at TEXT,lease_token TEXT,lease_until TEXT,last_error_code TEXT,
              requested_by_principal_id TEXT NOT NULL,started_at TEXT,finished_at TEXT,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(import_id,phase,expected_job_revision,expected_authority_revision)
            )`,
      params: []
    }
  ]);
}

async function initializeTenant(fixture) {
  const batch = tenantDataPlaneCurrentBatch({
    tenantId: fixture.tenantId,
    source: {
      provider: 'yupoo',
      sourceKey: SOURCE_KEY,
      sourceUrl: fixture.sourceUrl,
      syncStrategy: 'incremental',
      removalMissThreshold: 3
    }
  });
  for (const chunk of splitD1Batch(batch)) await d1Batch(fixture.databaseId, chunk);
}

async function seedControl(controlId, fixture, failurePhase, { lease = false } = {}) {
  await d1Batch(controlId, [
    {
      sql: `INSERT INTO catalog_tenants(tenant_id,slug,display_name,status)
            VALUES (?1,?2,'M7D10 Canary','active')`,
      params: [fixture.tenantId, `m7d10-${fixture.tenantId.slice(2)}`]
    },
    {
      sql: `INSERT INTO supplier_sources
              (tenant_id,source_key,provider,source_url,status,sync_strategy,removal_miss_threshold)
            VALUES (?1,?2,'yupoo',?3,'active','incremental',3)`,
      params: [fixture.tenantId, SOURCE_KEY, fixture.sourceUrl]
    },
    {
      sql: `INSERT INTO tenant_catalog_instances(tenant_id,data_plane_key,status,schema_version)
            VALUES (?1,?2,'ready',8)`,
      params: [fixture.tenantId, `plane-${fixture.tenantId}`]
    },
    {
      sql: `INSERT INTO tenant_data_plane_provider_state
              (tenant_id,dispatch_namespace,worker_script_name,d1_database_name,d1_database_id,
               worker_status,database_status)
            VALUES (?1,?2,?3,?4,?5,'active','active')`,
      params: [
        fixture.tenantId,
        DISPATCH_NAMESPACE,
        `worker-${fixture.tenantId}`,
        fixture.databaseName,
        fixture.databaseId
      ]
    },
    {
      sql: `INSERT INTO tenant_import_jobs
              (import_id,tenant_id,source_key,mode,status,phase,state_revision,
               recovery_attempt_count,last_failure_phase,last_error_code,next_attempt_at,
               phase_lease_kind,phase_lease_token,phase_lease_until,scan_lease_until)
            VALUES (?1,?2,?3,'incremental',?4,?5,7,1,?6,?7,?8,?9,?10,?11,?12)`,
      params: lease
        ? [
            fixture.importId,
            fixture.tenantId,
            SOURCE_KEY,
            'scanning',
            'scan',
            'scan',
            'tenant_sync_scan_timeout',
            null,
            'scan',
            'expired-owner',
            '2000-01-01 00:00:00',
            '2000-01-01 00:00:00'
          ]
        : [
            fixture.importId,
            fixture.tenantId,
            SOURCE_KEY,
            'failed',
            'details',
            failurePhase,
            `sync_candidate_${failurePhase}_failed`,
            failurePhase === 'detail' ? null : '2000-01-01 00:00:00',
            null,
            null,
            null,
            null
          ]
    }
  ]);
}

async function seedStage(fixture, state, { detail = false } = {}) {
  const batch = [
    {
      sql: `INSERT INTO supplier_sync_runs
              (run_id,tenant_id,source_key,mode,status,complete_scan,scanned_albums,
               detail_fetch_count,started_at,error_text)
            VALUES (?1,?2,?3,'incremental',?4,1,1,?5,CURRENT_TIMESTAMP,?6)`,
      params: [
        fixture.importId,
        fixture.tenantId,
        SOURCE_KEY,
        state === 'failed' ? 'failed' : 'running',
        detail ? 1 : 0,
        state === 'failed' ? 'sync_candidate_classification_failed' : null
      ]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_runs
              (run_id,tenant_id,source_key,scope_id,scope_kind,state,safety_outcome,
               scan_complete,observed_count,expected_event_count,expected_detail_count,
               staged_observation_count,staged_event_count,last_error_code)
            VALUES (?1,?2,?3,'catalog','catalog',?4,'proceed',1,1,1,?5,1,1,?6)`,
      params: [
        fixture.importId,
        fixture.tenantId,
        SOURCE_KEY,
        state,
        detail ? 1 : 0,
        state === 'failed' ? 'sync_candidate_classification_failed' : null
      ]
    },
    {
      sql: `INSERT INTO supplier_sync_stage_authority
              (run_id,tenant_id,source_key,base_authority_revision)
            VALUES (?1,?2,?3,0)`,
      params: [fixture.importId, fixture.tenantId, SOURCE_KEY]
    }
  ];
  if (detail) {
    batch.push(
      {
        sql: `INSERT INTO supplier_sync_stage_observations
                (run_id,album_source_id,public_product_id,source_url,source_title,
                 source_category_path_json,listing_fingerprint)
              VALUES (?1,'album-canary','p_0123456789abcdefabcd',?2,
                      'Private candidate','[]','listing-canary')`,
        params: [fixture.importId, `${fixture.sourceUrl}album-canary`]
      },
      {
        sql: `INSERT INTO supplier_sync_stage_events
                (run_id,album_source_id,public_product_id,event_type,needs_detail,reason_code)
              VALUES (?1,'album-canary','p_0123456789abcdefabcd','CHANGED',1,
                      'sync_listing_changed')`,
        params: [fixture.importId]
      },
      {
        sql: `INSERT INTO supplier_sync_stage_product_details
                (run_id,album_source_id,public_product_id,detail_state,attempt_count,
                 outcome_code,last_error_code)
              VALUES (?1,'album-canary','p_0123456789abcdefabcd','failed',4,
                      'sync_detail_retry_exhausted','supplier_request_failed')`,
        params: [fixture.importId]
      }
    );
  }
  await d1Batch(fixture.databaseId, batch);
}

function runnerEnv(controlDb) {
  return {
    CATALOG_DB: controlDb,
    CLOUDFLARE_PLATFORM_ACCOUNT_ID: ACCOUNT_ID,
    CLOUDFLARE_PLATFORM_API_TOKEN: API_TOKEN,
    CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: DISPATCH_NAMESPACE
  };
}

const control = identity('control', '1');
const healthy = identity('healthy', '2');
const broken = identity('broken', '3');
const replay = identity('replay', '4');
const lease = identity('lease', '5');
const resources = [control, healthy, broken, replay, lease];
let passed = false;

try {
  for (const resource of resources) {
    resource.databaseId = await createEphemeralDatabase(resource.databaseName);
  }
  await initializeControl(control.databaseId);
  for (const fixture of [healthy, broken, replay]) await initializeTenant(fixture);

  await seedControl(control.databaseId, healthy, 'classification');
  await seedControl(control.databaseId, broken, 'classification');
  await seedControl(control.databaseId, replay, 'detail');
  await seedControl(control.databaseId, lease, 'scan', { lease: true });
  await seedStage(healthy, 'details_complete');
  await seedStage(broken, 'failed');
  await seedStage(replay, 'details_pending', { detail: true });

  const controlDb = new RestD1Adapter(control.databaseId);
  const migration = await productionMigrationProof();
  const queuesBefore = await queueHealth();

  const oldOwnership = { kind: 'scan', token: 'expired-owner', revision: 7 };
  const reclaimed = await reclaimExpiredTenantSyncPhaseLeases(controlDb);
  const reclaimedLease = await controlDb
    .prepare(`SELECT import_id,tenant_id,source_key,mode,state_revision
                     ,status,recovery_attempt_count,last_failure_phase,last_error_code,
                     next_attempt_at,phase_lease_token
                FROM tenant_import_jobs WHERE import_id=?1`)
    .bind(lease.importId)
    .first();
  if (
    reclaimed !== 1 ||
    reclaimedLease?.status !== 'failed' ||
    Number(reclaimedLease?.recovery_attempt_count || 0) !== 2 ||
    reclaimedLease?.last_failure_phase !== 'scan' ||
    reclaimedLease?.last_error_code !== 'tenant_sync_scan_lease_expired' ||
    !reclaimedLease?.next_attempt_at ||
    reclaimedLease?.phase_lease_token != null
  ) {
    throw new Error('m7d10_canary_lease_reclaim_failed');
  }
  await controlDb
    .prepare(`UPDATE tenant_import_jobs
                 SET status='queued',next_attempt_at=NULL,state_revision=state_revision+1,
                     updated_at=CURRENT_TIMESTAMP
               WHERE import_id=?1 AND status='failed' AND state_revision=?2`)
    .bind(lease.importId, reclaimedLease.state_revision)
    .run();
  const leaseRow = await controlDb
    .prepare(`SELECT import_id,tenant_id,source_key,mode,state_revision
                FROM tenant_import_jobs WHERE import_id=?1`)
    .bind(lease.importId)
    .first();
  const newOwnership = await claimTenantSyncPhaseLease(controlDb, leaseRow, 'scan');
  if (!newOwnership) throw new Error('m7d10_canary_lease_reclaim_failed');
  const oldOwnerReleased = await releaseTenantSyncPhaseLease(controlDb, leaseRow, oldOwnership);
  const oldOwnerFailed = await failTenantSyncPhaseLease(
    controlDb,
    leaseRow,
    oldOwnership,
    'tenant_sync_scan_timeout'
  );
  const newOwnerFailed = await failTenantSyncPhaseLease(
    controlDb,
    leaseRow,
    newOwnership,
    'tenant_sync_scan_timeout'
  );
  if (oldOwnerReleased || oldOwnerFailed || !newOwnerFailed) {
    throw new Error('m7d10_canary_lease_cas_invalid');
  }

  const recovery = await runDueTenantIncrementalRecoveries(runnerEnv(controlDb), { limit: 5 });
  if (recovery.recovered !== 1 || recovery.blocked !== 1 || recovery.failed !== 0) {
    throw new Error('m7d10_canary_recovery_isolation_failed');
  }

  const replayRequest = await createTenantSyncReplayRequest(controlDb, {
    tenantId: replay.tenantId,
    requestedByPrincipalId: 'm7d10-production-canary',
    importId: replay.importId,
    phase: 'detail',
    expectedJobRevision: 7,
    expectedAuthorityRevision: 0
  });
  const messages = [];
  const replayResult = await runDueTenantSyncReplays({
    ...runnerEnv(controlDb),
    TENANT_IMPORT_DETAIL_QUEUE: {
      sendBatch: async (batch) => messages.push(...batch.map((entry) => entry.body))
    }
  });
  if (
    replayResult.succeeded !== 1 ||
    messages.length !== 1 ||
    messages[0]?.type !== 'detail' ||
    messages[0]?.importId !== replay.importId
  ) {
    throw new Error('m7d10_canary_replay_derivation_failed');
  }
  if (/https?:\/\/|yupoo|database|worker|secret|token/i.test(JSON.stringify(messages))) {
    throw new Error('m7d10_canary_replay_payload_leak');
  }

  const operations = await readTenantSyncOperations(controlDb, replay.tenantId);
  if (
    operations.replays[0]?.replayId !== replayRequest.replayId ||
    /https?:\/\/|yupoo|database|worker|secret|token/i.test(JSON.stringify(operations))
  ) {
    throw new Error('m7d10_canary_observability_leak');
  }

  const queuesAfter = await queueHealth();
  passed = true;
  for (const resource of resources) await deleteDatabase(resource.databaseId);
  console.log(
    JSON.stringify(
      {
        m7d10RecoveryCanaryPassed: true,
        productionBusinessDataMutated: false,
        ephemeralControlAndTenantDataPlanes: true,
        migration,
        expiredLeaseReclaimed: true,
        staleOwnerRejectedByTokenAndRevisionCas: true,
        boundedRecoveryIsolation: true,
        healthyTenantRecovered: recovery.recovered,
        poisonedTenantBlocked: recovery.blocked,
        validatedReplayRequest: true,
        manualReplayPayloadAccepted: false,
        replayMessagesDerivedFromDurableEvidence: messages.length,
        safeObservabilityProjection: true,
        realQueuePrerequisiteRequired: true,
        queueAndDlqMetricsBefore: queuesBefore,
        queueAndDlqMetricsAfter: queuesAfter,
        recurringTenantSyncEnabled: false,
        activeCohortSize: 0,
        maxJobsPerTick: 1
      },
      null,
      2
    )
  );
} catch (error) {
  const value = String(error?.message || '');
  const code = /^m7d10_canary_[a-z0-9_]+$/i.test(value) ? value : 'm7d10_canary_failed';
  console.error(
    JSON.stringify({ m7d10RecoveryCanaryPassed: false, error: code, retainedEvidence: true })
  );
  throw new Error(code);
} finally {
  if (passed) {
    // All disposable evidence is removed only after every assertion succeeds.
  }
}
