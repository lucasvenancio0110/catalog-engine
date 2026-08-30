export const TENANT_SYNC_MAX_RECOVERY_ATTEMPTS = 4;

const PHASE_CONTRACTS = Object.freeze({
  scan: Object.freeze({ statuses: ['queued', 'scanning', 'details', 'failed'], phases: ['scan', 'details'], leaseMinutes: 14 }),
  classification: Object.freeze({ statuses: ['details'], phases: ['details'], leaseMinutes: 5 }),
  verification: Object.freeze({ statuses: ['details'], phases: ['details'], leaseMinutes: 5 }),
  finalization: Object.freeze({ statuses: ['finalizing'], phases: ['finalize'], leaseMinutes: 5 })
});

const FAILURE_PHASE = Object.freeze({
  scan: 'scan',
  classification: 'classification',
  verification: 'verification',
  finalization: 'finalization'
});

function contractFor(kind) {
  const contract = PHASE_CONTRACTS[kind];
  if (!contract) throw new Error('tenant_sync_phase_lease_kind_invalid');
  return contract;
}

function placeholders(values, startAt) {
  return values.map((_, index) => `?${startAt + index}`).join(',');
}

export function safeTenantSyncErrorCode(value, fallback = 'tenant_sync_operation_failed') {
  const code = String(value?.code || value?.message || value || '').trim().toLowerCase();
  if (/^(tenant|sync|supplier|cei|catalog_provider)_[a-z0-9_]{1,112}$/.test(code)) return code;
  return fallback;
}

export function tenantSyncFailureIsRetryable(kind, codeValue) {
  contractFor(kind);
  const code = safeTenantSyncErrorCode(codeValue);
  if (
    code === 'sync_stage_count_mismatch' ||
    code === 'sync_candidate_cei_count_mismatch'
  ) {
    return true;
  }
  if (
    /(?:invalid|mismatch|blocked|not_ready|not_verified|not_staged|not_product|incomplete|exhausted|leak|policy|stale_base|authority_conflict|cas_conflict|findings)/.test(
      code
    )
  ) {
    return false;
  }
  if (kind === 'verification' && code.startsWith('sync_candidate_verify_')) return false;
  return /(?:failed|timeout|unreachable|unavailable|request_failed|dispatch_failed|transaction_failed|write_lost|count_mismatch)$/.test(
    code
  );
}

export function tenantSyncRecoveryDelayMinutes(attemptCount) {
  const attempt = Math.max(1, Math.min(TENANT_SYNC_MAX_RECOVERY_ATTEMPTS, Number(attemptCount) || 1));
  return Math.min(30, 2 ** attempt);
}

export async function claimTenantSyncPhaseLease(db, job, kind) {
  const contract = contractFor(kind);
  const mode = kind === 'scan' && job.mode === 'initial' ? 'initial' : 'incremental';
  const token = crypto.randomUUID();
  const statusStart = 9;
  const phaseStart = statusStart + contract.statuses.length;
  const result = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET phase_lease_kind=?4,
              phase_lease_token=?5,
              phase_lease_until=datetime(CURRENT_TIMESTAMP,?6),
              state_revision=state_revision+1,
              last_delivery_at=CURRENT_TIMESTAMP,
              updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
          AND mode=?8
          AND phase_lease_kind IS NULL
          AND phase_lease_token IS NULL
          AND status IN (${placeholders(contract.statuses, statusStart)})
          AND phase IN (${placeholders(contract.phases, phaseStart)})
          AND (?7 IS NULL OR state_revision=CAST(?7 AS INTEGER))`
    )
    .bind(
      job.import_id,
      job.tenant_id,
      job.source_key,
      kind,
      token,
      `+${contract.leaseMinutes} minutes`,
      job.state_revision ?? null,
      mode,
      ...contract.statuses,
      ...contract.phases
    )
    .run();
  if (Number(result?.meta?.changes || 0) !== 1) return null;

  const claimedStatement = db
    .prepare(
      `SELECT state_revision,recovery_attempt_count,phase_lease_until
         FROM tenant_import_jobs
        WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
          AND phase_lease_kind=?4 AND phase_lease_token=?5
        LIMIT 1`
    )
    .bind(job.import_id, job.tenant_id, job.source_key, kind, token);
  const claimed =
    typeof claimedStatement.first === 'function'
      ? await claimedStatement.first()
      : {
          state_revision:
            job.state_revision === undefined || job.state_revision === null
              ? null
              : Number(job.state_revision) + 1,
          recovery_attempt_count: Number(job.recovery_attempt_count || 0),
          phase_lease_until: null
        };
  if (!claimed) return null;
  return Object.freeze({
    kind,
    token,
    revision:
      claimed.state_revision === null || claimed.state_revision === undefined
        ? null
        : Number(claimed.state_revision),
    recoveryAttemptCount: Number(claimed.recovery_attempt_count || 0),
    leaseUntil: claimed.phase_lease_until
  });
}

export async function releaseTenantSyncPhaseLease(
  db,
  job,
  ownership,
  { resetRecovery = false, markClassified = false } = {}
) {
  if (!ownership?.token) return false;
  const result = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status=CASE WHEN phase_lease_kind='scan' THEN 'failed' ELSE status END,
              next_attempt_at=CASE
                WHEN phase_lease_kind='scan' THEN CURRENT_TIMESTAMP
                ELSE next_attempt_at
              END,
              last_failure_phase=CASE
                WHEN phase_lease_kind='scan' THEN 'scan'
                ELSE last_failure_phase
              END,
              phase_lease_kind=NULL,phase_lease_token=NULL,phase_lease_until=NULL,
              recovery_attempt_count=CASE WHEN ?7=1 THEN 0 ELSE recovery_attempt_count END,
              candidate_classified_at=CASE
                WHEN ?8=1 THEN CURRENT_TIMESTAMP ELSE candidate_classified_at
              END,
              state_revision=state_revision+1,updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
          AND phase_lease_kind=?4 AND phase_lease_token=?5
          AND (?6 IS NULL OR state_revision=CAST(?6 AS INTEGER))`
    )
    .bind(
      job.import_id,
      job.tenant_id,
      job.source_key,
      ownership.kind,
      ownership.token,
      ownership.revision,
      resetRecovery ? 1 : 0,
      markClassified ? 1 : 0
    )
    .run();
  return Number(result?.meta?.changes || 0) === 1;
}

export async function failTenantSyncPhaseLease(db, job, ownership, errorValue) {
  if (!ownership?.token) return false;
  const kind = ownership.kind;
  const failurePhase = FAILURE_PHASE[kind];
  if (!failurePhase) throw new Error('tenant_sync_phase_lease_kind_invalid');
  const safeCode = safeTenantSyncErrorCode(errorValue, `tenant_sync_${failurePhase}_failed`);
  const nextAttempt = Number(ownership.recoveryAttemptCount || 0) + 1;
  const retryable =
    nextAttempt < TENANT_SYNC_MAX_RECOVERY_ATTEMPTS &&
    tenantSyncFailureIsRetryable(kind, safeCode);
  const modifier = `+${tenantSyncRecoveryDelayMinutes(nextAttempt)} minutes`;
  const result = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status='failed',
              recovery_attempt_count=recovery_attempt_count+1,
              last_failure_phase=?7,
              next_attempt_at=CASE WHEN ?8=1 THEN datetime(CURRENT_TIMESTAMP,?9) ELSE NULL END,
              last_error_code=?10,
              phase_lease_kind=NULL,phase_lease_token=NULL,phase_lease_until=NULL,
              finalize_lease_until=CASE WHEN ?7='finalization' THEN NULL ELSE finalize_lease_until END,
              scan_lease_until=CASE WHEN ?7='scan' THEN NULL ELSE scan_lease_until END,
              state_revision=state_revision+1,updated_at=CURRENT_TIMESTAMP
        WHERE import_id=?1 AND tenant_id=?2 AND source_key=?3
          AND phase_lease_kind=?4 AND phase_lease_token=?5
          AND (?6 IS NULL OR state_revision=CAST(?6 AS INTEGER))`
    )
    .bind(
      job.import_id,
      job.tenant_id,
      job.source_key,
      kind,
      ownership.token,
      ownership.revision,
      failurePhase,
      retryable ? 1 : 0,
      modifier,
      safeCode
    )
    .run();
  return Number(result?.meta?.changes || 0) === 1;
}

export async function reclaimExpiredTenantSyncPhaseLeases(db) {
  const result = await db
    .prepare(
      `UPDATE tenant_import_jobs
          SET status='failed',
              phase=CASE
                WHEN phase_lease_kind='scan' AND mode='incremental' THEN 'scan'
                ELSE phase
              END,
              recovery_attempt_count=recovery_attempt_count+1,
              last_failure_phase=phase_lease_kind,
              next_attempt_at=CASE
                WHEN recovery_attempt_count+1>=${TENANT_SYNC_MAX_RECOVERY_ATTEMPTS} THEN NULL
                ELSE datetime(
                  CURRENT_TIMESTAMP,
                  CASE recovery_attempt_count+1
                    WHEN 1 THEN '+2 minutes'
                    WHEN 2 THEN '+4 minutes'
                    WHEN 3 THEN '+8 minutes'
                    ELSE '+16 minutes'
                  END
                )
              END,
              phase_lease_kind=NULL,phase_lease_token=NULL,phase_lease_until=NULL,
              scan_lease_until=CASE WHEN phase_lease_kind='scan' THEN NULL ELSE scan_lease_until END,
              finalize_lease_until=CASE WHEN phase_lease_kind='finalization' THEN NULL ELSE finalize_lease_until END,
              last_error_code='tenant_sync_' || phase_lease_kind || '_lease_expired',
              state_revision=state_revision+1,updated_at=CURRENT_TIMESTAMP
        WHERE (mode='incremental' OR (mode='initial' AND phase_lease_kind='scan'))
          AND phase_lease_kind IN ('scan','classification','verification','finalization')
          AND phase_lease_token IS NOT NULL
          AND (phase_lease_until IS NULL OR phase_lease_until<=CURRENT_TIMESTAMP)`
    )
    .run();
  return Number(result?.meta?.changes || 0);
}
