import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CloudflarePlatformError,
  assertDispatchNamespace,
  ensureD1Database,
  queryD1Batch,
  uploadTenantBootstrapWorker
} from '../worker/cloudflare-platform.js';
import { stableOpaqueId } from '../worker/runtime-identity.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  tenantDataPlaneCurrentBatch,
  tenantDataPlaneMigrationBatches
} from '../worker/tenant-data-plane-schema-v8.js';
import { splitD1Batch } from './d1-batch-chunks.mjs';

const DEFAULT_DISPATCH_NAMESPACE = 'catalog-engine-production';
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;
const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const RESOURCE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/i;
const DATABASE_ID_PATTERN = /^[a-f0-9-]{32,40}$/i;
const SAFE_CODE_PATTERN = /^[a-z0-9_.:-]{1,96}$/i;

function boundedInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function safeCode(error) {
  const candidate = String(
    error instanceof CloudflarePlatformError ? error.code : error?.code || error?.message || ''
  ).trim();
  return SAFE_CODE_PATTERN.test(candidate) ? candidate : 'trusted_fresh_provisioning_failed';
}

function validateCandidate(row) {
  const candidate = {
    tenantId: String(row?.tenant_id || '').trim(),
    provisioningId: String(row?.provisioning_id || '').trim(),
    currentStep: String(row?.current_step || '').trim(),
    workerScriptName: String(row?.worker_script_name || '').trim(),
    databaseName: String(row?.d1_database_name || '').trim(),
    databaseId: String(row?.d1_database_id || '').trim(),
    dispatchNamespace: String(row?.dispatch_namespace || '').trim(),
    dataPlaneJobId: String(row?.data_plane_job_id || '').trim(),
    schemaVersion: Number(row?.schema_version || 0),
    source: {
      sourceKey: String(row?.source_key || '').trim(),
      provider: String(row?.source_provider || '').trim(),
      sourceUrl: String(row?.source_url || '').trim(),
      syncStrategy: String(row?.sync_strategy || '').trim(),
      removalMissThreshold: Number(row?.removal_miss_threshold || 3)
    }
  };
  if (!TENANT_ID_PATTERN.test(candidate.tenantId)) throw new Error('trusted_fresh_tenant_invalid');
  if (!candidate.provisioningId) throw new Error('trusted_fresh_provisioning_id_missing');
  if (!['data_plane', 'migrations'].includes(candidate.currentStep)) {
    throw new Error('trusted_fresh_step_invalid');
  }
  if (!RESOURCE_PATTERN.test(candidate.workerScriptName)) throw new Error('trusted_fresh_worker_invalid');
  if (!RESOURCE_PATTERN.test(candidate.databaseName)) throw new Error('trusted_fresh_database_name_invalid');
  if (candidate.databaseId && !DATABASE_ID_PATTERN.test(candidate.databaseId)) {
    throw new Error('trusted_fresh_database_id_invalid');
  }
  if (!RESOURCE_PATTERN.test(candidate.dispatchNamespace)) {
    throw new Error('trusted_fresh_namespace_invalid');
  }
  if (!candidate.dataPlaneJobId) throw new Error('trusted_fresh_job_missing');
  if (!candidate.source.sourceKey || !candidate.source.provider || !candidate.source.sourceUrl) {
    throw new Error('trusted_fresh_source_missing');
  }
  if (!Number.isInteger(candidate.schemaVersion) || candidate.schemaVersion < 0) {
    throw new Error('trusted_fresh_schema_invalid');
  }
  return candidate;
}

export const TRUSTED_FRESH_DISCOVERY_SQL = `SELECT
       r.tenant_id,
       r.provisioning_id,
       r.current_step,
       i.schema_version,
       p.dispatch_namespace,
       p.worker_script_name,
       p.d1_database_name,
       p.d1_database_id,
       j.job_id AS data_plane_job_id,
       j.status AS data_plane_job_status,
       j.attempt_count AS data_plane_attempt_count,
       j.last_error_code AS data_plane_last_error_code,
       s.source_key,
       s.provider AS source_provider,
       s.source_url,
       s.sync_strategy,
       s.removal_miss_threshold
  FROM tenant_provisioning_runs r
  JOIN tenant_catalog_instances i ON i.tenant_id=r.tenant_id
  JOIN tenant_data_plane_provider_state p ON p.tenant_id=r.tenant_id
  JOIN tenant_data_plane_jobs j ON j.tenant_id=r.tenant_id AND j.operation='provision'
  JOIN supplier_sources s ON s.tenant_id=r.tenant_id AND s.status='active'
 WHERE r.provisioning_id=(
         SELECT r2.provisioning_id
           FROM tenant_provisioning_runs r2
          WHERE r2.tenant_id=r.tenant_id
          ORDER BY r2.created_at DESC
          LIMIT 1
       )
   AND r.current_step IN ('data_plane','migrations')
   AND r.status IN ('running','failed','blocked')
   AND i.status='provisioning'
   AND p.dispatch_namespace=?1
   AND j.status IN ('pending','failed','running','success')
 ORDER BY r.created_at ASC, s.created_at ASC
 LIMIT ?2`;

async function claimTrustedRecovery(controlBatch, candidate) {
  if (candidate.currentStep !== 'data_plane') return true;
  const result = await controlBatch([
    {
      sql: `UPDATE tenant_data_plane_jobs
               SET status='running', started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
                   finished_at=NULL, next_attempt_at=NULL,
                   last_error_code='trusted_ci_recovery', updated_at=CURRENT_TIMESTAMP
             WHERE job_id=?1 AND tenant_id=?2 AND operation='provision'
               AND status IN ('pending','failed','running')`,
      params: [candidate.dataPlaneJobId, candidate.tenantId]
    },
    {
      sql: `UPDATE tenant_data_plane_provider_state
               SET worker_status=CASE WHEN worker_status='active' THEN 'active' ELSE 'provisioning' END,
                   database_status=CASE WHEN database_status='active' THEN 'active' ELSE 'provisioning' END,
                   last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?1 AND dispatch_namespace=?2`,
      params: [candidate.tenantId, candidate.dispatchNamespace]
    }
  ]);
  return Number(result?.[0]?.meta?.changes || 0) === 1;
}

async function finishDataPlane(controlBatch, candidate, database, worker) {
  const result = await controlBatch([
    {
      sql: `UPDATE tenant_data_plane_provider_state
               SET d1_database_id=?2, database_status='active', worker_status='active',
                   worker_version=?3, last_checked_at=CURRENT_TIMESTAMP,
                   last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?1 AND dispatch_namespace=?4`,
      params: [
        candidate.tenantId,
        database.databaseId,
        worker.versionId || null,
        candidate.dispatchNamespace
      ]
    },
    {
      sql: `UPDATE tenant_data_plane_jobs
               SET status='success', finished_at=CURRENT_TIMESTAMP, next_attempt_at=NULL,
                   last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
             WHERE job_id=?1 AND tenant_id=?2 AND operation='provision'`,
      params: [candidate.dataPlaneJobId, candidate.tenantId]
    },
    {
      sql: `UPDATE tenant_provisioning_steps
               SET status='success', attempt_count=CASE WHEN attempt_count < 1 THEN 1 ELSE attempt_count END,
                   started_at=COALESCE(started_at,CURRENT_TIMESTAMP), finished_at=CURRENT_TIMESTAMP,
                   last_error=NULL, metadata_json='{"provider":"cloudflare_wfp","isolated":true,"executor":"trusted_ci"}',
                   updated_at=CURRENT_TIMESTAMP
             WHERE provisioning_id=?1 AND step_key='data_plane'`,
      params: [candidate.provisioningId]
    },
    {
      sql: `UPDATE tenant_provisioning_runs
               SET current_step='migrations', status='running', last_error=NULL,
                   updated_at=CURRENT_TIMESTAMP
             WHERE provisioning_id=?1 AND tenant_id=?2 AND current_step='data_plane'`,
      params: [candidate.provisioningId, candidate.tenantId]
    }
  ]);
  if (Number(result?.[0]?.meta?.changes || 0) !== 1) {
    throw new Error('trusted_fresh_data_plane_promotion_failed');
  }
}

async function failDataPlane(controlBatch, candidate, code) {
  await controlBatch([
    {
      sql: `UPDATE tenant_data_plane_jobs
               SET status='failed', finished_at=CURRENT_TIMESTAMP,
                   next_attempt_at=datetime(CURRENT_TIMESTAMP,'+10 minutes'),
                   last_error_code=?3, updated_at=CURRENT_TIMESTAMP
             WHERE job_id=?1 AND tenant_id=?2 AND operation='provision'`,
      params: [candidate.dataPlaneJobId, candidate.tenantId, code]
    },
    {
      sql: `UPDATE tenant_data_plane_provider_state
               SET worker_status=CASE WHEN worker_status='active' THEN 'active' ELSE 'error' END,
                   database_status=CASE WHEN database_status='active' THEN 'active' ELSE 'error' END,
                   last_checked_at=CURRENT_TIMESTAMP, last_error_code=?2,
                   updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?1`,
      params: [candidate.tenantId, code]
    }
  ]);
}

async function ensureFreshDataPlane(candidate, { platform, controlBatch, uploadWorker }) {
  if (candidate.currentStep === 'migrations' && candidate.databaseId) {
    return { databaseId: candidate.databaseId, created: false, workerVersion: null };
  }
  if (!(await claimTrustedRecovery(controlBatch, candidate))) {
    throw new Error('trusted_fresh_claim_failed');
  }
  try {
    await assertDispatchNamespace(platform);
    const database = candidate.databaseId
      ? { databaseId: candidate.databaseId, databaseName: candidate.databaseName, created: false }
      : await ensureD1Database({ ...platform, databaseName: candidate.databaseName });
    const worker = await uploadWorker({
      ...platform,
      scriptName: candidate.workerScriptName,
      databaseId: database.databaseId,
      tenantId: candidate.tenantId
    });
    await finishDataPlane(controlBatch, candidate, database, worker);
    return { databaseId: database.databaseId, created: database.created === true, workerVersion: worker.versionId || null };
  } catch (error) {
    await failDataPlane(controlBatch, candidate, safeCode(error));
    throw error;
  }
}

async function claimMigration(controlBatch, candidate, migrationJobId) {
  const result = await controlBatch([
    {
      sql: `INSERT INTO tenant_data_plane_migration_jobs
              (job_id,tenant_id,target_schema_version,migration_kind,status,attempt_count,
               next_attempt_at,started_at,created_at,updated_at)
            VALUES (?1,?2,?3,'provisioning','running',1,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
            ON CONFLICT(job_id) DO UPDATE SET
              status='running', attempt_count=tenant_data_plane_migration_jobs.attempt_count+1,
              next_attempt_at=NULL, started_at=COALESCE(tenant_data_plane_migration_jobs.started_at,CURRENT_TIMESTAMP),
              finished_at=NULL, last_error_code=NULL, updated_at=CURRENT_TIMESTAMP`,
      params: [migrationJobId, candidate.tenantId, TENANT_DATA_PLANE_SCHEMA_VERSION]
    },
    {
      sql: `UPDATE tenant_provisioning_steps
               SET status='running', attempt_count=attempt_count+1,
                   started_at=COALESCE(started_at,CURRENT_TIMESTAMP), finished_at=NULL,
                   last_error=NULL, updated_at=CURRENT_TIMESTAMP
             WHERE provisioning_id=?1 AND step_key='migrations'`,
      params: [candidate.provisioningId]
    },
    {
      sql: `UPDATE tenant_provisioning_runs
               SET current_step='migrations', status='running', last_error=NULL,
                   updated_at=CURRENT_TIMESTAMP
             WHERE provisioning_id=?1 AND tenant_id=?2
               AND current_step IN ('data_plane','migrations')`,
      params: [candidate.provisioningId, candidate.tenantId]
    }
  ]);
  return Number(result?.[0]?.meta?.changes || 0) >= 1;
}

async function finishMigration(controlBatch, candidate, migrationJobId) {
  const result = await controlBatch([
    {
      sql: `UPDATE tenant_data_plane_migration_jobs
               SET status='success', finished_at=CURRENT_TIMESTAMP, next_attempt_at=NULL,
                   last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
             WHERE job_id=?1 AND tenant_id=?2`,
      params: [migrationJobId, candidate.tenantId]
    },
    {
      sql: `UPDATE tenant_catalog_instances
               SET schema_version=?2, status='provisioning', last_migration_at=CURRENT_TIMESTAMP,
                   last_error=NULL, updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?1 AND status='provisioning'`,
      params: [candidate.tenantId, TENANT_DATA_PLANE_SCHEMA_VERSION]
    },
    {
      sql: `UPDATE tenant_provisioning_steps
               SET status='success', finished_at=CURRENT_TIMESTAMP, last_error=NULL,
                   metadata_json=?2, updated_at=CURRENT_TIMESTAMP
             WHERE provisioning_id=?1 AND step_key='migrations'`,
      params: [
        candidate.provisioningId,
        JSON.stringify({ schemaVersion: TENANT_DATA_PLANE_SCHEMA_VERSION, isolated: true, resumeStep: 'import', executor: 'trusted_ci' })
      ]
    },
    {
      sql: `UPDATE tenant_provisioning_runs
               SET current_step='import', status='running', last_error=NULL,
                   updated_at=CURRENT_TIMESTAMP
             WHERE provisioning_id=?1 AND tenant_id=?2 AND current_step='migrations'`,
      params: [candidate.provisioningId, candidate.tenantId]
    }
  ]);
  if (Number(result?.[3]?.meta?.changes || 0) !== 1) {
    throw new Error('trusted_fresh_migration_promotion_failed');
  }
}

async function failMigration(controlBatch, candidate, migrationJobId, code) {
  await controlBatch([
    {
      sql: `UPDATE tenant_data_plane_migration_jobs
               SET status='failed', finished_at=CURRENT_TIMESTAMP,
                   next_attempt_at=datetime(CURRENT_TIMESTAMP,'+10 minutes'),
                   last_error_code=?3, updated_at=CURRENT_TIMESTAMP
             WHERE job_id=?1 AND tenant_id=?2`,
      params: [migrationJobId, candidate.tenantId, code]
    },
    {
      sql: `UPDATE tenant_catalog_instances
               SET status='provisioning', last_error=?2, updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=?1`,
      params: [candidate.tenantId, code]
    },
    {
      sql: `UPDATE tenant_provisioning_steps
               SET status='failed', finished_at=CURRENT_TIMESTAMP, last_error=?2,
                   updated_at=CURRENT_TIMESTAMP
             WHERE provisioning_id=?1 AND step_key='migrations'`,
      params: [candidate.provisioningId, code]
    },
    {
      sql: `UPDATE tenant_provisioning_runs
               SET status='failed', current_step='migrations', last_error=?3,
                   updated_at=CURRENT_TIMESTAMP
             WHERE provisioning_id=?1 AND tenant_id=?2`,
      params: [candidate.provisioningId, candidate.tenantId, code]
    }
  ]);
}

async function applyFreshSchema(candidate, databaseId, { platform, controlBatch }) {
  const migrationJobId = await stableOpaqueId(
    'dpmig',
    `${candidate.tenantId}:v${TENANT_DATA_PLANE_SCHEMA_VERSION}`
  );
  await claimMigration(controlBatch, candidate, migrationJobId);
  try {
    const batch =
      candidate.schemaVersion === 0
        ? tenantDataPlaneCurrentBatch({ tenantId: candidate.tenantId, source: candidate.source })
        : tenantDataPlaneMigrationBatches({
            tenantId: candidate.tenantId,
            source: candidate.source,
            currentVersion: candidate.schemaVersion,
            targetVersion: TENANT_DATA_PLANE_SCHEMA_VERSION
          }).flat();
    if (batch.length > 0) {
      for (const chunk of splitD1Batch(batch)) {
        await queryD1Batch({ ...platform, databaseId, batch: chunk });
      }
    }
    const verification = await queryD1Batch({
      ...platform,
      databaseId,
      batch: [
        {
          sql: 'SELECT tenant_id,schema_version FROM data_plane_identity WHERE tenant_id=?1 LIMIT 1',
          params: [candidate.tenantId]
        },
        {
          sql: "SELECT COUNT(*) AS total FROM supplier_sources WHERE tenant_id=?1 AND source_key=?2 AND status='active'",
          params: [candidate.tenantId, candidate.source.sourceKey]
        }
      ]
    });
    const identity = verification?.[0]?.results?.[0];
    const sourceCount = Number(verification?.[1]?.results?.[0]?.total || 0);
    if (
      identity?.tenant_id !== candidate.tenantId ||
      Number(identity?.schema_version) !== TENANT_DATA_PLANE_SCHEMA_VERSION ||
      sourceCount !== 1
    ) {
      throw new Error('trusted_fresh_migration_verification_failed');
    }
    await finishMigration(controlBatch, candidate, migrationJobId);
  } catch (error) {
    await failMigration(controlBatch, candidate, migrationJobId, safeCode(error));
    throw error;
  }
}

export async function runTrustedFreshTenantProvisioning(
  env = process.env,
  { controlBatch: controlBatchOverride, uploadWorker = uploadTenantBootstrapWorker, limit } = {}
) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const apiToken = String(env.CLOUDFLARE_API_TOKEN || '').trim();
  const dispatchNamespace = String(
    env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || DEFAULT_DISPATCH_NAMESPACE
  ).trim();
  const controlDatabaseId = String(env.CATALOG_CONTROL_DATABASE_ID || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('trusted_fresh_account_invalid');
  if (apiToken.length < 20) throw new Error('trusted_fresh_token_invalid');
  if (!RESOURCE_PATTERN.test(dispatchNamespace)) throw new Error('trusted_fresh_namespace_invalid');
  if (!DATABASE_ID_PATTERN.test(controlDatabaseId)) throw new Error('trusted_fresh_control_database_invalid');

  const boundedLimit = boundedInteger(limit ?? env.TRUSTED_FRESH_PROVISION_LIMIT, DEFAULT_LIMIT, MAX_LIMIT);
  const platform = { accountId, apiToken, dispatchNamespace };
  const controlBatch =
    controlBatchOverride ||
    ((batch) => queryD1Batch({ ...platform, databaseId: controlDatabaseId, batch }));
  const discovery = await controlBatch([
    { sql: TRUSTED_FRESH_DISCOVERY_SQL, params: [dispatchNamespace, boundedLimit] }
  ]);
  const candidates = (discovery?.[0]?.results || []).map(validateCandidate);
  const outcomes = [];

  for (const candidate of candidates) {
    try {
      const dataPlane = await ensureFreshDataPlane(candidate, { platform, controlBatch, uploadWorker });
      await applyFreshSchema(candidate, dataPlane.databaseId, { platform, controlBatch });
      outcomes.push({ outcome: 'ready_for_import' });
    } catch (error) {
      outcomes.push({ outcome: 'failed', safeErrorCode: safeCode(error) });
    }
  }

  return {
    trustedFreshTenantProvisioningCompleted: true,
    trustedCiOwnedPhysicalProvisioning: true,
    recurringSyncAutomationEnabled: false,
    selected: candidates.length,
    readyForImport: outcomes.filter((entry) => entry.outcome === 'ready_for_import').length,
    failed: outcomes.filter((entry) => entry.outcome === 'failed').length,
    safeErrorCodes: outcomes
      .filter((entry) => entry.outcome === 'failed')
      .map((entry) => entry.safeErrorCode)
  };
}

async function main() {
  const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  if (String(wrangler.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') !== '0') {
    throw new Error('trusted_fresh_requires_recurring_sync_off');
  }
  const controlDatabaseId = String(
    wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
  ).trim();
  const evidence = await runTrustedFreshTenantProvisioning({
    ...process.env,
    CATALOG_CONTROL_DATABASE_ID: controlDatabaseId
  });
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.failed > 0) throw new Error('trusted_fresh_tenant_failure');
}

const isDirectExecution =
  Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) await main();
