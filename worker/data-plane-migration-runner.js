import { CloudflarePlatformError, queryD1Batch } from './cloudflare-platform.js';
import { stableOpaqueId } from './runtime-identity.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  tenantDataPlaneCurrentBatch
} from './tenant-data-plane-schema-v5.js';

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

export function migrationResumeStep(currentStep = 'migrations') {
  const step = String(currentStep || 'migrations');
  if (step === 'migrations') return 'import';
  if (step === 'classify' || step === 'verify') return 'classify';
  throw new Error('tenant_data_plane_migration_resume_step_invalid');
}

export function migrationLifecycle({ provisioningId, catalogStatus, resumeStep } = {}) {
  if (String(provisioningId || '').trim()) {
    return Object.freeze({
      kind: 'onboarding',
      resumeStep: migrationResumeStep(resumeStep || 'migrations'),
      preservesAvailability: false
    });
  }
  if (String(catalogStatus || '').trim() === 'ready') {
    return Object.freeze({
      kind: 'fleet',
      resumeStep: null,
      preservesAvailability: true
    });
  }
  throw new Error('tenant_data_plane_migration_lifecycle_invalid');
}

async function migrationJobId(tenantId, version) {
  return stableOpaqueId('dpmig', `${tenantId}:v${version}`);
}

async function discoverMigrationCandidates(db, targetVersion, limit) {
  const result = await db
    .prepare(
      `SELECT DISTINCT i.tenant_id
         FROM tenant_catalog_instances i
         JOIN tenant_data_plane_provider_state p ON p.tenant_id=i.tenant_id
         JOIN supplier_sources s ON s.tenant_id=i.tenant_id AND s.status='active'
         LEFT JOIN tenant_store_profiles sp ON sp.tenant_id=i.tenant_id
        WHERE i.schema_version < ?1
          AND p.database_status='active'
          AND p.worker_status='active'
          AND p.d1_database_id IS NOT NULL
          AND (
            EXISTS (
              SELECT 1
                FROM tenant_provisioning_runs r
               WHERE r.tenant_id=i.tenant_id
                 AND r.current_step IN ('migrations','classify','verify')
                 AND r.status IN ('running','failed','blocked')
            )
            OR (
              i.status='ready'
              AND sp.setup_status IN ('ready','published')
            )
          )
        ORDER BY i.created_at ASC
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
              i.status AS catalog_status,
              r.provisioning_id, r.current_step AS resume_step
         FROM tenant_data_plane_provider_state p
         JOIN tenant_catalog_instances i ON i.tenant_id=p.tenant_id
         JOIN supplier_sources s ON s.tenant_id=p.tenant_id AND s.status='active'
         LEFT JOIN tenant_provisioning_runs r ON r.provisioning_id=(
           SELECT r2.provisioning_id
             FROM tenant_provisioning_runs r2
            WHERE r2.tenant_id=p.tenant_id
              AND r2.current_step IN ('migrations','classify','verify')
              AND r2.status IN ('running','failed','blocked')
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

  if (job.migration_kind === 'onboarding' && job.provisioning_id) {
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
      .bind(job.job_id)
  ];

  if (job.migration_kind === 'onboarding') {
    statements.push(
      db
        .prepare(
          `UPDATE tenant_catalog_instances
              SET schema_version=?2, status='provisioning', last_migration_at=CURRENT_TIMESTAMP,
                  last_error=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE tenant_id=?1`
        )
        .bind(job.tenant_id, version)
    );
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_steps
              SET status='success', finished_at=CURRENT_TIMESTAMP, last_error=NULL,
                  metadata_json=?2, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND step_key='migrations'`
        )
        .bind(
          job.provisioning_id,
          JSON.stringify({
            schemaVersion: version,
            isolated: true,
            resumeStep: job.resume_step,
            migrationKind: 'onboarding'
          })
        )
    );
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_runs
              SET status='running', current_step=?3, last_error=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND tenant_id=?2 AND current_step='migrations'`
        )
        .bind(job.provisioning_id, job.tenant_id, job.resume_step)
    );
  } else {
    statements.push(
      db
        .prepare(
          `UPDATE tenant_catalog_instances
              SET schema_version=?2, last_migration_at=CURRENT_TIMESTAMP,
                  last_error=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE tenant_id=?1`
        )
        .bind(job.tenant_id, version)
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
      .bind(job.job_id, safeCode)
  ];

  if (job.migration_kind === 'onboarding') {
    statements.push(
      db
        .prepare(
          `UPDATE tenant_catalog_instances
              SET status='provisioning', last_error=?2, updated_at=CURRENT_TIMESTAMP
            WHERE tenant_id=?1`
        )
        .bind(job.tenant_id, safeCode)
    );
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
  } else {
    statements.push(
      db
        .prepare(
          `UPDATE tenant_catalog_instances
              SET last_error=?2, updated_at=CURRENT_TIMESTAMP
            WHERE tenant_id=?1`
        )
        .bind(job.tenant_id, safeCode)
    );
  }

  await db.batch(statements);
}

function verifyMigrationResult(result, tenantId, expectedVersion) {
  if (!Array.isArray(result) || result.length !== 3) return false;
  const identity = result[0]?.results?.[0];
  const source = result[1]?.results?.[0];
  const stageTables = result[2]?.results?.[0];
  return (
    identity?.tenant_id === tenantId &&
    Number(identity?.schema_version) === expectedVersion &&
    Number(source?.total) === 1 &&
    Number(stageTables?.total) === 4
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

  let lifecycle;
  try {
    lifecycle = migrationLifecycle({
      provisioningId: context.provisioning_id,
      catalogStatus: context.catalog_status,
      resumeStep: context.resume_step
    });
  } catch {
    return { outcome: 'blocked', reason: 'tenant_data_plane_migration_lifecycle_invalid' };
  }

  const enrichedJob = {
    ...job,
    provisioning_id: context.provisioning_id || null,
    resume_step: lifecycle.resumeStep,
    migration_kind: lifecycle.kind,
    catalog_status: context.catalog_status
  };
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
            sql: "SELECT COUNT(*) AS total FROM supplier_sources WHERE tenant_id=?1 AND source_key=?2 AND status='active'",
            params: [job.tenant_id, context.source_key]
          },
          {
            sql: `SELECT COUNT(*) AS total
                    FROM sqlite_master
                   WHERE type='table'
                     AND name IN (
                       'supplier_sync_stage_runs',
                       'supplier_sync_stage_observations',
                       'supplier_sync_stage_events',
                       'supplier_sync_stage_categories'
                     )`,
            params: []
          }
        ]
      },
      { fetchImpl }
    );
    if (!verifyMigrationResult(verification, job.tenant_id, job.target_schema_version)) {
      throw new CloudflarePlatformError('tenant_d1_migration_verification_failed', 502);
    }

    await finishMigration(db, enrichedJob, job.target_schema_version);
    return {
      outcome: 'success',
      jobId: job.job_id,
      schemaVersion: job.target_schema_version,
      migrationKind: lifecycle.kind,
      preservesAvailability: lifecycle.preservesAvailability,
      resumedAt: lifecycle.resumeStep || 'ready'
    };
  } catch (error) {
    const safeCode =
      error instanceof CloudflarePlatformError ? error.code : 'tenant_d1_migration_failed';
    await failMigration(db, enrichedJob, safeCode);
    return {
      outcome: 'failed',
      jobId: job.job_id,
      migrationKind: lifecycle.kind,
      preservesAvailability: lifecycle.preservesAvailability,
      error: safeCode
    };
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
      `SELECT job_id, tenant_id, target_schema_version
         FROM tenant_data_plane_migration_jobs
        WHERE status IN ('pending','failed')
          AND attempt_count < ?1
          AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
        ORDER BY created_at ASC
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
      migrationKind: result.migrationKind || null,
      error: result.error || result.reason || null
    });
  }

  return {
    enabled: true,
    schemaVersion: TENANT_DATA_PLANE_SCHEMA_VERSION,
    discovered,
    selected: (due.results || []).length,
    processed: outcomes.length,
    succeeded: outcomes.filter((entry) => entry.outcome === 'success').length,
    failed: outcomes.filter((entry) => entry.outcome === 'failed').length,
    outcomes
  };
}
