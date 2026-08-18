import { CloudflarePlatformError, queryD1Batch } from './cloudflare-platform.js';
import { stableOpaqueId } from './runtime-identity.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  tenantDataPlaneCurrentBatch
} from './tenant-data-plane-schema-v2.js';

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

async function migrationJobId(tenantId, version) {
  return stableOpaqueId('dpmig', `${tenantId}:v${version}`);
}

async function discoverMigrationCandidates(db, targetVersion, limit) {
  const result = await db
    .prepare(
      `SELECT DISTINCT r.tenant_id
         FROM tenant_provisioning_runs r
         JOIN tenant_catalog_instances i ON i.tenant_id=r.tenant_id
         JOIN tenant_data_plane_provider_state p ON p.tenant_id=r.tenant_id
         JOIN supplier_sources s ON s.tenant_id=r.tenant_id AND s.status='active'
        WHERE r.current_step='migrations'
          AND r.status IN ('running','failed','blocked')
          AND i.schema_version < ?1
          AND p.database_status='active'
          AND p.worker_status='active'
          AND p.d1_database_id IS NOT NULL
        ORDER BY r.created_at ASC
        LIMIT ?2`
    )
    .bind(targetVersion, limit)
    .all();

  for (const row of result.results || []) {
    const jobId = await migrationJobId(row.tenant_id, targetVersion);
    await db
      .prepare(
        `INSERT INTO tenant_data_plane_migration_jobs
          (job_id, tenant_id, target_schema_version, status, attempt_count, next_attempt_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(job_id) DO UPDATE SET
           status=CASE
             WHEN tenant_data_plane_migration_jobs.status IN ('running','success') THEN tenant_data_plane_migration_jobs.status
             ELSE 'pending'
           END,
           next_attempt_at=CASE
             WHEN tenant_data_plane_migration_jobs.status IN ('running','success') THEN tenant_data_plane_migration_jobs.next_attempt_at
             ELSE CURRENT_TIMESTAMP
           END,
           last_error_code=CASE
             WHEN tenant_data_plane_migration_jobs.status IN ('running','success') THEN tenant_data_plane_migration_jobs.last_error_code
             ELSE NULL
           END,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(jobId, row.tenant_id, targetVersion)
      .run();
  }
  return (result.results || []).length;
}

async function migrationContext(db, tenantId) {
  return db
    .prepare(
      `SELECT p.d1_database_id, p.dispatch_namespace,
              s.source_key, s.provider AS source_provider, s.source_url,
              s.sync_strategy, s.removal_miss_threshold,
              r.provisioning_id
         FROM tenant_data_plane_provider_state p
         JOIN supplier_sources s ON s.tenant_id=p.tenant_id AND s.status='active'
         LEFT JOIN tenant_provisioning_runs r ON r.provisioning_id=(
           SELECT r2.provisioning_id
             FROM tenant_provisioning_runs r2
            WHERE r2.tenant_id=p.tenant_id
            ORDER BY r2.created_at DESC
            LIMIT 1
         )
        WHERE p.tenant_id=?1
          AND p.database_status='active'
          AND p.worker_status='active'
        ORDER BY s.created_at ASC
        LIMIT 1`
    )
    .bind(tenantId)
    .first();
}

async function claimMigration(db, job) {
  const result = await db
    .prepare(
      `UPDATE tenant_data_plane_migration_jobs
          SET status='running', attempt_count=attempt_count+1,
              started_at=COALESCE(started_at,CURRENT_TIMESTAMP), finished_at=NULL,
              last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE job_id=?1 AND status IN ('pending','failed') AND attempt_count < ?2`
    )
    .bind(job.job_id, MAX_AUTOMATIC_ATTEMPTS)
    .run();
  if (Number(result.meta?.changes || 0) < 1) return false;

  if (job.provisioning_id) {
    await db.batch([
      db
        .prepare(
          `UPDATE tenant_provisioning_steps
              SET status='running', attempt_count=attempt_count+1,
                  started_at=COALESCE(started_at,CURRENT_TIMESTAMP), finished_at=NULL,
                  last_error=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND step_key='migrations'`
        )
        .bind(job.provisioning_id),
      db
        .prepare(
          `UPDATE tenant_provisioning_runs
              SET status='running', current_step='migrations', last_error=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND tenant_id=?2`
        )
        .bind(job.provisioning_id, job.tenant_id)
    ]);
  }
  return true;
}

async function finishMigration(db, job, version) {
  const statements = [
    db
      .prepare(
        `UPDATE tenant_data_plane_migration_jobs
            SET status='success', finished_at=CURRENT_TIMESTAMP, next_attempt_at=NULL,
                last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE job_id=?1`
      )
      .bind(job.job_id),
    db
      .prepare(
        `UPDATE tenant_catalog_instances
            SET schema_version=?2, status='provisioning', last_migration_at=CURRENT_TIMESTAMP,
                last_error=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?1`
      )
      .bind(job.tenant_id, version)
  ];
  if (job.provisioning_id) {
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_steps
              SET status='success', finished_at=CURRENT_TIMESTAMP, last_error=NULL,
                  metadata_json=?2, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND step_key='migrations'`
        )
        .bind(job.provisioning_id, JSON.stringify({ schemaVersion: version, isolated: true }))
    );
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_runs
              SET status='running', current_step='import', last_error=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND tenant_id=?2 AND current_step='migrations'`
        )
        .bind(job.provisioning_id, job.tenant_id)
    );
  }
  await db.batch(statements);
}

async function failMigration(db, job, safeCode) {
  const statements = [
    db
      .prepare(
        `UPDATE tenant_data_plane_migration_jobs
            SET status='failed', finished_at=CURRENT_TIMESTAMP,
                next_attempt_at=datetime(CURRENT_TIMESTAMP,'+10 minutes'),
                last_error_code=?2, updated_at=CURRENT_TIMESTAMP
          WHERE job_id=?1`
      )
      .bind(job.job_id, safeCode),
    db
      .prepare(
        `UPDATE tenant_catalog_instances
            SET status='provisioning', last_error=?2, updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?1`
      )
      .bind(job.tenant_id, safeCode)
  ];
  if (job.provisioning_id) {
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_steps
              SET status='failed', finished_at=CURRENT_TIMESTAMP, last_error=?2,
                  updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND step_key='migrations'`
        )
        .bind(job.provisioning_id, safeCode)
    );
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_runs
              SET status='failed', current_step='migrations', last_error=?2, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND tenant_id=?3`
        )
        .bind(job.provisioning_id, safeCode, job.tenant_id)
    );
  }
  await db.batch(statements);
}

function verifyMigrationResult(result, tenantId, expectedVersion) {
  if (!Array.isArray(result) || result.length !== 2) return false;
  const identity = result[0]?.results?.[0];
  const source = result[1]?.results?.[0];
  return (
    identity?.tenant_id === tenantId &&
    Number(identity?.schema_version) === expectedVersion &&
    Number(source?.total) === 1
  );
}

export async function processTenantDataPlaneMigration(
  db,
  { job, env },
  { fetchImpl = fetch } = {}
) {
  const config = runtimeConfig(env);
  if (!config) return { outcome: 'queued', reason: 'cloudflare_platform_unconfigured' };
  const context = await migrationContext(db, job.tenant_id);
  if (!context?.d1_database_id) return { outcome: 'blocked', reason: 'tenant_database_not_ready' };
  const enrichedJob = { ...job, provisioning_id: context.provisioning_id || null };
  if (!(await claimMigration(db, enrichedJob))) return { outcome: 'busy', jobId: job.job_id };

  try {
    if (context.dispatch_namespace !== config.dispatchNamespace) {
      throw new CloudflarePlatformError('tenant_dispatch_namespace_mismatch', 500);
    }
    const source = {
      sourceKey: context.source_key,
      provider: context.source_provider,
      sourceUrl: context.source_url,
      syncStrategy: context.sync_strategy,
      removalMissThreshold: Number(context.removal_miss_threshold || 3)
    };
    const batch = tenantDataPlaneCurrentBatch({ tenantId: job.tenant_id, source });
    await queryD1Batch(
      {
        ...config,
        databaseId: context.d1_database_id,
        batch
      },
      { fetchImpl }
    );
    const verification = await queryD1Batch(
      {
        ...config,
        databaseId: context.d1_database_id,
        batch: [
          {
            sql: 'SELECT tenant_id, schema_version FROM data_plane_identity WHERE tenant_id=?1 LIMIT 1',
            params: [job.tenant_id]
          },
          {
            sql: 'SELECT COUNT(*) AS total FROM supplier_sources WHERE tenant_id=?1 AND source_key=?2 AND status=\'active\'',
            params: [job.tenant_id, context.source_key]
          }
        ]
      },
      { fetchImpl }
    );
    if (!verifyMigrationResult(verification, job.tenant_id, job.target_schema_version)) {
      throw new CloudflarePlatformError('tenant_d1_migration_verification_failed', 502);
    }

    await finishMigration(db, enrichedJob, job.target_schema_version);
    return { outcome: 'success', jobId: job.job_id, schemaVersion: job.target_schema_version };
  } catch (error) {
    const safeCode =
      error instanceof CloudflarePlatformError ? error.code : 'tenant_d1_migration_failed';
    await failMigration(db, enrichedJob, safeCode);
    return { outcome: 'failed', jobId: job.job_id, error: safeCode };
  }
}

export async function runDueDataPlaneMigrations(
  env,
  { fetchImpl = fetch, limit = 2 } = {}
) {
  if (!env.CATALOG_DB) return { enabled: false, reason: 'database_unbound', processed: 0 };
  const config = runtimeConfig(env);
  if (!config) return { enabled: false, reason: 'cloudflare_platform_unconfigured', processed: 0 };
  const db = env.CATALOG_DB;
  const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 2, 1), 3);

  const discovered = await discoverMigrationCandidates(
    db,
    TENANT_DATA_PLANE_SCHEMA_VERSION,
    boundedLimit
  );

  await db
    .prepare(
      `UPDATE tenant_data_plane_migration_jobs
          SET status='failed', next_attempt_at=CURRENT_TIMESTAMP,
              finished_at=CURRENT_TIMESTAMP, last_error_code='migration_job_stale_reclaimed',
              updated_at=CURRENT_TIMESTAMP
        WHERE status='running' AND updated_at <= datetime(CURRENT_TIMESTAMP,'-20 minutes')`
    )
    .run();

  const due = await db
    .prepare(
      `SELECT j.job_id, j.tenant_id, j.target_schema_version, r.provisioning_id
         FROM tenant_data_plane_migration_jobs j
         LEFT JOIN tenant_provisioning_runs r ON r.provisioning_id=(
           SELECT r2.provisioning_id FROM tenant_provisioning_runs r2
            WHERE r2.tenant_id=j.tenant_id ORDER BY r2.created_at DESC LIMIT 1
         )
        WHERE j.status IN ('pending','failed')
          AND j.attempt_count < ?1
          AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= CURRENT_TIMESTAMP)
        ORDER BY j.created_at ASC
        LIMIT ?2`
    )
    .bind(MAX_AUTOMATIC_ATTEMPTS, boundedLimit)
    .all();

  const outcomes = [];
  for (const job of due.results || []) {
    const result = await processTenantDataPlaneMigration(db, { job, env }, { fetchImpl });
    outcomes.push({
      jobId: job.job_id,
      tenantId: job.tenant_id,
      outcome: result.outcome,
      error: result.error || null
    });
  }

  return {
    enabled: true,
    discovered,
    selected: (due.results || []).length,
    processed: outcomes.length,
    succeeded: outcomes.filter((entry) => entry.outcome === 'success').length,
    failed: outcomes.filter((entry) => entry.outcome === 'failed').length,
    outcomes
  };
}
