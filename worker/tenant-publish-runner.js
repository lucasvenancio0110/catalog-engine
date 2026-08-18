import { CATALOG_CLASSIFIER_VERSION } from '../src/domain/catalog-classifier.js';
import { stableOpaqueId } from './runtime-identity.js';
import {
  smokeTenantRuntime,
  tenantDispatchConfigured,
  TenantDispatchError
} from './tenant-dispatch.js';
import { TENANT_CATALOG_RUNTIME_VERSION } from './tenant-catalog-runtime.js';

const MAX_AUTOMATIC_ATTEMPTS = 5;

async function publishJobId(tenantId) {
  return stableOpaqueId('pubjob', `${tenantId}:initial-publish`);
}

async function discoverCandidates(db, limit) {
  const result = await db
    .prepare(
      `SELECT DISTINCT r.tenant_id
         FROM tenant_provisioning_runs r
         JOIN tenant_catalog_instances i ON i.tenant_id=r.tenant_id
         JOIN tenant_store_profiles s ON s.tenant_id=r.tenant_id
         JOIN tenant_data_plane_provider_state p ON p.tenant_id=r.tenant_id
         JOIN tenant_verification_jobs v ON v.tenant_id=r.tenant_id
           AND v.status='success' AND v.classifier_version=?1
         JOIN tenant_domains d ON d.domain_id=(
           SELECT d2.domain_id
             FROM tenant_domains d2
            WHERE d2.tenant_id=r.tenant_id
              AND d2.domain_type='custom'
              AND d2.status='active'
            ORDER BY d2.updated_at DESC
            LIMIT 1
         )
         JOIN tenant_domain_provider_state ds ON ds.domain_id=d.domain_id
        WHERE r.current_step='publish'
          AND r.status IN ('running','failed','blocked')
          AND i.status='provisioning'
          AND s.setup_status!='suspended'
          AND p.worker_status='active'
          AND p.runtime_kind='catalog'
          AND p.runtime_status='verified'
          AND p.runtime_version>=?2
          AND ds.provider_status='active'
          AND ds.ssl_status='active'
        ORDER BY r.created_at ASC
        LIMIT ?3`
    )
    .bind(CATALOG_CLASSIFIER_VERSION, TENANT_CATALOG_RUNTIME_VERSION, limit)
    .all();

  for (const row of result.results || []) {
    const jobId = await publishJobId(row.tenant_id);
    await db
      .prepare(
        `INSERT INTO tenant_publish_jobs
          (job_id, tenant_id, status, attempt_count, next_attempt_at, created_at, updated_at)
         VALUES (?1, ?2, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(job_id) DO UPDATE SET
           status=CASE
             WHEN tenant_publish_jobs.status IN ('running','success') THEN tenant_publish_jobs.status
             ELSE 'pending'
           END,
           next_attempt_at=CASE
             WHEN tenant_publish_jobs.status='success' THEN NULL
             ELSE CURRENT_TIMESTAMP
           END,
           last_error_code=CASE
             WHEN tenant_publish_jobs.status='success' THEN tenant_publish_jobs.last_error_code
             ELSE NULL
           END,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(jobId, row.tenant_id)
      .run();
  }
  return (result.results || []).length;
}

async function loadContext(db, tenantId) {
  return db
    .prepare(
      `SELECT r.provisioning_id, r.current_step,
              i.status AS data_plane_status, i.schema_version,
              s.setup_status,
              p.worker_script_name, p.worker_status,
              p.runtime_kind, p.runtime_status, p.runtime_version,
              d.domain_id, d.hostname, d.status AS domain_status,
              ds.provider_status, ds.ssl_status,
              v.status AS verification_status, v.classifier_version,
              v.finding_count
         FROM tenant_provisioning_runs r
         JOIN tenant_catalog_instances i ON i.tenant_id=r.tenant_id
         JOIN tenant_store_profiles s ON s.tenant_id=r.tenant_id
         JOIN tenant_data_plane_provider_state p ON p.tenant_id=r.tenant_id
         LEFT JOIN tenant_domains d ON d.domain_id=(
           SELECT d2.domain_id
             FROM tenant_domains d2
            WHERE d2.tenant_id=r.tenant_id
              AND d2.domain_type='custom'
              AND d2.status!='disabled'
            ORDER BY CASE d2.status WHEN 'active' THEN 0 ELSE 1 END, d2.updated_at DESC
            LIMIT 1
         )
         LEFT JOIN tenant_domain_provider_state ds ON ds.domain_id=d.domain_id
         LEFT JOIN tenant_verification_jobs v ON v.job_id=(
           SELECT v2.job_id
             FROM tenant_verification_jobs v2
            WHERE v2.tenant_id=r.tenant_id
            ORDER BY v2.created_at DESC
            LIMIT 1
         )
        WHERE r.provisioning_id=(
          SELECT r2.provisioning_id
            FROM tenant_provisioning_runs r2
           WHERE r2.tenant_id=?1
           ORDER BY r2.created_at DESC
           LIMIT 1
        )
        LIMIT 1`
    )
    .bind(tenantId)
    .first();
}

function validateContext(context) {
  if (!context?.provisioning_id || context.current_step !== 'publish') {
    return 'tenant_publish_checkpoint_mismatch';
  }
  if (context.data_plane_status !== 'provisioning' || Number(context.schema_version || 0) < 3) {
    return 'tenant_publish_data_plane_not_ready';
  }
  if (context.setup_status === 'suspended') return 'tenant_publish_store_suspended';
  if (
    context.worker_status !== 'active' ||
    context.runtime_kind !== 'catalog' ||
    context.runtime_status !== 'verified' ||
    Number(context.runtime_version || 0) < TENANT_CATALOG_RUNTIME_VERSION ||
    !context.worker_script_name
  ) {
    return 'tenant_publish_runtime_not_ready';
  }
  if (
    context.verification_status !== 'success' ||
    Number(context.classifier_version || 0) !== CATALOG_CLASSIFIER_VERSION ||
    Number(context.finding_count || 0) !== 0
  ) {
    return 'tenant_publish_verification_not_ready';
  }
  if (
    !context.domain_id ||
    context.domain_status !== 'active' ||
    context.provider_status !== 'active' ||
    context.ssl_status !== 'active'
  ) {
    return 'tenant_publish_domain_not_ready';
  }
  return null;
}

async function claimJob(db, job, context) {
  const result = await db
    .prepare(
      `UPDATE tenant_publish_jobs
          SET status='running', attempt_count=attempt_count+1,
              started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
              finished_at=NULL, last_error_code=NULL,
              updated_at=CURRENT_TIMESTAMP
        WHERE job_id=?1 AND status IN ('pending','failed') AND attempt_count < ?2`
    )
    .bind(job.job_id, MAX_AUTOMATIC_ATTEMPTS)
    .run();
  if (Number(result.meta?.changes || 0) !== 1) return false;
  await db.batch([
    db
      .prepare(
        `UPDATE tenant_provisioning_steps
            SET status='running',
                attempt_count=CASE WHEN attempt_count < 1 THEN 1 ELSE attempt_count END,
                started_at=COALESCE(started_at,CURRENT_TIMESTAMP), finished_at=NULL,
                last_error=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE provisioning_id=?1 AND step_key='publish'`
      )
      .bind(context.provisioning_id),
    db
      .prepare(
        `UPDATE tenant_provisioning_runs
            SET status='running', current_step='publish', last_error=NULL,
                updated_at=CURRENT_TIMESTAMP
          WHERE provisioning_id=?1 AND tenant_id=?2`
      )
      .bind(context.provisioning_id, job.tenant_id)
  ]);
  return true;
}

async function finishPublish(db, job, context, smoke) {
  const metadata = JSON.stringify({
    runtimeVersion: smoke.runtimeVersion,
    schemaVersion: smoke.schemaVersion,
    products: smoke.products,
    domainId: context.domain_id
  });
  await db.batch([
    db
      .prepare(
        `UPDATE tenant_catalog_instances
            SET status='ready', last_error=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?1 AND status='provisioning'`
      )
      .bind(job.tenant_id),
    db
      .prepare(
        `UPDATE tenant_store_profiles
            SET setup_status='published', published_at=COALESCE(published_at,CURRENT_TIMESTAMP),
                updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?1 AND setup_status!='suspended'`
      )
      .bind(job.tenant_id),
    db
      .prepare(
        `UPDATE catalog_tenants
            SET status='active', updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?1`
      )
      .bind(job.tenant_id),
    db
      .prepare(
        `UPDATE tenant_provisioning_steps
            SET status='success',
                attempt_count=CASE WHEN attempt_count < 1 THEN 1 ELSE attempt_count END,
                started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
                finished_at=CURRENT_TIMESTAMP, last_error=NULL,
                metadata_json=?2, updated_at=CURRENT_TIMESTAMP
          WHERE provisioning_id=?1 AND step_key='publish'`
      )
      .bind(context.provisioning_id, metadata),
    db
      .prepare(
        `UPDATE tenant_provisioning_runs
            SET status='success', current_step='publish',
                finished_at=CURRENT_TIMESTAMP, last_error=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE provisioning_id=?1 AND tenant_id=?2 AND current_step='publish'`
      )
      .bind(context.provisioning_id, job.tenant_id),
    db
      .prepare(
        `UPDATE tenant_publish_jobs
            SET status='success', next_attempt_at=NULL, finished_at=CURRENT_TIMESTAMP,
                last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE job_id=?1`
      )
      .bind(job.job_id),
    db
      .prepare(
        `INSERT INTO tenant_audit_log
          (tenant_id, principal_id, action, target_type, target_id, metadata_json, created_at)
         SELECT ?1, NULL, 'tenant.store.published', 'tenant', ?1, ?2, CURRENT_TIMESTAMP
          WHERE NOT EXISTS (
            SELECT 1 FROM tenant_audit_log
             WHERE tenant_id=?1 AND action='tenant.store.published'
          )`
      )
      .bind(job.tenant_id, metadata)
  ]);
}

async function failJob(db, job, context, safeCode) {
  const statements = [
    db
      .prepare(
        `UPDATE tenant_publish_jobs
            SET status='failed', finished_at=CURRENT_TIMESTAMP,
                next_attempt_at=datetime(CURRENT_TIMESTAMP,'+10 minutes'),
                last_error_code=?2, updated_at=CURRENT_TIMESTAMP
          WHERE job_id=?1`
      )
      .bind(job.job_id, safeCode)
  ];
  if (context?.provisioning_id) {
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_steps
              SET status='failed', finished_at=CURRENT_TIMESTAMP,
                  last_error=?2, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND step_key='publish'`
        )
        .bind(context.provisioning_id, safeCode)
    );
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_runs
              SET status='failed', current_step='publish', last_error=?2,
                  updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND tenant_id=?3`
        )
        .bind(context.provisioning_id, safeCode, job.tenant_id)
    );
  }
  await db.batch(statements);
}

export async function processTenantPublish(db, { job, env }) {
  const context = await loadContext(db, job.tenant_id);
  const contextError = validateContext(context);
  if (contextError) return { outcome: 'blocked', reason: contextError };
  if (!tenantDispatchConfigured(env)) return { outcome: 'blocked', reason: 'tenant_dispatch_unbound' };
  if (!(await claimJob(db, job, context))) return { outcome: 'busy', jobId: job.job_id };

  try {
    const smoke = await smokeTenantRuntime(
      env,
      context.worker_script_name,
      TENANT_CATALOG_RUNTIME_VERSION
    );
    await finishPublish(db, job, context, smoke);
    return { outcome: 'success', jobId: job.job_id, hostname: context.hostname, ...smoke };
  } catch (error) {
    const safeCode =
      error instanceof TenantDispatchError ? error.code : 'tenant_publish_smoke_failed';
    await failJob(db, job, context, safeCode);
    return { outcome: 'failed', jobId: job.job_id, error: safeCode };
  }
}

export async function runDueTenantPublishes(env, { limit = 1 } = {}) {
  if (!env.CATALOG_DB) return { enabled: false, reason: 'database_unbound', processed: 0 };
  if (!tenantDispatchConfigured(env)) {
    return { enabled: false, reason: 'tenant_dispatch_unbound', processed: 0 };
  }
  const db = env.CATALOG_DB;
  const bounded = Math.min(Math.max(Number.parseInt(limit, 10) || 1, 1), 2);
  const discovered = await discoverCandidates(db, bounded);

  await db
    .prepare(
      `UPDATE tenant_publish_jobs
          SET status='failed', next_attempt_at=CURRENT_TIMESTAMP,
              finished_at=CURRENT_TIMESTAMP, last_error_code='tenant_publish_job_stale_reclaimed',
              updated_at=CURRENT_TIMESTAMP
        WHERE status='running' AND updated_at <= datetime(CURRENT_TIMESTAMP,'-10 minutes')`
    )
    .run();

  const due = await db
    .prepare(
      `SELECT job_id, tenant_id
         FROM tenant_publish_jobs
        WHERE status IN ('pending','failed')
          AND attempt_count < ?1
          AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
        ORDER BY created_at ASC
        LIMIT ?2`
    )
    .bind(MAX_AUTOMATIC_ATTEMPTS, bounded)
    .all();

  const outcomes = [];
  for (const job of due.results || []) {
    const result = await processTenantPublish(db, { job, env });
    outcomes.push({ tenantId: job.tenant_id, jobId: job.job_id, ...result });
  }
  return {
    enabled: true,
    discovered,
    selected: (due.results || []).length,
    processed: outcomes.length,
    succeeded: outcomes.filter((item) => item.outcome === 'success').length,
    failed: outcomes.filter((item) => item.outcome === 'failed').length,
    blocked: outcomes.filter((item) => item.outcome === 'blocked').length,
    outcomes
  };
}
