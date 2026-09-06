import { stableOpaqueId } from './runtime-identity.js';
import { TENANT_CATALOG_RUNTIME_VERSION } from './tenant-catalog-runtime.js';
import {
  smokeTenantRuntime,
  tenantDispatchConfigured,
  TenantDispatchError
} from './tenant-dispatch.js';
import { maybeAdvanceTenantToPublish } from './tenant-publish-gate.js';

const DEFAULT_DISPATCH_NAMESPACE = 'catalog-engine-production';
const MAX_AUTOMATIC_ATTEMPTS = 6;

function runtimeConfig(env) {
  const accountId = String(env.CLOUDFLARE_PLATFORM_ACCOUNT_ID || '').trim();
  const apiToken = String(env.CLOUDFLARE_PLATFORM_API_TOKEN || '').trim();
  const dispatchNamespace = String(
    env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || DEFAULT_DISPATCH_NAMESPACE
  ).trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId) || apiToken.length < 20 || !dispatchNamespace) return null;
  return { dispatchNamespace };
}

async function runtimeJobId(tenantId) {
  return stableOpaqueId('rtjob', `${tenantId}:v${TENANT_CATALOG_RUNTIME_VERSION}`);
}

async function discoverCandidates(db, limit) {
  const result = await db
    .prepare(
      `SELECT DISTINCT r.tenant_id
         FROM tenant_provisioning_runs r
         JOIN tenant_catalog_instances i ON i.tenant_id=r.tenant_id
         JOIN tenant_data_plane_provider_state p ON p.tenant_id=r.tenant_id
         JOIN tenant_store_profiles s ON s.tenant_id=r.tenant_id
         JOIN tenant_verification_jobs v ON v.tenant_id=r.tenant_id
           AND v.status='success'
        WHERE r.current_step='domain'
          AND r.status IN ('running','failed','blocked')
          AND i.status='provisioning'
          AND i.schema_version >= 3
          AND p.database_status='active'
          AND p.worker_status='active'
          AND p.d1_database_id IS NOT NULL
          AND (
            p.runtime_kind!='catalog' OR
            p.runtime_status!='verified' OR
            p.runtime_version < ?1
          )
        ORDER BY r.created_at ASC
        LIMIT ?2`
    )
    .bind(TENANT_CATALOG_RUNTIME_VERSION, limit)
    .all();

  for (const row of result.results || []) {
    const jobId = await runtimeJobId(row.tenant_id);
    await db
      .prepare(
        `INSERT INTO tenant_runtime_jobs
          (job_id, tenant_id, target_runtime_version, status, attempt_count,
           next_attempt_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(job_id) DO UPDATE SET
           status=CASE
             WHEN tenant_runtime_jobs.status='success' THEN 'success'
             WHEN tenant_runtime_jobs.status='running' THEN 'running'
             WHEN tenant_runtime_jobs.status='staged' THEN 'staged'
             ELSE 'pending'
           END,
           next_attempt_at=CASE
             WHEN tenant_runtime_jobs.status='success' THEN NULL
             ELSE COALESCE(tenant_runtime_jobs.next_attempt_at,CURRENT_TIMESTAMP)
           END,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(jobId, row.tenant_id, TENANT_CATALOG_RUNTIME_VERSION)
      .run();
  }
  return (result.results || []).length;
}

async function loadContext(db, tenantId) {
  return db
    .prepare(
      `SELECT p.dispatch_namespace, p.worker_script_name,
              p.d1_database_id, p.runtime_kind, p.runtime_status, p.runtime_version,
              i.schema_version
         FROM tenant_data_plane_provider_state p
         JOIN tenant_catalog_instances i ON i.tenant_id=p.tenant_id
         JOIN tenant_store_profiles s ON s.tenant_id=p.tenant_id
        WHERE p.tenant_id=?1
          AND p.database_status='active'
          AND p.worker_status='active'
          AND p.d1_database_id IS NOT NULL
        LIMIT 1`
    )
    .bind(tenantId)
    .first();
}

async function claimJob(db, job) {
  const result = await db
    .prepare(
      `UPDATE tenant_runtime_jobs
          SET status='running',
              started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
              finished_at=NULL, last_error_code=NULL,
              updated_at=CURRENT_TIMESTAMP
        WHERE job_id=?1
          AND status='staged'
          AND attempt_count < ?2`
    )
    .bind(job.job_id, MAX_AUTOMATIC_ATTEMPTS)
    .run();
  return Number(result.meta?.changes || 0) === 1;
}

async function markVerified(db, job, smoke) {
  await db.batch([
    db
      .prepare(
        `UPDATE tenant_data_plane_provider_state
            SET runtime_kind='catalog', runtime_status='verified', runtime_version=?2,
                runtime_verified_at=CURRENT_TIMESTAMP,
                runtime_last_error_code=NULL, last_checked_at=CURRENT_TIMESTAMP,
                updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?1`
      )
      .bind(job.tenant_id, TENANT_CATALOG_RUNTIME_VERSION),
    db
      .prepare(
        `UPDATE tenant_runtime_jobs
            SET status='success', next_attempt_at=NULL,
                finished_at=CURRENT_TIMESTAMP, last_error_code=NULL,
                updated_at=CURRENT_TIMESTAMP
          WHERE job_id=?1`
      )
      .bind(job.job_id),
    db
      .prepare(
        `INSERT INTO tenant_audit_log
          (tenant_id, principal_id, action, target_type, target_id, metadata_json, created_at)
         SELECT ?1, NULL, 'tenant.runtime.verified', 'tenant_runtime', ?1, ?2, CURRENT_TIMESTAMP
          WHERE NOT EXISTS (
            SELECT 1 FROM tenant_audit_log
             WHERE tenant_id=?1 AND action='tenant.runtime.verified' AND metadata_json=?2
          )`
      )
      .bind(
        job.tenant_id,
        JSON.stringify({ runtimeVersion: TENANT_CATALOG_RUNTIME_VERSION, products: smoke.products })
      )
  ]);
  await maybeAdvanceTenantToPublish(db, job.tenant_id);
}

async function failJob(db, job, safeCode) {
  await db.batch([
    db
      .prepare(
        `UPDATE tenant_runtime_jobs
            SET status='failed', finished_at=CURRENT_TIMESTAMP,
                next_attempt_at=datetime(CURRENT_TIMESTAMP,'+10 minutes'),
                last_error_code=?2, updated_at=CURRENT_TIMESTAMP
          WHERE job_id=?1`
      )
      .bind(job.job_id, safeCode),
    db
      .prepare(
        `UPDATE tenant_data_plane_provider_state
            SET runtime_status='error', runtime_last_error_code=?2,
                last_checked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?1`
      )
      .bind(job.tenant_id, safeCode)
  ]);
}

function safeError(error) {
  if (error instanceof TenantDispatchError) return error.code;
  return 'tenant_runtime_activation_failed';
}

export async function processTenantRuntime(db, { job, env }) {
  const platform = runtimeConfig(env);
  if (!platform) return { outcome: 'queued', reason: 'cloudflare_platform_unconfigured' };
  const context = await loadContext(db, job.tenant_id);
  if (!context?.d1_database_id || !context.worker_script_name) {
    return { outcome: 'blocked', reason: 'tenant_data_plane_not_ready' };
  }
  if (context.dispatch_namespace !== platform.dispatchNamespace) {
    return { outcome: 'failed', error: 'tenant_dispatch_namespace_mismatch' };
  }
  if (Number(context.schema_version || 0) < 3) {
    return { outcome: 'blocked', reason: 'tenant_schema_not_ready' };
  }

  const stagedByTrustedCi =
    context.runtime_kind === 'catalog' &&
    context.runtime_status === 'staged' &&
    Number(context.runtime_version || 0) === TENANT_CATALOG_RUNTIME_VERSION;
  if (!stagedByTrustedCi) {
    return { outcome: 'queued', reason: 'awaiting_trusted_runtime_stage' };
  }
  if (!(await claimJob(db, job))) {
    return { outcome: 'busy', jobId: job.job_id };
  }

  try {
    if (!tenantDispatchConfigured(env)) {
      await db
        .prepare(
          `UPDATE tenant_runtime_jobs
              SET status='staged', next_attempt_at=datetime(CURRENT_TIMESTAMP,'+10 minutes'),
                  updated_at=CURRENT_TIMESTAMP
            WHERE job_id=?1`
        )
        .bind(job.job_id)
        .run();
      return { outcome: 'staged', jobId: job.job_id, reason: 'tenant_dispatch_unbound' };
    }

    const smoke = await smokeTenantRuntime(
      env,
      context.worker_script_name,
      TENANT_CATALOG_RUNTIME_VERSION
    );
    await markVerified(db, job, smoke);
    return { outcome: 'success', jobId: job.job_id, ...smoke };
  } catch (error) {
    const code = safeError(error);
    await failJob(db, job, code);
    return { outcome: 'failed', jobId: job.job_id, error: code };
  }
}

export async function runDueTenantRuntimes(env, { limit = 1 } = {}) {
  if (!env.CATALOG_DB) return { enabled: false, reason: 'database_unbound', processed: 0 };
  if (!runtimeConfig(env)) {
    return { enabled: false, reason: 'cloudflare_platform_unconfigured', processed: 0 };
  }
  const db = env.CATALOG_DB;
  const bounded = Math.min(Math.max(Number.parseInt(limit, 10) || 1, 1), 2);
  const discovered = await discoverCandidates(db, bounded);

  await db
    .prepare(
      `UPDATE tenant_runtime_jobs
          SET status='failed', next_attempt_at=CURRENT_TIMESTAMP,
              finished_at=CURRENT_TIMESTAMP, last_error_code='tenant_runtime_job_stale_reclaimed',
              updated_at=CURRENT_TIMESTAMP
        WHERE status='running' AND updated_at <= datetime(CURRENT_TIMESTAMP,'-20 minutes')`
    )
    .run();

  const due = await db
    .prepare(
      `SELECT j.job_id, j.tenant_id, j.target_runtime_version, j.status
         FROM tenant_runtime_jobs j
        WHERE j.status='staged'
          AND j.attempt_count < ?1
          AND j.target_runtime_version=?2
          AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= CURRENT_TIMESTAMP)
          AND EXISTS (
            SELECT 1 FROM tenant_store_profiles s
             WHERE s.tenant_id=j.tenant_id
          )
          AND EXISTS (
            SELECT 1 FROM tenant_catalog_instances i
             WHERE i.tenant_id=j.tenant_id
               AND i.status='provisioning'
               AND i.schema_version >= 3
          )
          AND EXISTS (
            SELECT 1 FROM tenant_data_plane_provider_state p
             WHERE p.tenant_id=j.tenant_id
               AND p.database_status='active'
               AND p.worker_status='active'
               AND p.d1_database_id IS NOT NULL
               AND p.runtime_kind='catalog'
               AND p.runtime_status='staged'
               AND p.runtime_version=?2
          )
          AND EXISTS (
            SELECT 1 FROM tenant_verification_jobs v
             WHERE v.tenant_id=j.tenant_id
               AND v.status='success'
          )
          AND EXISTS (
            SELECT 1 FROM tenant_provisioning_runs r
             WHERE r.tenant_id=j.tenant_id
               AND r.current_step='domain'
               AND r.status IN ('running','failed','blocked')
          )
        ORDER BY j.created_at ASC
        LIMIT ?3`
    )
    .bind(MAX_AUTOMATIC_ATTEMPTS, TENANT_CATALOG_RUNTIME_VERSION, bounded)
    .all();

  const outcomes = [];
  for (const job of due.results || []) {
    const result = await processTenantRuntime(db, { job, env });
    outcomes.push({ tenantId: job.tenant_id, jobId: job.job_id, ...result });
  }
  return {
    enabled: true,
    discovered,
    selected: (due.results || []).length,
    processed: outcomes.length,
    staged: outcomes.filter((item) => item.outcome === 'staged').length,
    succeeded: outcomes.filter((item) => item.outcome === 'success').length,
    failed: outcomes.filter((item) => item.outcome === 'failed').length,
    outcomes
  };
}