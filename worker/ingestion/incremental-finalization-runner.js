import { TenantImportContextError, loadTenantImportContext } from './context.js';
import { processTenantIncrementalPromotion } from './incremental-promotion.js';

const DEFAULT_LIMIT = 2;
const MAX_LIMIT = 5;
const FINALIZE_LEASE_MINUTES = 5;

function boundedLimit(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function inactiveSummary(reason) {
  return {
    enabled: false,
    reason,
    selected: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    busy: 0,
    promoted: 0,
    resumedAfterPromotion: 0,
    outcomes: []
  };
}

function platformRuntimeConfigured(env) {
  if (env?.TENANT_DISPATCH && typeof env.TENANT_DISPATCH.get === 'function') return true;
  const accountId = String(env?.CLOUDFLARE_PLATFORM_ACCOUNT_ID || '').trim();
  const apiToken = String(env?.CLOUDFLARE_PLATFORM_API_TOKEN || '').trim();
  return /^[a-f0-9]{32}$/i.test(accountId) && apiToken.length >= 20;
}

function safeFinalizationError(error) {
  if (error instanceof TenantImportContextError) return error.code;
  const value = String(error?.code || error?.message || error || '').trim();
  if (/^(tenant|sync|cei|catalog_provider)_[a-z0-9_]+$/i.test(value)) return value.slice(0, 120);
  return 'sync_finalization_failed';
}

async function discoverFinalizationJobs(db, limit) {
  const result = await db
    .prepare(
      `SELECT j.import_id, j.tenant_id, j.source_key, j.sync_scheduled_for
         FROM tenant_import_jobs j
         JOIN tenant_sync_schedules schedule
           ON schedule.tenant_id=j.tenant_id AND schedule.source_key=j.source_key
         JOIN tenant_catalog_instances instance ON instance.tenant_id=j.tenant_id
         JOIN tenant_data_plane_provider_state provider_state ON provider_state.tenant_id=j.tenant_id
        WHERE j.mode='incremental'
          AND j.status='finalizing'
          AND j.phase='finalize'
          AND j.sync_scheduled_for IS NOT NULL
          AND (j.finalize_lease_until IS NULL OR j.finalize_lease_until<=CURRENT_TIMESTAMP)
          AND instance.status='ready'
          AND instance.schema_version>=7
          AND provider_state.database_status='active'
          AND provider_state.worker_status='active'
          AND provider_state.d1_database_id IS NOT NULL
        ORDER BY j.updated_at ASC, j.created_at ASC, j.import_id ASC
        LIMIT ?1`
    )
    .bind(limit)
    .all();
  return result.results || [];
}

async function acquireFinalizationLease(db, job) {
  const modifier = `+${FINALIZE_LEASE_MINUTES} minutes`;
  const result = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET finalize_lease_until=datetime(CURRENT_TIMESTAMP,?5),
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
          AND mode='incremental'
          AND status='finalizing'
          AND phase='finalize'
          AND sync_scheduled_for=?4
          AND (finalize_lease_until IS NULL OR finalize_lease_until<=CURRENT_TIMESTAMP)`
    )
    .bind(job.import_id, job.tenant_id, job.source_key, job.sync_scheduled_for, modifier)
    .run();
  return Number(result?.meta?.changes || 0) === 1;
}

async function markFinalizationFailure(db, job, code) {
  await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status='failed', next_attempt_at=NULL,
              finalize_lease_until=NULL, last_error_code=?5,
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
          AND mode='incremental'
          AND status='finalizing'
          AND phase='finalize'
          AND sync_scheduled_for=?4`
    )
    .bind(job.import_id, job.tenant_id, job.source_key, job.sync_scheduled_for, code)
    .run();
}

export async function commitPromotedIncrementalControlState(db, job) {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE tenant_sync_schedules
            SET last_scheduled_at=CURRENT_TIMESTAMP,
                last_import_id=?3,
                next_sync_at=datetime(
                  CURRENT_TIMESTAMP,
                  '+' || incremental_interval_minutes || ' minutes'
                ),
                updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?1 AND source_key=?2
            AND next_sync_at=?4
            AND EXISTS (
              SELECT 1
                FROM tenant_import_jobs claimed_job
               WHERE claimed_job.import_id=?3
                 AND claimed_job.tenant_id=?1
                 AND claimed_job.source_key=?2
                 AND claimed_job.mode='incremental'
                 AND claimed_job.status='finalizing'
                 AND claimed_job.phase='finalize'
                 AND claimed_job.sync_scheduled_for=?4
                 AND claimed_job.finalize_lease_until>CURRENT_TIMESTAMP
            )`
      )
      .bind(job.tenant_id, job.source_key, job.import_id, job.sync_scheduled_for),
    db
      .prepare(
        `UPDATE tenant_import_jobs
            SET status='success', phase='complete',
                next_attempt_at=NULL, finished_at=CURRENT_TIMESTAMP,
                finalize_lease_until=NULL, last_error_code=NULL,
                updated_at=CURRENT_TIMESTAMP
          WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
            AND mode='incremental'
            AND status='finalizing'
            AND phase='finalize'
            AND sync_scheduled_for=?4
            AND finalize_lease_until>CURRENT_TIMESTAMP
            AND EXISTS (
              SELECT 1
                FROM tenant_sync_schedules committed_schedule
               WHERE committed_schedule.tenant_id=?2
                 AND committed_schedule.source_key=?3
                 AND committed_schedule.last_import_id=?1
                 AND committed_schedule.next_sync_at>?4
            )`
      )
      .bind(job.import_id, job.tenant_id, job.source_key, job.sync_scheduled_for)
  ]);

  if (
    Number(results?.[0]?.meta?.changes || 0) !== 1 ||
    Number(results?.[1]?.meta?.changes || 0) !== 1
  ) {
    return false;
  }

  const state = await db
    .prepare(
      `SELECT j.status, j.phase, j.finished_at, j.finalize_lease_until,
              schedule.last_import_id, schedule.last_scheduled_at, schedule.next_sync_at
         FROM tenant_import_jobs j
         JOIN tenant_sync_schedules schedule
           ON schedule.tenant_id=j.tenant_id AND schedule.source_key=j.source_key
        WHERE j.import_id=?1 AND j.tenant_id=?2 AND j.source_key=?3
          AND j.mode='incremental'
        LIMIT 1`
    )
    .bind(job.import_id, job.tenant_id, job.source_key)
    .first();

  return Boolean(
    state?.status === 'success' &&
      state?.phase === 'complete' &&
      state?.finished_at &&
      state?.finalize_lease_until == null &&
      state?.last_import_id === job.import_id &&
      state?.last_scheduled_at &&
      String(state?.next_sync_at || '') > String(job.sync_scheduled_for || '')
  );
}

export async function processTenantIncrementalFinalizationJob(
  env,
  job,
  { promote = processTenantIncrementalPromotion } = {}
) {
  const db = env.CATALOG_DB;
  const leased = await acquireFinalizationLease(db, job);
  if (!leased) return { outcome: 'busy', importId: job.import_id };

  try {
    const context = await loadTenantImportContext(
      db,
      {
        importId: job.import_id,
        tenantId: job.tenant_id,
        sourceKey: job.source_key
      },
      { allowedModes: ['incremental'] }
    );
    if (context.importStatus !== 'finalizing' || context.phase !== 'finalize') {
      throw new TenantImportContextError('tenant_import_checkpoint_mismatch');
    }
    if (context.schemaVersion < 7) {
      throw new TenantImportContextError('tenant_schema_not_ready');
    }

    const promotion = await promote(env, context);
    if (promotion?.outcome !== 'success') {
      const error = new Error(String(promotion?.error || 'sync_promotion_failed'));
      error.code = String(promotion?.error || 'sync_promotion_failed');
      throw error;
    }

    const committed = await commitPromotedIncrementalControlState(db, job);
    if (!committed) {
      const error = new Error('sync_finalization_control_cas_conflict');
      error.code = 'sync_finalization_control_cas_conflict';
      throw error;
    }

    return {
      outcome: 'success',
      importId: job.import_id,
      promotionAlreadyComplete: Boolean(promotion.alreadyComplete),
      authorityRevision: Number(promotion.authorityRevision || 0)
    };
  } catch (error) {
    const code = safeFinalizationError(error);
    try {
      await markFinalizationFailure(db, job, code);
    } catch {
      // A process/database interruption may leave the lease in place. Expiry is the
      // recovery boundary for M7D8; broader retry/DLQ policy remains M7D10.
    }
    return { outcome: 'failed', importId: job.import_id, error: code };
  }
}

export async function runDueTenantIncrementalFinalizations(
  env,
  { limit = DEFAULT_LIMIT, promote = processTenantIncrementalPromotion } = {}
) {
  if (!env?.CATALOG_DB) return inactiveSummary('database_unbound');
  if (!platformRuntimeConfigured(env)) {
    return inactiveSummary('tenant_ingestion_platform_unconfigured');
  }

  const db = env.CATALOG_DB;
  const jobs = await discoverFinalizationJobs(db, boundedLimit(limit));
  const outcomes = [];
  for (const job of jobs) {
    outcomes.push(await processTenantIncrementalFinalizationJob(env, job, { promote }));
  }

  const succeeded = outcomes.filter((entry) => entry.outcome === 'success').length;
  const failed = outcomes.filter((entry) => entry.outcome === 'failed').length;
  const busy = outcomes.filter((entry) => entry.outcome === 'busy').length;
  const resumedAfterPromotion = outcomes.filter(
    (entry) => entry.outcome === 'success' && entry.promotionAlreadyComplete
  ).length;

  return {
    enabled: true,
    reason: null,
    selected: jobs.length,
    processed: outcomes.length,
    succeeded,
    failed,
    busy,
    promoted: succeeded - resumedAfterPromotion,
    resumedAfterPromotion,
    outcomes
  };
}
