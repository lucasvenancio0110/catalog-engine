import { CloudflarePlatformError, queryD1Batch } from './cloudflare-platform.js';
import {
  migrateTenantDataPlaneSchema,
  TenantDataPlaneClientError
} from './ingestion/tenant-data-plane.js';
import { stableOpaqueId } from './runtime-identity.js';
import { TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION } from './tenant-data-plane-command.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION,
  tenantDataPlaneMigrationBatches
} from './tenant-data-plane-schema-v8.js';

const DEFAULT_DISPATCH_NAMESPACE = 'catalog-engine-production';
const MAX_AUTOMATIC_ATTEMPTS = 6;
const MIGRATION_TRANSPORT_MAX_ATTEMPTS = 3;
const MIGRATION_TRANSPORT_BASE_DELAY_MS = 100;
const ACTIVE_IMPORT_STATUSES = "'pending','queued','scanning','details','finalizing'";

export const MAINTENANCE_MIGRATION_DISCOVERY_SQL = `SELECT DISTINCT i.tenant_id
         FROM tenant_catalog_instances i
         JOIN catalog_tenants t ON t.tenant_id=i.tenant_id AND t.status='active'
         JOIN tenant_data_plane_provider_state p ON p.tenant_id=i.tenant_id
         JOIN supplier_sources s ON s.tenant_id=i.tenant_id AND s.status='active'
        WHERE i.status='ready'
          AND i.schema_version < ?1
          AND p.database_status='active'
          AND p.worker_status='active'
          AND p.d1_database_id IS NOT NULL
          AND p.migration_command_version >= ?2
          AND NOT EXISTS (
            SELECT 1 FROM tenant_import_jobs j
             WHERE j.tenant_id=i.tenant_id
               AND j.status IN (${ACTIVE_IMPORT_STATUSES})
          )
          AND NOT EXISTS (
            SELECT 1 FROM tenant_data_plane_migration_jobs m
             WHERE m.tenant_id=i.tenant_id
               AND m.target_schema_version=?1
          )
        ORDER BY COALESCE(i.last_migration_at, i.created_at) ASC
        LIMIT ?3`;

export const DATA_PLANE_MIGRATION_DUE_SQL = `SELECT j.job_id, j.tenant_id,
              j.target_schema_version, j.migration_kind,
              CASE WHEN j.migration_kind='provisioning' THEN r.provisioning_id ELSE NULL END AS provisioning_id
         FROM tenant_data_plane_migration_jobs j
         JOIN tenant_data_plane_provider_state p ON p.tenant_id=j.tenant_id
         LEFT JOIN tenant_provisioning_runs r ON r.provisioning_id=(
           SELECT r2.provisioning_id FROM tenant_provisioning_runs r2
            WHERE r2.tenant_id=j.tenant_id ORDER BY r2.created_at DESC LIMIT 1
         )
        WHERE j.status IN ('pending','failed')
          AND j.target_schema_version=?2
          AND (
            j.migration_kind='provisioning'
            OR p.migration_command_version >= ?3
          )
          AND j.attempt_count < ?1
          AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= CURRENT_TIMESTAMP)
        ORDER BY CASE j.migration_kind WHEN 'provisioning' THEN 0 ELSE 1 END,
                 CASE j.status WHEN 'pending' THEN 0 ELSE 1 END,
                 j.created_at ASC
        LIMIT ?4`;

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

function migrationCommandVersionForTarget(targetVersion) {
  const version = Number(targetVersion);
  if (version === 7) return 3;
  if (version === TENANT_DATA_PLANE_SCHEMA_VERSION) {
    return TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION;
  }
  throw new CloudflarePlatformError('tenant_data_plane_schema_state_invalid', 500);
}

export function normalizeMigrationKind(value = 'provisioning') {
  const kind = String(value || 'provisioning').trim();
  if (kind === 'provisioning' || kind === 'maintenance') return kind;
  throw new Error('tenant_data_plane_migration_kind_invalid');
}

async function migrationJobId(tenantId, version, migrationKind = 'provisioning') {
  const kind = normalizeMigrationKind(migrationKind);
  const seed =
    kind === 'provisioning' ? `${tenantId}:v${version}` : `${tenantId}:v${version}:${kind}`;
  return stableOpaqueId('dpmig', seed);
}

async function upsertMigrationJob(db, { tenantId, targetVersion, migrationKind }) {
  const kind = normalizeMigrationKind(migrationKind);
  const jobId = await migrationJobId(tenantId, targetVersion, kind);
  await db
    .prepare(
      `INSERT INTO tenant_data_plane_migration_jobs
        (job_id, tenant_id, target_schema_version, migration_kind, status, attempt_count,
         next_attempt_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(job_id) DO NOTHING`
    )
    .bind(jobId, tenantId, targetVersion, kind)
    .run();
}

async function discoverProvisioningMigrationCandidates(db, targetVersion, limit) {
  const result = await db
    .prepare(
      `SELECT DISTINCT r.tenant_id
         FROM tenant_provisioning_runs r
         JOIN tenant_catalog_instances i ON i.tenant_id=r.tenant_id
         JOIN tenant_data_plane_provider_state p ON p.tenant_id=r.tenant_id
         JOIN supplier_sources s ON s.tenant_id=r.tenant_id AND s.status='active'
        WHERE r.current_step IN ('migrations','classify','verify')
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
    await upsertMigrationJob(db, {
      tenantId: row.tenant_id,
      targetVersion,
      migrationKind: 'provisioning'
    });
  }
  return (result.results || []).length;
}

async function discoverMaintenanceMigrationCandidates(db, targetVersion, limit) {
  const result = await db
    .prepare(MAINTENANCE_MIGRATION_DISCOVERY_SQL)
    .bind(targetVersion, TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION, limit)
    .all();

  for (const row of result.results || []) {
    await upsertMigrationJob(db, {
      tenantId: row.tenant_id,
      targetVersion,
      migrationKind: 'maintenance'
    });
  }
  return (result.results || []).length;
}

async function migrationContext(db, tenantId) {
  return db
    .prepare(
      `SELECT p.d1_database_id, p.dispatch_namespace, p.worker_script_name,
              p.migration_command_version,
              i.status AS catalog_status, i.schema_version AS current_schema_version,
              s.source_key, s.provider AS source_provider, s.source_url,
              s.sync_strategy, s.removal_miss_threshold,
              r.provisioning_id, r.current_step AS resume_step
         FROM tenant_data_plane_provider_state p
         JOIN tenant_catalog_instances i ON i.tenant_id=p.tenant_id
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
  const kind = normalizeMigrationKind(job.migration_kind);
  const requiredCommandVersion = migrationCommandVersionForTarget(job.target_schema_version);
  const result = await db
    .prepare(
      `UPDATE tenant_data_plane_migration_jobs
          SET status='running', attempt_count=attempt_count+1,
              started_at=COALESCE(started_at,CURRENT_TIMESTAMP), finished_at=NULL,
              last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE job_id=?1 AND status IN ('pending','failed') AND attempt_count < ?2
          AND migration_kind=?3
          AND (
            ?3='provisioning'
            OR (
              EXISTS (
                SELECT 1 FROM tenant_catalog_instances i
                 WHERE i.tenant_id=?4 AND i.status='ready'
              )
              AND NOT EXISTS (
                SELECT 1 FROM tenant_import_jobs j
                 WHERE j.tenant_id=?4 AND j.status IN (${ACTIVE_IMPORT_STATUSES})
              )
              AND EXISTS (
                SELECT 1 FROM tenant_data_plane_provider_state p
                 WHERE p.tenant_id=?4
                   AND p.migration_command_version>=?5
              )
            )
          )`
    )
    .bind(
      job.job_id,
      MAX_AUTOMATIC_ATTEMPTS,
      kind,
      job.tenant_id,
      requiredCommandVersion
    )
    .run();
  if (Number(result.meta?.changes || 0) < 1) return false;

  if (kind === 'provisioning' && job.provisioning_id) {
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
  const kind = normalizeMigrationKind(job.migration_kind);
  const nextStep = kind === 'provisioning' ? migrationResumeStep(job.resume_step) : null;
  const catalogStatement =
    kind === 'maintenance'
      ? db
          .prepare(
            `UPDATE tenant_catalog_instances
                SET schema_version=?2, last_migration_at=CURRENT_TIMESTAMP,
                    last_error=NULL, updated_at=CURRENT_TIMESTAMP
              WHERE tenant_id=?1`
          )
          .bind(job.tenant_id, version)
      : db
          .prepare(
            `UPDATE tenant_catalog_instances
                SET schema_version=?2, status='provisioning', last_migration_at=CURRENT_TIMESTAMP,
                    last_error=NULL, updated_at=CURRENT_TIMESTAMP
              WHERE tenant_id=?1`
          )
          .bind(job.tenant_id, version);

  const statements = [
    db
      .prepare(
        `UPDATE tenant_data_plane_migration_jobs
            SET status='success', finished_at=CURRENT_TIMESTAMP, next_attempt_at=NULL,
                last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE job_id=?1`
      )
      .bind(job.job_id),
    catalogStatement
  ];
  if (kind === 'provisioning' && job.provisioning_id) {
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
          JSON.stringify({ schemaVersion: version, isolated: true, resumeStep: nextStep })
        )
    );
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_runs
              SET status='running', current_step=?3, last_error=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND tenant_id=?2 AND current_step='migrations'`
        )
        .bind(job.provisioning_id, job.tenant_id, nextStep)
    );
  }
  await db.batch(statements);
  return nextStep;
}

async function failMigration(db, job, safeCode) {
  const kind = normalizeMigrationKind(job.migration_kind);
  const catalogStatement =
    kind === 'maintenance'
      ? db
          .prepare(
            `UPDATE tenant_catalog_instances
                SET last_error=?2, updated_at=CURRENT_TIMESTAMP
              WHERE tenant_id=?1`
          )
          .bind(job.tenant_id, safeCode)
      : db
          .prepare(
            `UPDATE tenant_catalog_instances
                SET status='provisioning', last_error=?2, updated_at=CURRENT_TIMESTAMP
              WHERE tenant_id=?1`
          )
          .bind(job.tenant_id, safeCode);

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
    catalogStatement
  ];
  if (kind === 'provisioning' && job.provisioning_id) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableMigrationTransport(phase, error) {
  return Boolean(
    (error instanceof CloudflarePlatformError &&
      ['cloudflare_platform_unreachable', 'cloudflare_platform_timeout'].includes(error.code)) ||
    (error instanceof TenantDataPlaneClientError &&
      (['tenant_data_plane_dispatch_failed', 'tenant_data_plane_dispatch_unavailable'].includes(
        error.code
      ) ||
        (['inspect', 'verify'].includes(phase) &&
          error.code === 'tenant_data_plane_query_failed') ||
        (phase === 'apply' && error.code === 'tenant_data_plane_migration_failed')))
  );
}

function phaseMigrationError(phase, error) {
  if (
    error instanceof CloudflarePlatformError &&
    ['cloudflare_platform_unreachable', 'cloudflare_platform_timeout'].includes(error.code)
  ) {
    const transport = error.code.endsWith('_timeout') ? 'timeout' : 'unreachable';
    return new CloudflarePlatformError(`tenant_d1_migration_${phase}_${transport}`, error.status);
  }
  if (error instanceof TenantDataPlaneClientError) {
    const suffix = String(error.code || '')
      .replace(/^tenant_data_plane_/, '')
      .replace(/[^a-z0-9_]/g, '');
    return new CloudflarePlatformError(
      `tenant_d1_migration_${phase}_${suffix || 'dispatch_failed'}`,
      error.status
    );
  }
  return error;
}

async function runMigrationTransportPhase(
  phase,
  operation,
  { sleepImpl = sleep, randomImpl = Math.random } = {}
) {
  for (let attempt = 1; attempt <= MIGRATION_TRANSPORT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (retryableMigrationTransport(phase, error) && attempt < MIGRATION_TRANSPORT_MAX_ATTEMPTS) {
        const exponentialDelay = MIGRATION_TRANSPORT_BASE_DELAY_MS * 2 ** (attempt - 1);
        const random = Math.min(Math.max(Number(randomImpl()) || 0, 0), 0.999999);
        await sleepImpl(exponentialDelay + Math.floor(random * exponentialDelay));
        continue;
      }
      throw phaseMigrationError(phase, error);
    }
  }
  throw new CloudflarePlatformError(`tenant_d1_migration_${phase}_unreachable`, 503);
}

async function resolveTenantSchemaVersion(
  config,
  { tenantId, databaseId, controlVersion, targetVersion, requireDispatch = false },
  { fetchImpl, tenantDispatch }
) {
  if (controlVersion === 0) return 0;
  if (requireDispatch && !(tenantDispatch && typeof tenantDispatch.get === 'function')) {
    throw new TenantDataPlaneClientError('tenant_data_plane_dispatch_unbound', 503);
  }
  const result = await queryD1Batch(
    {
      ...config,
      databaseId,
      tenantDispatch,
      batch: [
        {
          sql: 'SELECT tenant_id, schema_version FROM data_plane_identity WHERE tenant_id=?1 LIMIT 1',
          params: [tenantId]
        },
        {
          sql: 'SELECT version FROM data_plane_schema_migrations ORDER BY version ASC',
          params: []
        }
      ]
    },
    { fetchImpl }
  );
  const identity = result[0]?.results?.[0];
  const version = Number(identity?.schema_version);
  const ledger = (result[1]?.results || []).map((row) => Number(row.version));
  const ledgerIsContiguous =
    ledger.length === version && ledger.every((entry, index) => entry === index + 1);
  if (
    identity?.tenant_id !== tenantId ||
    !Number.isInteger(version) ||
    version < controlVersion ||
    version > targetVersion ||
    !ledgerIsContiguous
  ) {
    throw new CloudflarePlatformError('tenant_d1_schema_state_invalid', 500);
  }
  return version;
}

export async function processTenantDataPlaneMigration(
  db,
  { job, env },
  { fetchImpl = fetch, sleepImpl = sleep, randomImpl = Math.random } = {}
) {
  const config = runtimeConfig(env);
  if (!config) return { outcome: 'queued', reason: 'cloudflare_platform_unconfigured' };
  const migrationKind = normalizeMigrationKind(job.migration_kind);
  const context = await migrationContext(db, job.tenant_id);
  if (!context?.d1_database_id) return { outcome: 'blocked', reason: 'tenant_database_not_ready' };
  if (migrationKind === 'maintenance' && context.catalog_status !== 'ready') {
    return { outcome: 'blocked', reason: 'tenant_catalog_not_ready_for_maintenance' };
  }
  const enrichedJob = {
    ...job,
    migration_kind: migrationKind,
    provisioning_id: migrationKind === 'provisioning' ? context.provisioning_id || null : null,
    resume_step: migrationKind === 'provisioning' ? context.resume_step || 'migrations' : null
  };
  if (!(await claimMigration(db, enrichedJob))) return { outcome: 'busy', jobId: job.job_id };

  try {
    if (context.dispatch_namespace !== config.dispatchNamespace) {
      throw new CloudflarePlatformError('tenant_dispatch_namespace_mismatch', 500);
    }
    const requiredCommandVersion = migrationCommandVersionForTarget(job.target_schema_version);
    if (
      migrationKind === 'maintenance' &&
      Number(context.migration_command_version || 0) < requiredCommandVersion
    ) {
      throw new CloudflarePlatformError('tenant_migration_command_not_prepared', 409);
    }
    const source = {
      sourceKey: context.source_key,
      provider: context.source_provider,
      sourceUrl: context.source_url,
      syncStrategy: context.sync_strategy,
      removalMissThreshold: Number(context.removal_miss_threshold || 3)
    };
    const controlVersion = Number(context.current_schema_version);
    const targetVersion = Number(job.target_schema_version);
    if (
      !Number.isInteger(controlVersion) ||
      !Number.isInteger(targetVersion) ||
      controlVersion < 0 ||
      targetVersion < 1 ||
      targetVersion > TENANT_DATA_PLANE_SCHEMA_VERSION ||
      controlVersion > targetVersion
    ) {
      throw new CloudflarePlatformError('tenant_data_plane_schema_state_invalid', 500);
    }
    const currentVersion = await runMigrationTransportPhase(
      'inspect',
      () =>
        resolveTenantSchemaVersion(
          config,
          {
            tenantId: job.tenant_id,
            databaseId: context.d1_database_id,
            controlVersion,
            targetVersion,
            requireDispatch: migrationKind === 'maintenance'
          },
          { fetchImpl, tenantDispatch: env.TENANT_DISPATCH }
        ),
      { sleepImpl, randomImpl }
    );
    const migrationBatches = tenantDataPlaneMigrationBatches({
      tenantId: job.tenant_id,
      source,
      currentVersion,
      targetVersion
    });
    if (migrationKind === 'maintenance' && currentVersion < targetVersion) {
      if (!context.worker_script_name) {
        throw new CloudflarePlatformError('tenant_worker_script_unavailable', 500);
      }
      await runMigrationTransportPhase(
        'apply',
        () =>
          migrateTenantDataPlaneSchema(
            {
              tenantId: job.tenant_id,
              dataPlane: { workerScriptName: context.worker_script_name }
            },
            { TENANT_DISPATCH: env.TENANT_DISPATCH },
            targetVersion
          ),
        { sleepImpl, randomImpl }
      );
    } else {
      for (const batch of migrationBatches) {
        await runMigrationTransportPhase(
          'apply',
          () =>
            queryD1Batch(
              {
                ...config,
                databaseId: context.d1_database_id,
                batch
              },
              { fetchImpl }
            ),
          { sleepImpl, randomImpl }
        );
      }
    }
    const verification = await runMigrationTransportPhase(
      'verify',
      () =>
        queryD1Batch(
          {
            ...config,
            databaseId: context.d1_database_id,
            tenantDispatch: env.TENANT_DISPATCH,
            batch: [
              {
                sql: 'SELECT tenant_id, schema_version FROM data_plane_identity WHERE tenant_id=?1 LIMIT 1',
                params: [job.tenant_id]
              },
              {
                sql: "SELECT COUNT(*) AS total FROM supplier_sources WHERE tenant_id=?1 AND source_key=?2 AND status='active'",
                params: [job.tenant_id, context.source_key]
              }
            ]
          },
          { fetchImpl }
        ),
      { sleepImpl, randomImpl }
    );
    if (!verifyMigrationResult(verification, job.tenant_id, job.target_schema_version)) {
      throw new CloudflarePlatformError('tenant_d1_migration_verification_failed', 502);
    }

    const resumedAt = await finishMigration(db, enrichedJob, job.target_schema_version);
    return {
      outcome: 'success',
      jobId: job.job_id,
      migrationKind,
      schemaVersion: job.target_schema_version,
      resumedAt
    };
  } catch (error) {
    const safeCode =
      error instanceof CloudflarePlatformError ? error.code : 'tenant_d1_migration_failed';
    await failMigration(db, enrichedJob, safeCode);
    return { outcome: 'failed', jobId: job.job_id, migrationKind, error: safeCode };
  }
}

export async function runDueDataPlaneMigrations(env, { fetchImpl = fetch, limit = 2 } = {}) {
  if (!env.CATALOG_DB) return { enabled: false, reason: 'database_unbound', processed: 0 };
  const config = runtimeConfig(env);
  if (!config) return { enabled: false, reason: 'cloudflare_platform_unconfigured', processed: 0 };
  const db = env.CATALOG_DB;
  const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 2, 1), 3);

  const provisioningDiscovered = await discoverProvisioningMigrationCandidates(
    db,
    TENANT_DATA_PLANE_SCHEMA_VERSION,
    boundedLimit
  );
  const maintenanceDiscovered = await discoverMaintenanceMigrationCandidates(
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
        WHERE status='running'
          AND target_schema_version=?1
          AND updated_at <= datetime(CURRENT_TIMESTAMP,'-20 minutes')`
    )
    .bind(TENANT_DATA_PLANE_SCHEMA_VERSION)
    .run();

  const due = await db
    .prepare(DATA_PLANE_MIGRATION_DUE_SQL)
    .bind(
      MAX_AUTOMATIC_ATTEMPTS,
      TENANT_DATA_PLANE_SCHEMA_VERSION,
      TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION,
      boundedLimit
    )
    .all();

  const outcomes = [];
  for (const job of due.results || []) {
    const result = await processTenantDataPlaneMigration(db, { job, env }, { fetchImpl });
    outcomes.push({
      jobId: job.job_id,
      tenantId: job.tenant_id,
      migrationKind: job.migration_kind,
      outcome: result.outcome,
      error: result.error || null
    });
  }

  return {
    enabled: true,
    discovered: provisioningDiscovered + maintenanceDiscovered,
    provisioningDiscovered,
    maintenanceDiscovered,
    selected: (due.results || []).length,
    processed: outcomes.length,
    succeeded: outcomes.filter((entry) => entry.outcome === 'success').length,
    failed: outcomes.filter((entry) => entry.outcome === 'failed').length,
    outcomes
  };
}
