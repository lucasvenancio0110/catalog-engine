import { queryD1Batch } from '../cloudflare-platform.js';
import {
  TENANT_SYNC_MAX_RECOVERY_ATTEMPTS,
  reclaimExpiredTenantSyncPhaseLeases,
  safeTenantSyncErrorCode,
  tenantSyncRecoveryDelayMinutes
} from '../tenant-sync-phase-lease.js';
import {
  TenantImportContextError,
  ingestionPlatformConfig,
  loadTenantImportContext
} from './context.js';

const DEFAULT_LIMIT = 2;
const MAX_LIMIT = 5;
const RECOVERABLE_PHASES = new Set(['classification', 'verification', 'finalization']);

function boundedLimit(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function platformRuntimeConfigured(env) {
  if (env?.TENANT_DISPATCH && typeof env.TENANT_DISPATCH.get === 'function') return true;
  const accountId = String(env?.CLOUDFLARE_PLATFORM_ACCOUNT_ID || '').trim();
  const apiToken = String(env?.CLOUDFLARE_PLATFORM_API_TOKEN || '').trim();
  return /^[a-f0-9]{32}$/i.test(accountId) && apiToken.length >= 20;
}

function safeRecoveryError(error) {
  if (error instanceof TenantImportContextError) return error.code;
  return safeTenantSyncErrorCode(error, 'tenant_sync_recovery_failed');
}

async function discoverRecoverableJobs(db, limit) {
  const result = await db
    .prepare(
      `WITH recoverable AS (
         SELECT j.import_id,j.tenant_id,j.source_key,j.phase,j.last_failure_phase,
                j.last_error_code,j.state_revision,j.recovery_attempt_count,
                j.next_attempt_at,j.updated_at,
                ROW_NUMBER() OVER (
                  PARTITION BY j.tenant_id
                  ORDER BY j.next_attempt_at ASC,j.updated_at ASC,j.import_id ASC
                ) AS tenant_rank
           FROM tenant_import_jobs j
           JOIN tenant_catalog_instances i ON i.tenant_id=j.tenant_id
           JOIN tenant_data_plane_provider_state p ON p.tenant_id=j.tenant_id
          WHERE j.mode='incremental'
            AND j.status='failed'
            AND j.last_failure_phase IN ('classification','verification','finalization')
            AND j.recovery_attempt_count < ?1
            AND j.next_attempt_at IS NOT NULL
            AND j.next_attempt_at<=CURRENT_TIMESTAMP
            AND j.phase_lease_token IS NULL
            AND i.status='ready' AND i.schema_version>=7
            AND p.database_status='active' AND p.worker_status='active'
            AND p.d1_database_id IS NOT NULL
       )
       SELECT import_id,tenant_id,source_key,phase,last_failure_phase,
              last_error_code,state_revision,recovery_attempt_count
         FROM recoverable
        WHERE tenant_rank=1
        ORDER BY next_attempt_at ASC,updated_at ASC,import_id ASC
        LIMIT ?2`
    )
    .bind(TENANT_SYNC_MAX_RECOVERY_ATTEMPTS, limit)
    .all();
  return result.results || [];
}

async function loadRecoveryAuthority(context, env, queryBatch, fetchImpl) {
  const platform = {
    ...ingestionPlatformConfig(env, context.dataPlane.dispatchNamespace),
    tenantId: context.tenantId
  };
  const result = await queryBatch(
    {
      ...platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `SELECT r.state,r.safety_outcome,r.last_error_code,
                       sa.base_authority_revision,
                       a.revision AS current_authority_revision,
                       a.last_promoted_run_id,a.last_promoted_source_key
                  FROM supplier_sync_stage_runs r
                  JOIN supplier_sync_stage_authority sa
                    ON sa.run_id=r.run_id AND sa.tenant_id=r.tenant_id
                   AND sa.source_key=r.source_key
                  JOIN catalog_serving_authority a ON a.tenant_id=r.tenant_id
                 WHERE r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3
                 LIMIT 1`,
          params: [context.importId, context.tenantId, context.sourceKey]
        }
      ]
    },
    { fetchImpl }
  );
  return { platform, row: result[0]?.results?.[0] || null };
}

function authorityBeforePromotion(row) {
  return Number(row.current_authority_revision) === Number(row.base_authority_revision);
}

function authorityAfterOwnPromotion(row, context) {
  return (
    Number(row.current_authority_revision) === Number(row.base_authority_revision) + 1 &&
    row.last_promoted_run_id === context.importId &&
    row.last_promoted_source_key === context.sourceKey
  );
}

async function resetTransientVerification(
  context,
  authority,
  controlError,
  queryBatch,
  fetchImpl
) {
  const result = await queryBatch(
    {
      ...authority.platform,
      databaseId: context.dataPlane.databaseId,
      batch: [
        {
          sql: `UPDATE supplier_sync_stage_runs
                   SET state='details_complete',verification_code=NULL,
                       last_error_code=NULL,updated_at=CURRENT_TIMESTAMP
                 WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
                   AND state='failed' AND safety_outcome='proceed'
                   AND last_error_code=?4`,
          params: [context.importId, context.tenantId, context.sourceKey, controlError]
        },
        {
          sql: `UPDATE supplier_sync_runs
                   SET status='running',finished_at=NULL,error_text=NULL
                 WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3
                   AND status='failed' AND error_text=?4`,
          params: [context.importId, context.tenantId, context.sourceKey, controlError]
        }
      ]
    },
    { fetchImpl }
  );
  return Number(result[0]?.meta?.changes || 0) === 1;
}

async function validateRecovery(job, context, env, queryBatch, fetchImpl) {
  if (!RECOVERABLE_PHASES.has(job.last_failure_phase)) {
    return { allowed: false, code: 'tenant_sync_recovery_phase_invalid' };
  }
  const authority = await loadRecoveryAuthority(context, env, queryBatch, fetchImpl);
  const row = authority.row;
  if (!row || row.safety_outcome !== 'proceed') {
    return { allowed: false, code: 'tenant_sync_recovery_stage_not_admissible' };
  }

  if (job.last_failure_phase === 'classification') {
    return row.state === 'details_complete' && authorityBeforePromotion(row)
      ? { allowed: true, status: 'details', phase: 'details' }
      : { allowed: false, code: 'tenant_sync_recovery_classification_stale' };
  }

  if (job.last_failure_phase === 'verification') {
    if (!['failed', 'details_complete'].includes(row.state) || !authorityBeforePromotion(row)) {
      return { allowed: false, code: 'tenant_sync_recovery_verification_stale' };
    }
    if (row.state === 'details_complete') {
      return { allowed: true, status: 'details', phase: 'details' };
    }
    const reset = await resetTransientVerification(
      context,
      authority,
      job.last_error_code,
      queryBatch,
      fetchImpl
    );
    return reset
      ? { allowed: true, status: 'details', phase: 'details' }
      : { allowed: false, code: 'tenant_sync_recovery_verification_cas_conflict' };
  }

  if (
    (row.state === 'verified' && authorityBeforePromotion(row)) ||
    (row.state === 'promoted' && authorityAfterOwnPromotion(row, context))
  ) {
    return { allowed: true, status: 'finalizing', phase: 'finalize' };
  }
  return { allowed: false, code: 'tenant_sync_recovery_finalization_stale' };
}

async function commitRecovery(db, job, decision) {
  const result = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status=?4,phase=?5,next_attempt_at=NULL,last_error_code=NULL,
              last_recovery_at=CURRENT_TIMESTAMP,state_revision=state_revision+1,
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
          AND mode='incremental' AND status='failed'
          AND last_failure_phase=?6
          AND state_revision=CAST(?7 AS INTEGER)
          AND recovery_attempt_count=CAST(?8 AS INTEGER)
          AND next_attempt_at IS NOT NULL AND next_attempt_at<=CURRENT_TIMESTAMP
          AND (phase_lease_token IS NULL OR phase_lease_until<=CURRENT_TIMESTAMP)`
    )
    .bind(
      job.import_id,
      job.tenant_id,
      job.source_key,
      decision.status,
      decision.phase,
      job.last_failure_phase,
      job.state_revision,
      job.recovery_attempt_count
    )
    .run();
  return Number(result?.meta?.changes || 0) === 1;
}

async function postponeRecovery(db, job, code, { terminal = false } = {}) {
  const nextAttempt = Number(job.recovery_attempt_count || 0) + 1;
  const retry = !terminal && nextAttempt < TENANT_SYNC_MAX_RECOVERY_ATTEMPTS;
  const modifier = `+${tenantSyncRecoveryDelayMinutes(nextAttempt)} minutes`;
  const result = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET recovery_attempt_count=recovery_attempt_count+1,
              next_attempt_at=CASE WHEN ?4=1 THEN datetime(CURRENT_TIMESTAMP,?5) ELSE NULL END,
              last_error_code=?6,state_revision=state_revision+1,updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
          AND status='failed' AND state_revision=CAST(?7 AS INTEGER)`
    )
    .bind(
      job.import_id,
      job.tenant_id,
      job.source_key,
      retry ? 1 : 0,
      modifier,
      code,
      job.state_revision
    )
    .run();
  return Number(result?.meta?.changes || 0) === 1;
}

export async function runDueTenantIncrementalRecoveries(
  env,
  { limit = DEFAULT_LIMIT, queryBatch = queryD1Batch, fetchImpl = fetch } = {}
) {
  if (!env?.CATALOG_DB) return { enabled: false, reason: 'database_unbound', processed: 0 };
  if (!platformRuntimeConfigured(env)) {
    return { enabled: false, reason: 'tenant_ingestion_platform_unconfigured', processed: 0 };
  }
  const db = env.CATALOG_DB;
  const reclaimed = await reclaimExpiredTenantSyncPhaseLeases(db);
  const due = await discoverRecoverableJobs(db, boundedLimit(limit));
  const outcomes = [];

  for (const job of due) {
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
      const decision = await validateRecovery(job, context, env, queryBatch, fetchImpl);
      if (!decision.allowed) {
        await postponeRecovery(db, job, decision.code, { terminal: true });
        outcomes.push({
          importId: job.import_id,
          phase: job.last_failure_phase,
          outcome: 'blocked',
          error: decision.code
        });
        continue;
      }
      const recovered = await commitRecovery(db, job, decision);
      outcomes.push({
        importId: job.import_id,
        phase: job.last_failure_phase,
        outcome: recovered ? 'recovered' : 'busy'
      });
    } catch (error) {
      const code = safeRecoveryError(error);
      await postponeRecovery(db, job, code).catch(() => {});
      outcomes.push({
        importId: job.import_id,
        phase: job.last_failure_phase,
        outcome: 'failed',
        error: code
      });
    }
  }

  return {
    enabled: true,
    reason: null,
    reclaimed,
    selected: due.length,
    processed: outcomes.length,
    recovered: outcomes.filter((entry) => entry.outcome === 'recovered').length,
    failed: outcomes.filter((entry) => entry.outcome === 'failed').length,
    blocked: outcomes.filter((entry) => entry.outcome === 'blocked').length,
    busy: outcomes.filter((entry) => entry.outcome === 'busy').length,
    outcomes
  };
}
