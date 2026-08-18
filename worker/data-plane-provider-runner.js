import {
  CloudflarePlatformError,
  assertDispatchNamespace,
  ensureD1Database,
  uploadTenantBootstrapWorker
} from './cloudflare-platform.js';
import { buildTenantDataPlanePlan, publicTenantDataPlaneState } from './tenant-data-plane.js';

const DEFAULT_DISPATCH_NAMESPACE = 'catalog-engine-production';
const MAX_AUTOMATIC_ATTEMPTS = 6;

function runtimeConfig(env) {
  const accountId = String(env.CLOUDFLARE_PLATFORM_ACCOUNT_ID || '').trim();
  const apiToken = String(env.CLOUDFLARE_PLATFORM_API_TOKEN || '').trim();
  const dispatchNamespace = String(
    env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || DEFAULT_DISPATCH_NAMESPACE
  ).trim();
  if (!accountId || !apiToken) return null;
  return { accountId, apiToken, dispatchNamespace };
}

export function cloudflarePlatformConfigured(env) {
  return Boolean(runtimeConfig(env));
}

export async function enqueueTenantDataPlaneProvisioning(db, { tenantId, dispatchNamespace = DEFAULT_DISPATCH_NAMESPACE }) {
  const plan = await buildTenantDataPlanePlan({ tenantId, dispatchNamespace });
  await db.batch([
    db
      .prepare(
        `INSERT INTO tenant_data_plane_provider_state
          (tenant_id, provider, dispatch_namespace, worker_script_name, d1_database_name,
           worker_status, database_status, created_at, updated_at)
         VALUES (?1, 'cloudflare_wfp', ?2, ?3, ?4, 'pending', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(tenant_id) DO UPDATE SET
           dispatch_namespace=excluded.dispatch_namespace,
           worker_script_name=excluded.worker_script_name,
           d1_database_name=excluded.d1_database_name,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(tenantId, plan.dispatchNamespace, plan.workerScriptName, plan.d1DatabaseName),
    db
      .prepare(
        `INSERT INTO tenant_data_plane_jobs
          (job_id, tenant_id, operation, status, attempt_count, next_attempt_at, created_at, updated_at)
         VALUES (?1, ?2, 'provision', 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(job_id) DO UPDATE SET
           status=CASE WHEN tenant_data_plane_jobs.status='running' THEN 'running' ELSE 'pending' END,
           next_attempt_at=CASE WHEN tenant_data_plane_jobs.status='running' THEN tenant_data_plane_jobs.next_attempt_at ELSE CURRENT_TIMESTAMP END,
           finished_at=CASE WHEN tenant_data_plane_jobs.status='running' THEN tenant_data_plane_jobs.finished_at ELSE NULL END,
           last_error_code=CASE WHEN tenant_data_plane_jobs.status='running' THEN tenant_data_plane_jobs.last_error_code ELSE NULL END,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(plan.job.jobId, tenantId)
  ]);
  return plan;
}

async function providerState(db, tenantId) {
  return db
    .prepare(
      `SELECT tenant_id, provider, dispatch_namespace, worker_script_name, d1_database_name,
              d1_database_id, worker_status, database_status, worker_version,
              last_checked_at, last_error_code
         FROM tenant_data_plane_provider_state
        WHERE tenant_id=?1
        LIMIT 1`
    )
    .bind(tenantId)
    .first();
}

async function claimJob(db, jobId) {
  const result = await db
    .prepare(
      `UPDATE tenant_data_plane_jobs
          SET status='running', attempt_count=attempt_count+1,
              started_at=COALESCE(started_at,CURRENT_TIMESTAMP), finished_at=NULL,
              last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE job_id=?1 AND status IN ('pending','failed') AND attempt_count < ?2`
    )
    .bind(jobId, MAX_AUTOMATIC_ATTEMPTS)
    .run();
  return Number(result.meta?.changes || 0) > 0;
}

async function finishJob(db, jobId) {
  await db
    .prepare(
      `UPDATE tenant_data_plane_jobs
          SET status='success', finished_at=CURRENT_TIMESTAMP, next_attempt_at=NULL,
              last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE job_id=?1`
    )
    .bind(jobId)
    .run();
}

async function failJob(db, jobId, tenantId, safeCode) {
  await db.batch([
    db
      .prepare(
        `UPDATE tenant_data_plane_jobs
            SET status='failed', finished_at=CURRENT_TIMESTAMP,
                next_attempt_at=datetime(CURRENT_TIMESTAMP,'+10 minutes'),
                last_error_code=?2, updated_at=CURRENT_TIMESTAMP
          WHERE job_id=?1`
      )
      .bind(jobId, safeCode),
    db
      .prepare(
        `UPDATE tenant_data_plane_provider_state
            SET worker_status=CASE WHEN worker_status='active' THEN 'active' ELSE 'error' END,
                database_status=CASE WHEN database_status='active' THEN 'active' ELSE 'error' END,
                last_checked_at=CURRENT_TIMESTAMP, last_error_code=?2, updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?1`
      )
      .bind(tenantId, safeCode)
  ]);
}

async function persistDatabase(db, tenantId, database) {
  await db
    .prepare(
      `UPDATE tenant_data_plane_provider_state
          SET d1_database_id=?2, database_status='active', last_checked_at=CURRENT_TIMESTAMP,
              last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=?1`
    )
    .bind(tenantId, database.databaseId)
    .run();
}

async function persistWorker(db, tenantId, worker) {
  await db
    .prepare(
      `UPDATE tenant_data_plane_provider_state
          SET worker_status='active', worker_version=?2, last_checked_at=CURRENT_TIMESTAMP,
              last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=?1`
    )
    .bind(tenantId, worker.versionId)
    .run();
}

async function markDataPlaneCheckpointReady(db, tenantId) {
  const run = await db
    .prepare(
      `SELECT provisioning_id, current_step
         FROM tenant_provisioning_runs
        WHERE tenant_id=?1
        ORDER BY created_at DESC
        LIMIT 1`
    )
    .bind(tenantId)
    .first();
  if (!run?.provisioning_id) return;

  await db.batch([
    db
      .prepare(
        `UPDATE tenant_provisioning_steps
            SET status='success', attempt_count=CASE WHEN attempt_count < 1 THEN 1 ELSE attempt_count END,
                started_at=COALESCE(started_at,CURRENT_TIMESTAMP), finished_at=CURRENT_TIMESTAMP,
                last_error=NULL, metadata_json='{"provider":"cloudflare_wfp","isolated":true}',
                updated_at=CURRENT_TIMESTAMP
          WHERE provisioning_id=?1 AND step_key='data_plane'`
      )
      .bind(run.provisioning_id),
    db
      .prepare(
        `UPDATE tenant_provisioning_runs
            SET current_step=CASE WHEN current_step='data_plane' THEN 'migrations' ELSE current_step END,
                status=CASE WHEN current_step='data_plane' THEN 'running' ELSE status END,
                last_error=CASE WHEN current_step='data_plane' THEN NULL ELSE last_error END,
                updated_at=CURRENT_TIMESTAMP
          WHERE provisioning_id=?1 AND tenant_id=?2`
      )
      .bind(run.provisioning_id, tenantId)
  ]);
}

export async function processTenantDataPlaneProvisioning(
  db,
  { jobId, tenantId, env },
  { fetchImpl = fetch } = {}
) {
  const config = runtimeConfig(env);
  if (!config) return { outcome: 'queued', reason: 'cloudflare_platform_unconfigured' };
  const claimed = await claimJob(db, jobId);
  if (!claimed) return { outcome: 'busy', jobId };

  try {
    const state = await providerState(db, tenantId);
    if (!state) throw new CloudflarePlatformError('tenant_data_plane_state_missing', 500);
    if (state.dispatch_namespace !== config.dispatchNamespace) {
      throw new CloudflarePlatformError('tenant_dispatch_namespace_mismatch', 500);
    }

    await db
      .prepare(
        `UPDATE tenant_data_plane_provider_state
            SET worker_status=CASE WHEN worker_status='active' THEN 'active' ELSE 'provisioning' END,
                database_status=CASE WHEN database_status='active' THEN 'active' ELSE 'provisioning' END,
                last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?1`
      )
      .bind(tenantId)
      .run();

    await assertDispatchNamespace(config, { fetchImpl });
    const database = state.d1_database_id
      ? { databaseId: state.d1_database_id, databaseName: state.d1_database_name, created: false }
      : await ensureD1Database(
          { ...config, databaseName: state.d1_database_name },
          { fetchImpl }
        );
    await persistDatabase(db, tenantId, database);

    const worker = await uploadTenantBootstrapWorker(
      {
        ...config,
        scriptName: state.worker_script_name,
        databaseId: database.databaseId,
        tenantId
      },
      { fetchImpl }
    );
    await persistWorker(db, tenantId, worker);
    await finishJob(db, jobId);
    await markDataPlaneCheckpointReady(db, tenantId);

    return {
      outcome: 'success',
      jobId,
      createdDatabase: database.created === true,
      state: publicTenantDataPlaneState(await providerState(db, tenantId))
    };
  } catch (error) {
    const safeCode =
      error instanceof CloudflarePlatformError ? error.code : 'cloudflare_platform_operation_failed';
    await failJob(db, jobId, tenantId, safeCode);
    return { outcome: 'failed', jobId, error: safeCode };
  }
}

export async function runDueDataPlaneJobs(
  env,
  { fetchImpl = fetch, limit = 3 } = {}
) {
  if (!env.CATALOG_DB) return { enabled: false, reason: 'database_unbound', processed: 0 };
  if (!cloudflarePlatformConfigured(env)) {
    return { enabled: false, reason: 'cloudflare_platform_unconfigured', processed: 0 };
  }
  const db = env.CATALOG_DB;
  const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 3, 1), 5);

  await db
    .prepare(
      `UPDATE tenant_data_plane_jobs
          SET status='failed', next_attempt_at=CURRENT_TIMESTAMP,
              finished_at=CURRENT_TIMESTAMP, last_error_code='data_plane_job_stale_reclaimed',
              updated_at=CURRENT_TIMESTAMP
        WHERE status='running' AND updated_at <= datetime(CURRENT_TIMESTAMP,'-20 minutes')`
    )
    .run();

  const due = await db
    .prepare(
      `SELECT job_id, tenant_id
         FROM tenant_data_plane_jobs
        WHERE operation='provision' AND status IN ('pending','failed')
          AND attempt_count < ?1
          AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
        ORDER BY created_at ASC
        LIMIT ?2`
    )
    .bind(MAX_AUTOMATIC_ATTEMPTS, boundedLimit)
    .all();

  const outcomes = [];
  for (const job of due.results || []) {
    const result = await processTenantDataPlaneProvisioning(
      db,
      { jobId: job.job_id, tenantId: job.tenant_id, env },
      { fetchImpl }
    );
    outcomes.push({ jobId: job.job_id, tenantId: job.tenant_id, outcome: result.outcome, error: result.error || null });
  }

  return {
    enabled: true,
    selected: (due.results || []).length,
    processed: outcomes.length,
    succeeded: outcomes.filter((entry) => entry.outcome === 'success').length,
    failed: outcomes.filter((entry) => entry.outcome === 'failed').length,
    outcomes
  };
}
